# 做完为止 (dsh-until-done)

DSH 插件。模型把回合正常结束、但任务其实只做了一半时，自动发一条「继续」把它推回工作；只有回复以**完成暗号**收尾，才算真的做完、不再打扰。

基于 [HsiangNianian/dsh-auto-continue](https://github.com/HsiangNianian/dsh-auto-continue) 改造，保留其故障恢复、断网挂起、循环护栏等能力，重做了「任务完成」判定与失败分类。

## 这一版改了什么

- **完成暗号**：默认「完成」。开启后，`turn/end = completed` 不再一律收工——回复末尾没有暗号就继续跑，写了暗号才停。暗号可在设置里改；只认结尾，`完成之前还要跑测试` 这种不算。
- **收尾约定注入系统提示词**：从第一轮就告诉模型规则（`order: 900`，`interpolate: false`），而不是等第一次自动续跑才说。文本可自定义，`{keyword}` 会替换成暗号。
- **失败分类更细**：工具执行失败、429 限流、5xx 上游错误各有专属续跑文案；工具失败会带上工具名和错误摘要，明确要求「先判断原因、能修就修」，而不是把失败当完成。
- **只续跑真在做事的回合**（可选）：普通问答（没调工具、没有进行中的目标）不自动续，避免「你好」被追着回复十轮。
- 重命名为 `dsh-until-done`，设置命名空间、HTTP 路由、日志前缀、界面文案全部独立，可与原插件并存。

## 安装

```bash
# 从 Release 装（推荐）
dsh plugin --profile web add https://github.com/KunKun24/dsh-until-done/releases/download/v1.0.0/dsh-until-done-1.0.0.tgz

# 或从本地目录装（改源码时用）
dsh plugin --profile web add link:/path/to/dsh-until-done
```

装完重启 DSH，设置入口在左下角 **更多设置 → 插件 → 做完为止**。

## 关键设置

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 要求完成暗号 | 开 | 回复末尾没有暗号就视为没做完，自动继续 |
| 完成暗号 | `完成` | 建议用正常句子里不常出现的词 |
| 把收尾约定写进系统提示词 | 开 | 第一轮就告诉模型规则 |
| 收尾约定文本 | 内置 | `{keyword}` 替换为暗号 |
| 只续跑有实际动作的回合 | 关 | 开启后普通问答不再自动续 |
| 工具失败时的继续文本 | 内置 | 支持 `{tool}` / `{result}` |
| 限流时的继续文本 | 内置 | 支持 `{status}` / `{code}` |
| 上游错误时的继续文本 | 内置 | 支持 `{code}` / `{status}` |
| 自主循环（resumeCompletedTurns） | 关 | 开 = 每个正常结束的回合都续，直到暗号出现 |

原有的重试策略（等待时间、连续上限、退避、断网挂起、错误分类）、启动恢复、循环护栏、状态桥与浏览器通知保持不变。

## 判定逻辑

```
turn/end(completed)
  └─ 自主循环开?
       ├─ 否 → 老逻辑（只有可见输出时清理预算）
       └─ 是 → 最后一条助手文本以暗号结尾?
                ├─ 是 → 任务完成，清空循环计数，停
                └─ 否 → （只续有动作的回合 已开 && 本回合无工具 && 无 active goal）
                          ├─ 是 → 普通问答，停
                          └─ 否 → 发送继续
```

「最后一条助手文本」会跳过带工具调用的消息（那不是最终答复），并容忍尾部标点、引号、星号与不可见格式字符。

## 开发

```bash
npm install
npm run build     # esbuild + tsc → lib/
npm test          # 含 tests/smart-completion.mjs
npm run typecheck
```

目录：`src/host/engine.ts`（引擎）、`src/shared/core.ts`（设置/判定/模板）、`src/client/*`（设置卡片、输入框开关、状态桥）。

## 许可

MIT。原项目 Copyright (c) 2025 HsiangNianian；本衍生版修改部分 Copyright (c) 2026 KunKun。详见 [LICENSE](./LICENSE)。
