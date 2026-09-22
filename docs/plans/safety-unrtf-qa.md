# unrtf resource and failure boundary QA

Execute the current candidate with memory VFS and byte streams. The package
pattern is currently at `archive/safe-bash-command-package-pattern.md`.

1. Run `npm run test:unit --workspace=safe-bash-command-unrtf`. Check raw binary
   consumption at fixed and seeded random boundaries (seed 12345), malformed
   syntax, decoder prefix preservation, every quota dimension, foreign byte
   views, cancellation during parsing/output, iterator closure and reentrancy.
2. Run `node --import tsx --test packages/safe-bash/tests/plugins/unrtf-boundaries.test.ts`.
   Verify actual pipelines, redirect bytes, `sh /run.sh` and SDK equivalence.
   Confirm failed conversion publishes only its admitted prefix. Resolve a
   symlink alias and verify same-file redirection truncates the source before
   conversion. This is destructive shell behavior, not atomic publication.
3. Verify denied fetch remains unused for missing host/URL operands and inert
   hyperlink/object content. Absent native executable invocation must return
   127. Direct command tests deny both filesystem and environment getters for
   stdin conversion; no credentials/configuration authority is required.
4. Run workspace lint/source and test typechecks. Build the maintained selected
   safe-bash workspace closure. Assemble a local safe-bash artifact and execute
   the maintained unrtf installed-consumer runtime/declaration fixtures in an
   isolated directory without private workspaces. Never publish the command.
5. Remove task-owned temporary evidence after recording outcomes.

Results on September 20, 2026:

- 67 command workspace tests and three actual Shell boundary tests passed;
  zero failures, cancellations or skips. These are deterministic semantic
  controls, not performance measurements. New controls passed the incoming
  implementation; no runtime fix was justified or made.
- Workspace ESLint and source/test TypeScript checks passed. The maintained
  selected safe-bash build closure passed all 19 build tasks, zero cache hits.
- The command package remains private, ESM and has empty runtime dependencies;
  safe-bash's unrtf source entry is a composition/export only.
- Fresh artifact assembly passed. An isolated assembled consumer without
  private workspaces passed the maintained unrtf runtime fixture with empty
  PATH, shared runtime identity, CLI/SDK parity and strict NodeNext declarations
  without skipLibCheck. The public manifest has no private command dependency.
  npm tarball packing was not run. Task-owned artifact evidence was removed.
- Redirected output is partial on failure; aliases permit destructive source
  truncation. No command destination API, atomic/exclusive publication or image
  writer exists. Image collision/rollback cells are unsupported, not passes.
- GNU personality/configuration selection, native-legacy/recovery profiles,
  native encoding bytes, full codec/charmap inventory, nested/merged tables and
  picture exports remain unsupported. No GNU compatibility admission is made.
- Actual browser/workerd runtimes, checkpoint/replay and broad repository
  test/lint/build gates were not run. The command owns no checkpoint state.
  No product visual behavior changed, so screenshots were not run.
- `/out` artifact setup failed with ENOENT before consumer verification;
  repository `out/safety-unrtf` is the task-owned fallback. This setup failure
  is separate from semantic test results.
- Unrelated edits were preserved. No commit, push, publication or release.
