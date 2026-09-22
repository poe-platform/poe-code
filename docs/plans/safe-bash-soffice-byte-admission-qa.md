# soffice byte admission QA

Execute against the current candidate; earlier engine receipts do not certify it.

1. Run `npm run test:unit --workspace=safe-bash-command-soffice` and
   `npm run lint --workspace=safe-bash-command-soffice`.
2. Run the maintained selected build closure:
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
3. Use `scripts/package-safe.mjs` to stage artifacts under repository `out/`.
   Run `scripts/fixtures/safe-packages-soffice.mjs` in an isolated consumer
   containing only the generated safe-bash package, without the private workspace.
4. Typecheck `scripts/fixtures/safe-packages-soffice-types.mts` in that consumer
   with strict NodeNext, ES2022/DOM, `types: []`, and `skipLibCheck: false`.
5. Inspect the exported runtime and declaration closure: all private implementation
   references must be relative and bundled; no external runtime module imports.
6. Confirm malformed UTF-8/NUL rejection, literal BOM/Unicode paths, event ownership,
   denied listener authority, byte/work/allocation limits, failure rollback and
   post-cancellation release. These are deterministic admission checks, not
   performance measurements or a hostile-JavaScript sandbox qualification.
7. Purge only task-owned generated outputs after recording results.

No CLI handler or visual output changes. Conversion, actual browser/workerd cells,
checkpoint/replay, native Office parity, PDF profiles and geometry/screenshots
remain unqualified; do not count them as passes.

## Candidate receipt — 2026-09-20

- TDD: four new tests failed on the missing byte API and cancellation-blocked
  release before implementation. A further independent negative control covers
  split UTF-8 records, caller-buffer mutation after admission and earlier retained
  ownership surviving subsequent failed admission.
- Final command unit route: 24 passed, zero failures/skips.
- Command ESLint and production/test TypeScript routes: passed.
- Private-command package policy: passed for the maintained workspace inventory.
- Maintained selected safe-bash build closure: passed, including postbuild hooks.
- Generated-artifact consumer runtime and strict declaration fixture: passed.
  The consumer linked only generated safe-bash, with no private command linked.
  An AST traversal of the public runtime/declaration route and its ten-file closure
  found only relative bundled imports and no external modules.
- Tooling attempts: package-safe does not support `--help`; the invocation was
  corrected to its declared `--out-dir`/`--version` options. Initial artifact
  inspection used the wrong directory; inspection via manifest export targets
  subsequently passed. Neither attempt was counted as a verification pass.
- Broad root lint/test/build were not run: this increment changes only command
  argument admission and its retained-allocation cleanup. Whole safe-bash remains
  outside the zero-external-dependency claim; the audited soffice closure is the
  qualified scope. Actual browser/workerd, CLI handler, replay, Office conversion,
  standards and layout corpus checks remain unverified or unsupported as above.
- No commits, remote-main delivery, releases or standalone publication performed.
  Generated evidence under `out/soffice-byte-admission` was purged after inspection.
