/** Smart-continue: a completed turn keeps working unless the model closes with
 * the completion keyword; failure continuations are split by class
 * (tool failure / rate limit / upstream 5xx). */
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { makeHost, turnEnd, turnStart } from './host-fixture.mjs';

mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
const flush = async (ms = 20) => {
  mock.timers.tick(ms);
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

const hosts = [];
const host = (options) => {
  const h = makeHost({ scanOnBoot: false, ...options });
  hosts.push(h);
  h.start();
  return h;
};

const message = (turn, content) => ({
  type: 'assistant/message',
  seq: turn * 10 - 5,
  time: Date.now(),
  data: { turn, step: 1, message: { role: 'assistant', content } },
});
const text = (turn, value) => message(turn, [{ type: 'text', text: value }]);
const textWithToolCall = (turn, value) =>
  message(turn, [{ type: 'text', text: value }, { type: 'tool-call', toolCallId: `c${turn}`, toolName: 'edit', args: {} }]);
const followupText = (agent, index) => agent.followups[index].content[0].text;

try {
  // 1. 结尾写了暗号 → 任务真完成, 不再续跑。
  const done = host({ resumeCompletedTurns: true });
  const finished = done.agent('finished');
  done.emit(finished, turnStart(1));
  done.emit(finished, text(1, '已改完三处并跑过测试。\n完成'));
  done.emit(finished, turnEnd(1, 'completed'));
  await flush();
  assert.equal(finished.followups.length, 0, 'keyword terminates the loop');

  // 2. 正常结束但没写暗号 → 视为没做完, 自动继续。
  const half = host({ resumeCompletedTurns: true });
  const unfinished = half.agent('unfinished');
  half.emit(unfinished, turnStart(1));
  half.emit(unfinished, text(1, '先改了两个文件, 剩下的还没动。'));
  half.emit(unfinished, turnEnd(1, 'completed'));
  await flush();
  assert.equal(unfinished.followups.length, 1, 'missing keyword continues the turn');

  // 3. 自定义暗号: 只认配置的那个词。
  const custom = host({ resumeCompletedTurns: true, completionKeyword: 'DONE' });
  const customDone = custom.agent('custom-done');
  custom.emit(customDone, turnStart(1));
  custom.emit(customDone, text(1, 'All good. DONE'));
  custom.emit(customDone, turnEnd(1, 'completed'));
  await flush();
  assert.equal(customDone.followups.length, 0, 'custom keyword is honoured');
  const customOld = custom.agent('custom-old');
  custom.emit(customOld, turnStart(2));
  custom.emit(customOld, text(2, '做完了。完成'));
  custom.emit(customOld, turnEnd(2, 'completed'));
  await flush();
  assert.equal(customOld.followups.length, 1, 'the default keyword no longer matches');

  // 4. 暗号只认结尾: 出现在句子中间不算完成。
  const middle = host({ resumeCompletedTurns: true });
  const middleAgent = middle.agent('middle');
  middle.emit(middleAgent, turnStart(1));
  middle.emit(middleAgent, text(1, '完成之前还要跑一遍测试, 现在只写了代码。'));
  middle.emit(middleAgent, turnEnd(1, 'completed'));
  await flush();
  assert.equal(middleAgent.followups.length, 1, 'keyword must close the reply');

  // 5. 尾部标点/引号不影响判定。
  const punctuated = host({ resumeCompletedTurns: true });
  const punct = punctuated.agent('punct');
  punctuated.emit(punct, turnStart(1));
  punctuated.emit(punct, text(1, '全部搞定。「完成」!'));
  punctuated.emit(punct, turnEnd(1, 'completed'));
  await flush();
  assert.equal(punct.followups.length, 0, 'trailing punctuation is tolerated');

  // 6. continueOnlyWithWork: 普通问答不打扰, 动过手的回合才续。
  const chatty = host({ resumeCompletedTurns: true, continueOnlyWithWork: true });
  const chat = chatty.agent('chat');
  chatty.emit(chat, turnStart(1));
  chatty.emit(chat, text(1, '你好, 有什么可以帮你的?'));
  chatty.emit(chat, turnEnd(1, 'completed'));
  await flush();
  assert.equal(chat.followups.length, 0, 'plain chat is left alone');
  const worker = chatty.agent('worker');
  chatty.emit(worker, turnStart(2));
  chatty.emit(worker, textWithToolCall(2, '改一下配置'));
  chatty.emit(worker, text(2, '改好了。'));
  chatty.emit(worker, turnEnd(2, 'completed'));
  await flush();
  assert.equal(worker.followups.length, 1, 'a turn that used tools keeps going');

  // 7. 工具失败 → 续跑文案点明是哪个工具、要求先判断而不是当完成。
  const toolFail = host({ graceMs: 10, cooldownMs: 0, maxConsecutive: 5 });
  const failing = toolFail.agent('tool-fail');
  toolFail.emit(failing, turnStart(1));
  toolFail.emit(failing, {
    type: 'tool/call', seq: 5, time: Date.now(),
    data: { turn: 1, step: 1, name: 'edit', callId: 'c5', arguments: '{}' },
  });
  toolFail.emit(failing, {
    type: 'tool/result', seq: 6, time: Date.now(),
    data: {
      turn: 1, step: 1,
      message: {
        source: { kind: 'tool', callId: 'c5' }, role: 'user',
        content: [{ type: 'tool-result', toolCallId: 'c5', content: [{ type: 'text', text: 'File not found: src/a.ts' }], isError: true }],
      },
    },
  });
  toolFail.emit(failing, turnEnd(1, 'error', { error: { message: 'network down' } }));
  await flush();
  assert.equal(failing.followups.length, 1, 'a transient failure is continued');
  const toolText = followupText(failing, 0);
  assert.match(toolText, /edit/, 'tool failure names the tool');
  assert.match(toolText, /File not found/, 'tool failure carries the tool error excerpt');
  assert.match(toolText, /failed/i, 'tool failure is labelled as a failure, not a completion');

  // 8. 限流与上游 5xx 各有专属续跑文案。
  const limited = host({ graceMs: 10, cooldownMs: 0, maxConsecutive: 5 });
  const rate = limited.agent('rate');
  limited.emit(rate, turnStart(1));
  limited.emit(rate, turnEnd(1, 'error', { error: { status: 429, message: 'rate limited by upstream' } }));
  await flush();
  assert.match(followupText(rate, 0), /rate limited/i, '429 gets the rate-limit text');

  const server = host({ graceMs: 10, cooldownMs: 0, maxConsecutive: 5 });
  const five = server.agent('five');
  server.emit(five, turnStart(1));
  server.emit(five, turnEnd(1, 'error', { error: { status: 502, message: 'bad gateway' } }));
  await flush();
  assert.match(followupText(five, 0), /upstream service returned an error/i, '5xx gets the server text');

  // 9. 暗号收尾后循环计数清零, 下一条用户消息可以重新开始。
  const restart = host({ resumeCompletedTurns: true, loopMaxIterations: 1 });
  const again = restart.agent('again');
  restart.emit(again, turnStart(1));
  restart.emit(again, text(1, '做完了。完成'));
  restart.emit(again, turnEnd(1, 'completed'));
  await flush();
  assert.equal(again.followups.length, 0, 'the loop stops on completion');
  restart.emit(again, turnStart(2));
  restart.emit(again, text(2, '还有个收尾没做。'));
  restart.emit(again, turnEnd(2, 'completed'));
  await flush();
  assert.equal(again.followups.length, 1, 'a new user turn restarts the loop budget');

  console.log('smart-completion: all cases passed');
} finally {
  for (const h of hosts) h.dispose();
}
