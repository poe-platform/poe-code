# Execution ledger

All work is rooted at `/Users/kjopek/Workspace/safe-bash`. The review scripts are
the complete executable ledger for programmatic archive, hash, child, and cleanup
operations. `execution/*.json` records actual Node child arguments, cwd, environment
overrides, PID, start/end, status/signal, watchdog and exact stdout/stderr.

Main invocations, in order:

```sh
pwd
git rev-parse --show-toplevel
git status --short
git diff --cached --name-only
cat ../AGENTS.md AGENTS.md
find tests -name AGENTS.md -print
git rev-parse HEAD
node tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review/freeze.mjs
node --unhandled-rejections=strict tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review/baseline.mjs
node --unhandled-rejections=strict tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review/baseline.mjs
node --check tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review/verify.mjs
node --unhandled-rejections=strict tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review/verify.mjs 5f7fe5d72f031db6cbacc76d9bfefcba2f58d03e
node --unhandled-rejections=strict tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review/cleanup.mjs
node --unhandled-rejections=strict tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review/seal.mjs
git diff --check -- tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review
```

The first baseline invocation failed at archive buffering, before extraction/test;
the second uses the corrected file-backed archive. Execution uses full Git archives
for baseline/candidate. The separate deliberate failure copy archives only `src`,
package/config files, canonical fixture and capture entrypoint, then applies the
single owned-copy regression with `apply_patch`. Full candidate fixture census is
not claimed for that deliberately narrowed failure-only copy.

Read-only investigation uses `sed`, `cat`, `rg`, `git show`, `git diff`, `git log`,
and small Node JSON selectors on the named canonical fixture, guard modules, author
markers, historical README/routing/manifest/report and generated evidence. The exact
99 raw diagnostics and historical bytes selected are retained in `frozen/`.
No old shared writer, historical `run.mjs`, full npm test, or native regex probe ran.

Every authored change uses `apply_patch`. Each atomic commit uses `git add --` and
`git commit --only` with explicit paths within `writer-isolation-review`; no foreign
index contents are included. Commit records list exact paths. `/tmp` handoff marker
updates likewise use `apply_patch`, outside Git, with the allowed verifier prefix.

Scripts intentionally refuse existing output files. Do not rerun them into this
sealed evidence directory or delete evidence to make them run; new reproduction
requires new owned output/scratch names. The archived candidate source and fixture
bindings, not mutable shared HEAD, define the reviewed execution.
