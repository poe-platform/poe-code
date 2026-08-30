# Final scoped validation

Before-edit evidence commit: `db62cc6`.
Separate test-only commit: `bc08c8d`, exactly the two authorized existing files.

- independent104: raw103pass/1fail ->104pass/0fail; zero skips.
- original311 with matching current helper: raw310pass/1fail ->311pass/0fail;
  zero skips. All unchanged case inputs and native216 JSON hashes are preserved.
- Scoped `tsc --noEmit`: compiler exit0 on both invocations. The initial evidence
  wrapper exited1 because TypeScript generated `node-compile-cache` under its
  fresh owned TMPDIR. This was not a type, product or permission failure.
  `types-cleanup-incident.json` preserves the observation and generated-cache
  hashes. The narrow new-evidence cleanup adjustment accepts that name only for
  the types phase. Final compiler and wrapper both exit0; no emitted library JS.
- Both red and green have zero in-run hash drift; between them exactly the two
  intended test files differ across the pinned runtime/source/dependency map.
  Live differences from the older reviewer snapshot remain separately recorded.
- Exactly21 historical diagnostic reproductions remain:4 demonstrable errno-
  prefix-only and17 other text/context differences. None is fixed or waived.
  Strict195/216 and built134/142 remain separate historical observations, not
  newly measured scores or full parity.

`green-validation.json`, `types-validation.json`, the raw green logs and
`completion.json` contain exact commands, paths, hashes, counts and cleanup.
The two native test passes each left71 fixtures in their fresh owned runtime
directory; every sentinel/namespace/file-byte map was verified before removal.
No unattributed artifact was changed. All validation child processes exited;
the owned runtime directories and compiler cache are removed.

`initial-artifacts.json` describes the first evidence commit, not mutable latest
files. Only its new-evidence `run.mjs` later changes for the cleanup incident;
its exact initial bytes remain retrievable from `db62cc6` and are hash-verified
in finalization. All other initial artifacts, old files/logs, native captures,
first-pass/alias audit, and input fixtures remain byte-identical. The final
artifact manifest describes current evidence, without including native binaries,
dependency packages, copied source trees or generated cache assets.
