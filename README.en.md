# Until Done (dsh-until-done)

[中文](README.md) · DeepSeek Harness plugin · MIT

A DSH plugin. When a turn ends normally but the task is only half done, it sends one more "continue" and pushes the model back to work. A reply counts as truly finished only when it closes with the **completion keyword**.

Forked from [HsiangNianian/dsh-auto-continue](https://github.com/HsiangNianian/dsh-auto-continue); recovery, offline pause and loop guards are kept, while completion detection and failure classification were reworked.

## What changed in this fork

- **Completion keyword** (default 「完成」). With it on, `turn/end = completed` no longer always means "stop": a reply that does not end with the keyword is continued, and only a reply that ends with it stops. The keyword is configurable; only the tail counts, so `完成之前还要跑测试` does not finish a task.
- **Rule injected into the system prompt** (order 900, `interpolate: false`) so the model knows the rule from the first turn instead of learning it after the first auto-continue. The text is editable and `{keyword}` is replaced with the keyword.
- **Finer failure classes**: tool failure, 429 rate limit and 5xx upstream errors each get their own continuation text. A tool failure names the tool and carries its error excerpt, and asks the model to diagnose before retrying instead of treating the failure as completion.
- **Optional "real work only"** mode: a plain chat turn (no tool call, no active goal) is left alone, so "hi" is not answered ten times.
- **Independent namespace**: contract namespace, HTTP routes, log prefix and UI copy all belong to `dsh-until-done`, so it can be installed beside the upstream plugin without clashing.

## Install

```bash
# from the release tarball (recommended)
dsh plugin --profile web add https://github.com/KunKun24/dsh-until-done/releases/download/v1.0.0/dsh-until-done-1.0.0.tgz

# or from a local checkout while developing
dsh plugin --profile web add link:/path/to/dsh-until-done
```

Restart DSH, then open **More settings → Plugins → Until Done** in the bottom-left corner.

## Key settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Require completion keyword | on | A reply without the keyword counts as unfinished and is continued |
| Completion keyword | `完成` | Prefer a word that rarely appears in normal prose |
| Put the rule in the system prompt | on | Tell the model from the first turn |
| Completion rule text | built-in | `{keyword}` is replaced with the keyword |
| Only continue turns with real work | off | Plain chat then stops auto-continuing |
| Continue text (tool failure) | built-in | Supports `{tool}` / `{result}` |
| Continue text (rate limit) | built-in | Supports `{status}` / `{code}` |
| Continue text (upstream error) | built-in | Supports `{code}` / `{status}` |
| Autonomous loop | off | Every normally finished turn is continued until the keyword appears |

Retry policy (delay, consecutive cap, backoff, offline pause, classification), startup recovery, loop guards, the status bridge and browser notifications are unchanged.

## Decision flow

```
turn/end(completed)
  └─ autonomous loop on?
       ├─ no  → legacy behaviour (budget cleared only on visible output)
       └─ yes → does the last assistant text end with the keyword?
                ├─ yes → task complete: reset loop counters, stop
                └─ no  → (real-work-only && no tool this turn && no active goal)
                          ├─ yes → plain chat, stop
                          └─ no  → send the continuation
```

"Last assistant text" skips messages that carry a tool call (those are not a final answer) and tolerates trailing punctuation, quotes, asterisks and invisible format characters.

## Development

```bash
npm install
npm run build     # esbuild + tsc → lib/
npm test          # includes tests/smart-completion.mjs
npm run typecheck
```

Layout: `src/host/engine.ts` (engine), `src/shared/core.ts` (settings, decisions, templates), `src/client/*` (settings card, composer toggle, status bridge).

## License

MIT. Original work Copyright (c) 2025 HsiangNianian; modifications Copyright (c) 2026 KunKun. See [LICENSE](./LICENSE).
