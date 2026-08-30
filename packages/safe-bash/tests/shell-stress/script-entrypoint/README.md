# Independent script-entrypoint holdouts

Prepared independently of the author's `tests/shell/script-entrypoint*.ts`.
Verified August 26, 2026, after READY pinned source commit
`f4d9d2dadd72c4e265bb5a1ebb0a0a7eb4fbc825`. No pre-READY runtime test was used
as acceptance evidence. The single bounded READY wait ended when it appeared.

## Results

| Cohort | Result |
| --- | --- |
| Independent holdouts | 17/17 pass |
| Unmodified author script-entrypoint tests | 41/41 pass |
| Selected existing regressions | 146/146 pass |
| Global `tsc --noEmit` | Exit 0 |
| Build configuration `tsc -p tsconfig.build.json --noEmit` | Exit 0 |

All final cohorts have zero skips, TODOs or cancellations. Existing regressions
are exactly `core`, `lifecycle`, `review-lifecycle`, `inline-input-limits`,
`glob-budget`, `variable-scope`, `stdin-origin`, `fs-error-diagnostics` and `invoke`
under `tests/shell/`. No full global runtime suite was run.

`final-holdout-evidence.json` and `verification-evidence.json` retain exact
commands, raw output, source hashes, timestamps, observed HEADs and process IDs.
No guarded source changed during these runs. Runtime SHA-256 is
`dabbb60ffc499a7e64fae8071f12b465b5845e7246510e19da15b406f8481d10`;
shell SHA-256 is
`f4b9e55515e00ef456d48f6a3da60cf5b19b5af7fb91c700c151bd92726f6bb7`.
HEAD moved through unrelated owners' commits; this is pinned shell-source
evidence in a shared worktree, not certification of a clean repository.
All six recorded outer process groups were absent after validation; probe
processes and the bounded READY wait exited, with no watcher left running.

The initial `holdout-evidence.json` is preserved: 16/17 passed, with one verifier
fixture incorrectly using already-unsupported `read -u 3`. It was corrected to
the supported `read ... <&3`; exact cursor/output assertions stayed unchanged.
This was not a product defect, native mismatch or waived test. A preparatory
standalone typecheck also initially omitted the repository's `--lib ES2023`,
producing an unrelated WebDAV `RequestInit.duplex` error; the corrected command
and both final repository configurations passed. No source fixes were needed.

## Scope and reproduction

The 17 named holdouts exercise the contained VFS entrypoint contract, not full
Bash compatibility: literal paths/options; builtin/function/registry precedence;
function `$0` and positional restoration; nested descriptor cursors; replacement
stdin and exhausted provenance; syntax rejection before body effects with caller
redirections; memory-VFS traversal/symlink permissions; strict UTF-8 and shebang
rejection; UTF-8 source-byte accounting across repeated invoke; shared loops,
commands and mixed recursion; cancellation/error identity at access/stat/read/body
boundaries; post-stat disappearance; and middleware denial through literal invoke.

Run from the repository root after a stable author handoff:

```sh
node --unhandled-rejections=strict --import tsx --test tests/shell-stress/script-entrypoint/holdout.test.ts
```

The existing `tests/shell/helpers.ts` supplies memory VFS and commands. Imports
resolve the source TypeScript via `.js` specifiers and `tsx`, not `dist`. Each
holdout uses the existing `isolatedSpawn` process-group helper, a five-second hard
deadline, a 64-KiB combined capture ceiling, strict unhandled rejections and a
sanitized environment. Source guards cover shell, contracts and memory backend;
unrelated adapter edits do not invalidate these imported-source guards.

Independent holdout native profiles: none; expectations derive from the declared
contained contract. The unchanged existing `variable-scope.test.ts` separately
runs ten `-c` references with `/bin/bash`, GNU Bash 3.2.57(1)-release,
arm64-apple-darwin25, SHA-256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Its existing helper uses isolated temporary directories, sanitized environment,
two-second subprocess deadlines and exact stdout/stderr/status comparisons.
No direct native shebang execution or GNU 5.3 comparison was run here. The
author's separate 12-case/two-profile native capture was not independently rerun
and is not added to these counts. No stderr normalization or per-case oracle
selection is introduced.

Not tested here: the five pending first-read cases, frozen remote audits, paused
NUL diagnostics, lifecycle API proposals, curl/network behavior, other adapters,
host execution, PATH search, `sh`, `source`, `eval`, or general Bash support.
Memory-VFS root confinement does not establish real-backend symlink security.
Author tests and focused existing regressions are reported separately from
this holdout denominator. No superiority or product-completion claim follows.
