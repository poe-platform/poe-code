# DOCX command grammar implementation

Bounded task: implement the original grammar and shared input validation on main.
Later document/model operation bodies, publication orchestration, full result
rendering, corpus qualification and release work remain pending.

## Authority and ownership

Read root/scoped AGENTS.md, docs/specs/docx.md, office-cli.md, office-sdk.md,
the API audit/inventory and the command/public-API registers. The existing
pipeline-plan edits and archive move are unrelated and are not staged.
Product changes belong to packages/docx. The safe-bash adapter remains an
explicit injected engine and preserves its existing byte argument contract.
Only its original registered test file receives added integration cases.
The root changes only the existing portable export test; its existing export
route already exposes the package entry point.

Owned files are the new argument-json, command, command-selection,
command-option-rules, command-properties, operation-schema-data,
operation-schema, operation-json-schema and operation-types modules and their
new tests, packages/docx/src/index.ts, the safe-bash DOCX registration test,
scripts/docx-exports.test.ts and the two new command grammar/schema plan files.
No README, ignored fixture, downloaded document or unrelated plan is owned.

## Implementation boundary

- A pure literal byte-argv parser recognizes all registered direct paths,
  discovery aliases and the sole text shorthand. It does not evaluate shell
  syntax, reconstruct argv from display strings, invoke a host shell or fetch
  resources. UTF-8 decoding is fatal; argument BOMs remain data.
- Closed operation declarations cover all 1,506 registered operation IDs,
  including the 113 direct paths and the enumerated advanced operations.
  Shared field validation and resolved JSON input schemas preserve neutral
  names, nullable values, enums, limits and explicit transport descriptors.
  These are grammar declarations, not evidence that 1,506 operation bodies run.
- CLI JSON alternatives normalize into the shared semantic input fields. Batch
  source envelopes flatten to version/operations. The declared valueJson scalar
  retains its original name. Unknown keys, malformed JSON, duplicate escaped
  keys, nonfinite/unsafe numbers, cycles, accessors and malformed Unicode fail.
- Output/selector/source conflicts are rejected before document dispatch.
  Exactly one explicit stdin consumer is reserved. JSON source acquisition
  uses only a supplied callback or explicit stdin, then validates before invoking
  the operation handler. A JSON VFS descriptor with path '-' stays a literal
  path; it does not silently become another stdin consumer.
- SDK validation owns retained nested values. Binary copies use intrinsic typed
  array operations, preserving Buffer/Uint8Array bytes without invoking custom
  iterators or byte-property getters. Binary stdin/stdout are never decoded as
  document text. Structured sources respect lowered named budgets.
- Typed batches reject recursive/direct-only operations, item publication flags,
  missing/mismatched receivers, forward handles, invalid collection lookup and
  void-result bindings. Existing custom-property type resolution, resource
  existence, owner identity, stale handles and document-dependent geometry are
  semantic admission obligations for the later engine, never guessed from argv.
- The command engine factory validates before calling its explicit handler.
  It emits bounded usage/source/limit diagnostics and JSON error envelopes when
  requested. Discovery paths are validated; domain handlers and complete
  success-result/help/capability rendering remain the later execution layer.

The exact JavaScript/security transport mappings and documentation effect
corrections are recorded in [the schema mapping plan](docx-command-schema-mappings.md).
Historical source inventories and their unimplemented body status are preserved.

## Failing tests before implementation

The initial command/codec/schema and shell integration runs failed on missing
modules before any corresponding product implementation. Further original
regressions were added and observed failing before fixes for missing resource
selectors, help validation, JSON-file dispatch, sparse arrays, byte-property
overrides, SDK ownership, limit lowering, source failure status, batch receiver
and collection typing, property parsing, numeric geometry, restart cycles,
language tags, nullable CLI properties and public exports. All new mutation fixtures use memfs; none
depends on a download or a reference runtime.

The safe-bash tests preserve the original injected engine's opaque-byte behavior,
then separately exercise the shared validated engine with quoted JSON, literal
shell-looking text, Unicode and leading-dash paths, empty replacement values,
conflicting stdin consumers and exact binary input/output.

## QA and maintained checks

1. Run the maintained DOCX package unit and lint routes, including test types.
2. Build its maintained selected workspace dependency closure with
   `npm run build:workspaces -- --workspace=docx`.
3. Run the existing safe-bash registration/I/O files through its node:test/tsx
   runner and the root portable export/bundle test. The browser bundle must have
   no external runtime imports and expose the new grammar APIs.
4. Run root `npm test` and the repository lint routes because public export and
   shell integration evidence span the workspace boundary. Record the actual
   outcomes below; do not substitute a root-only unit route.
5. Inspect actual safe-bash usage errors rendered by the maintained terminal-PNG
   renderer. Preserve the earlier image separately. Reviewed screenshots are
   `/tmp/docx-grammar-errors.png` and `/tmp/docx-grammar-errors-final.png`.
   The final image includes the JSON usage envelope, separate stderr diagnostic
   and exit 2; no binary output. These disposable QA images are not committed.
6. Review exact owned diffs, stage explicit files and commit on main with the
   commit hook enabled. No push or release is authorized for this task.

## Results

Completed checks:

- `npm test --workspace docx`: 23 files, 685 tests passed, including the final
  nullable-property regression after its observed failure.
- `npm run lint --workspace docx`: ESLint and both product/test TypeScript
  configurations passed.
- `npm run build:workspaces -- --workspace=docx`: the maintained three-workspace
  dependency build closure passed.
- The original safe-bash DOCX registration/I/O files: all 18 tests passed.
- `npx vitest run scripts/docx-exports.test.ts`: both export/browser bundle tests
  passed.
- Root `npm run lint:eslint`, `npm run lint:types` and
  `npm run lint:workflows` passed. ESLint reported zero errors and 12 warnings
  in an unrelated cached QA example.
- Both terminal screenshots were inspected; `git diff --check` passed.

- Root `npm test` completed with exit 0, including declared workspace lifecycle
  tasks and root posttest lint stress checks. The shared Vitest phase passed
  31,014 tests (2 skipped); the shell suite passed 38,076 (823 skipped), and
  SafeJS passed 28,932 (47 skipped). Skipped and undeclared tests are not passes.

All owned files form one atomic grammar/schema improvement, committed locally
on main with hooks enabled. No push or release is authorized.
No native reference build, product network access, external acquisition, model
API conformance, rendered document fidelity or published release is claimed.
