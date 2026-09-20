# ExifTool command wiring review

Status: incomplete. Reviewed the current worktree on 2026-09-18; unrelated
contributor changes were preserved. This review does not close the full task.

The existing implementation belongs to the private TypeScript ESM workspace
`safe-bash-command-exiftool`, with no external runtime dependencies. Its actual
CommandDefinition and opt-in plugin are exposed through
`@poe-platform/safe-bash/commands/exiftool`. Safe-bash only re-exports them and
does not change default registration. The qualified private-workspace build and
artifact routes include implementation and declarations, preserving canonical
contract identity without requiring an unpublished consumer dependency.

## Validated correction

Two original failing memory-VFS tests reproduced unaccounted operand and output
destination path scratch allocation. Separator-only operands reached VFS lstat
before retained-budget rejection; output destinations completed parsing without
the expected rejection. Argument-file normalization already had admission.

The command now uses one substantive literal-path resolver for operands,
destinations and argument files. It admits decoded/retained/work extents before
component splitting, including inputs with tiny normalized results. Regression
tests prove refusal before operand acquisition and before output publication,
with unchanged source bytes and no backup/staging files. The helper replaces
duplicated normalization logic; it is not a proxy. No manifest or public API
change, new dependency, host capability or registry-version change was needed.

## Current verification

- All 89 command-package memory tests pass with no skips; package ESLint and
  source/test typechecks pass.
- The maintained selected safe-bash workspace build closure passes, including
  all 12 declared build tasks. All 356 guarded builder tests and 144 artifact
  tests pass. The actual Shell integration passes pipelines, stdin, VFS scripts,
  argument files, editing and lexical JSON controls.
- Final generated safe-bash and safe-fs artifacts were copied into a consumer.
  Public imports share command runtime identity; writes preserve exact original
  backups, typed SDK extraction retains `1e999` as text and JSON emits its lexical
  numeric spelling. A strict NodeNext declaration consumer passes without
  skipLibCheck. No bare private command/contracts import was found in the
  generated JS/declaration tree. This consumer is inside repository out, not a
  renewed fully isolated consumer or browser/workerd qualification.
- The generic maintained screenshot route captured the generated consumer;
  visual inspection confirms aligned tag presentation and legible JSON/errors.
  No screenshot tests were added.

## Unresolved findings that block completion

An executed consumer control confirms that Shell reports command resource
exhaustion as `shell: line 1: internal error`, while the direct command SDK
throws the specific ResourceLimitError. Both refuse the operation, but their
observable diagnostic/result behavior differs. The regression tests deliberately
preserve the existing throwing SDK contract. The manual consumer's initial
expectation of specific Shell stderr failed; recording the observed generic
diagnostic is not acceptance of diagnostic parity. Resolving this requires a
reviewed public failure policy and corresponding Shell/SDK tests.

The current implementation only admits selected PNG text/time behavior. The
required PDF parser and reversible incremental writer, namespace-aware XMP,
EXIF/TIFF/JPEG, Office property readers, complete declarative catalog, imports,
scanning, execute/stay_open protocol, native all-files-fail-if status2 behavior
and remaining format/publication acceptance controls are unfinished. Unsupported
options are generally explicit errors, but that does not implement native
semantics. The existing E01–E24 gates remain open. Earlier broad-suite failures
recorded in safe-bash-exiftool-implementation.md are not cleared by these focused
checks. No fresh full root test/lint/build gate is claimed.

Filesystem-root `/out` is read-only: an attempted task-directory creation fails
with `Read-only file system`. Task-owned artifacts, drivers and screenshot used
repository `out/` and were purged after recording evidence. No local commit,
push, verified remote-main delivery, release or command publication is claimed.

## Typed SDK follow-up

The private command now exports `createExiftoolArguments` and
`ExiftoolInvocationOptions` through the existing public facade. Typed options
cover the admitted CLI presentation, selectors, ordered assignments and
publication controls. The returned carrier preserves canonical argument brands
and its paired args identity. Operands follow `--`, so dash-prefixed VFS paths
cannot become assignments, configuration or argument-file directives. Construction
requires an explicit signal and independently accounts decoded, retained and work
extents before string joining and canonical carrier allocation. It is a separate
bounded operation, not a shared execution budget or a new parser engine.

TDD first reproduced the missing SDK API, then a negative control reproduced
silently ignored unknown SDK options. Unknown own keys now fail explicitly.
Tests also reject tag-name injection, unsupported combinations, cancelled
construction and oversized assignment/argument input. These additions preserve
the existing throwing resource-failure policy; diagnostic parity remains open.

### Manual acceptance steps and executed results

1. Run `npm run lint --workspace=safe-bash-command-exiftool` and
   `npm run test:unit --workspace=safe-bash-command-exiftool`. ESLint and both
   source/test typechecks pass; all 92 memory tests pass with zero skips.
2. Run the maintained selected build:
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
   The final source candidate passes all 12 declared build tasks. The guarded
   builder suite passes all 356 tests; artifact tests pass all 144 tests.
3. Generate libraries with `scripts/package-safe.mjs` into a fresh task-owned
   out directory. Copy generated safe-bash/safe-fs artifacts and only their
   declared public dependency closure into a fresh consumer. Execute with an
   ESM loader that rejects any file import outside that consumer. Do not
   install or allow private workspace imports. This passes for the final
   candidate; it tests generated artifacts, not a renewed npm tarball install.
4. Independently add a CRC-correct tEXt `Title` containing `1e999` to the
   documented one-pixel PNG, preserving its image chunks. Store it at `/-@`.
   Compare typed SDK JSONQ against literal CLI argv exactly: status0, empty
   stderr and quoted `1e999`. Ordinary JSON retains the lexical numeric spelling;
   SDK inspection retains the text. Default typed SDK assignment creates an
   exact original backup and changes the title. Repeated cleanup succeeds.
   Unknown CLI flags and unknown typed SDK keys fail explicitly.
5. Deny host fs read/write/open/stat/lstat/readdir and fetch during consumer
   execution. The memory-VFS controls above still pass. This is an execution
   negative control, not a sandbox or complete import-time authority proof.
   The Shell integration test separately passes stdin, pipeline, VFS scripts,
   argfiles and editing. Strict NodeNext declarations pass without skipLibCheck.
6. Inspect generated JS/d.ts module references: 3,494 references in the initial
   generated candidate contain no private bare import; the command's own
   modules have zero bare external imports. Other safe-bash command families
   retain their declared public dependencies. These are not exiftool runtime
   dependencies. The final artifact consumer independently denies outside imports.
7. Capture the consumer through the maintained generic screenshot route and
   inspect aligned tags, quoted lexical JSON and explicit unsupported-flag output.
   The screenshot is legible. No screenshot tests or design-language changes
   were introduced.

QA setup failures were investigated: the first isolated consumer correctly denied
an uninstalled declared public text-encoding dependency; copying the declared
public closure fixed it. Backup comparison initially differed only by Buffer
versus Uint8Array prototype; byte-for-byte comparison with matching byte-array
types passes. Regenerating into an existing artifact directory correctly refused
EEXIST; final generation used a fresh directory. No product test failures remain
in the executed focused checks.

The broad root test/lint/build routes, browser/workerd cells, native format
matrix and checkpoint/replay cells were not executed in this follow-up. Earlier
broad failures remain unresolved. PDF/XMP/EXIF/Office/import/scan/protocol/catalog
work and the failure-diagnostic parity finding above still block full completion.
No compatibility gate is closed by these focused checks. No local commit, push,
remote-main verification, release or private-package publication was performed.
Task-owned generated consumers, artifacts and screenshots are purged after review.
