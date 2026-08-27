# V2 postfix — bounded invocation closure accepted

Independently verified on **August 27, 2026**, source commit
**b02bbe855b6b45d635b521e3dc2f31ea2b04e215**. Both routed findings are fixed:
command-V uses an absolute PATH-found description, and invalid command flags
produce the primary invalid-option/usage diagnostic before dispatch. Registry
commands remain honestly classified; no production or fixture relabeling occurs.

## Actual results

| Cohort | Measured result |
| --- | --- |
| Original34, unchanged | **32/34**, two native/registry role conflicts retained |
| Corrected v2 native-role34 | **34/34** |
| Separate truthful registry control | **1/1** |
| Frozen legacy independent / author invocation | **72/72 / 132/132** |
| Prior file cohort, da549ff unchanged | **58/58** |
| Selected regressions | **173/173** |
| Original author closure | **210/211** before authorized assertion correction |
| Corrected author closure | **211/211** |
| New source-fix author cohort | **96/112**: primary52/52, historical36/52, host8/8 |
| Fresh virtual original57 vs captured5.3 /3.2 | **51/57 /49/57** |
| Fresh virtual v2-26 vs captured5.3 /3.2 | **25/26 /12/26** raw exact |
| Fresh virtual original26 vs captured5.3 /3.2 | **24/26 /12/26** raw exact |

No skips, xfails, TODOs, cancellation, hard deadline or capture overflow. All
failures stay in their denominators. Original d02 **31/34** remains immutable;
its postfix **32/34** does not pretend registered printf is a native builtin.
The separately frozen225f992 correction queries actual builtin true in both
profiles, retaining all other source/expectation structure. The supplemental
registry test explicitly checks truthful printf/plugin kinds and dispatch.

**Acceptance is limited to supported invocation semantics:** legacy72/132 and
the corrected34 + registry1 close the requested discovery/read-N/sh-profile
checkpoint and the two routed discovery defects. No new in-scope source bug was
observed. This is not universal native parity, every profile/builtin, full Bash,
or a clean whole-product tree. Source/dot/eval was not started; it remains a
separate root-authorized next batch after this final checkpoint.

## One authorized assertion change

Separate atomic commit **29a6122** changes only the command-x branch in the
three-source unsupported-options loop of
`tests/shell/invocation-closure-discovery.test.ts`. It now asserts the exact
modern invalid-option and usage lines. Status2, empty output/effect prevention,
command-p/type-x assertions and all other definitions remain unchanged.
The original210/211 failure and exact old assertion are preserved. Existing
whole native52-per-profile evidence contains command-x for both bash/sh roles;
both raw dialects and minimal option-parser source proof are retained in
`V2_AUTHOR_ASSERTION.md` and its two JSON proofs. No new native probe was needed.

## Source, imports and compiler qualification

Runtime SHA256: `bb629885983de4169d8419c97f8d09be2ae1729841ae306675ce530cd8287d7c`.
Unchanged BOM-shell SHA256: `4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e`.
Starting HEAD: `d484f98745494099e57740c8c0ad673b65e0a2aa`.
Audit-end observed HEAD: `29a61222a8744ce479601ff33061a38b4a193b78`.

**42 actual imported product TS paths** retain identical hashes within each
runtime run, between runtime phases, and at the audit endpoint. Every phase has
fresh pre-enumerated input hashes, actual TS loader evidence and exact commands.
This records endpoint stability, not a lease or protection against write/revert.

- Global noEmit: **exit0 but guard INVALIDATED** across936 compiler inputs by
  foreign `src/commands/structured/jq.ts` changing during compilation. It is
  not a guarded global pass; no retry sought a clean-looking result.
- Build noEmit: exit0,296 inputs, stable during its run.
- Benchmark noEmit: exit0,411 inputs, stable during its run.

Later foreign archive/structured/test changes differ from compiler snapshots;
all paths and tested/current hashes are in `v2-postfix-summary.json`. They do not
invalidate the unchanged runtime dependencies, nor do runtime passes certify
that later tree. No missing compiler-input hash is retroactively fabricated.

## Raw provenance, losses and reproduction

No whole native cohort was rerun in this postfix replay. Both real original57
profiles were already refreshed at d02c3b5; both v2-26 profiles were captured at
225f992. Their hashes, actual interpreter/argv0 roles, locales and rendered
fixtures remain unchanged. All comparisons use **fresh virtual** observations.
Existing selected regressions retain61 historical/bin/bash3.2 references; these
are not new whole-profile captures or the separate pending historical-nine.

V2 primary raw25/26 retains native temporary-cwd versus VFS `/work` coordinates
for command-V; the predeclared semantic coordinate mapping is explicit, never
raw normalization. Historical read-N, POSIX function-prefix, mixed type status
and diagnostic line differences remain. Legacy raw57 retains four strict file
policy rows plus diagnostic losses. The new112 retains two historical empty-PATH
spellings and14 line-number differences. No loss is removed as a skip or waiver.

Exact replay commands are embedded in the phase JSONs. The entry point is
`node --import tsx tests/shell-stress/invocation-closure/v2-verify.ts <fresh-name.json> <stage>`:
stages `new`, `v2`, `legacy`, `previous`, `author`, `discovery-fixes`, and `types`.
`compare.ts` consumes those captures with the original or v2 native files;
the fixed stdoutHex decoder is reused, not ad hoc escaped-TAP parsing.
`v2-postfix-audit.mjs` generates the immutable summary and cleanup check.

All **166 captured child PIDs/groups** are absent; owned temporary directories
and watchers are absent. Existing regression children complete within their
bounded parent groups. No pending first-read/nine-native, paused NUL, remote
audit, broad suite, JSON/BOM tests or new breadth ran. Command-p, aliases/keywords,
invalid UTF8 text boundaries, limited function display and earlier unsupported
policies remain explicit limits. No superiority claim follows.
