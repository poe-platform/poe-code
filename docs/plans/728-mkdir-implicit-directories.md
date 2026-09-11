# Issue 728: materialize implicit directories with mkdir -p

## Validated failure

The live issue by `kamilio` reports that a successful `mkdir -p` on Poe's implicit
directory leaves no explicit directory metadata. Removing its last descendant
then makes the directory disappear. Current `createDirectory` returned before
calling the adapter whenever `-p` observed an existing directory.

The regression uses a small wrapper around the existing memory filesystem.
Unmarked directory prefixes disappear when their last child is removed; recursive
adapter mkdir records explicit parents, which persist without children. A control
verifies that unmaterialized prefixes disappear while explicit directories remain.
The command test performs mkdir, removes the last child, then checks `test -d`.
No host files, real services or synthetic FileStat implicit-entry field are used.

Before the runtime change, the expanded existing filesystem test file reported
49 tests: 17 passed, 32 failed. The persistence regression reproduced `test -d`
returning 1 after successful mkdir. After the change, all 49 pass with zero skips.

## Minimal command change

- For an existing directory under `-p`, query `capabilitiesFor` for that path when
  available; otherwise use global capabilities. Materialize only when the selected
  profile explicitly advertises `implicitDirectories: true`. A global false or
  absent flag cannot override a true path-scoped flag.
- Fall through the existing `admitFilesystemModes` and preflight/execution flow.
  Preserve global read-only precedence and all-operand capability preflight;
  preflight never calls adapter mkdir, execution calls it once per operand.
- Do not forward `-m` for an already observed directory or emit a verbose creation
  message for it. This also avoids forwarding unsupported mode options and keeps
  existing explicit directories and symlink targets unchanged.
- Retain absent-directory modes and verbose output, non-`-p`/file `EEXIST`, ordinary
  per-operand errors, and original falsey cancellation reasons.

No new runtime helper or adapter implementation is introduced. The test adapter
models Poe's stated materializing contract. The bundled S3 adapter has its own
early return for an implicit lookup; that separate backend behavior is **not fixed
or qualified** by this command patch. No S3 production changes are included.

## Verification

Worker logs, captured with real subtests outside the execution sandbox:

- `/home/kjopek/poe-723-724-tmp/728-filesystem-red.log`
- `/home/kjopek/poe-723-724-tmp/728-filesystem-green.log`
- `/home/kjopek/poe-723-724-tmp/728-filesystem-regressions.log`
- `/home/kjopek/poe-723-724-tmp/728-source-typecheck.log`

Focused checks pass all 241 tests with zero skips, covering filesystem commands,
capability requirements, independent filesystem behavior, recursive admission
and filesystem output. The maintained source/tests typecheck exits zero using
`node scripts/historical-type-models.mjs --noEmit` in `packages/safe-bash`.
No worker build or dist mutation was performed.

### Root-owned native and public validation

Root's ad-hoc GNU mkdir 8.30 observations confirm that an existing directory or
symlink to it under `-pv -m700` succeeds with empty stdout/stderr and unchanged
mode 0755. A missing directory is created with mode 0700 and a verbose message;
an existing file fails with status 1 and no stdout. These native observations do
not make claims about object-store persistence and are not live unit tests.

Root owns `scripts/fixtures/safe-packages-mkdir.mjs` and its smoke/browser imports.
The portable public regression requires exactly one recursive adapter call for
an existing implicit directory, no mode argument, no output and unchanged mode.
Root captured the public red result in `/tmp/poe-728-public-red.log`: one selected
case failed; 30 unselected cases were not passes. Root coordinates subsequent
Node and Bun packed-public smoke checks, browser VM fixture execution, native
comparison review and screenshot inspection against the built candidate.
Root validation now passes the normal workspace build, virtual-bash typecheck,
repository type-contract lint, all 17 package lint rules, and guarded repository
ESLint (11,459 configured files; zero errors or warnings). The public bundle and
packaging tests pass all 33 cases. Isolated locally packed consumers pass Node,
Bun, TypeScript and bundled-browser checks, including the new mkdir fixture.
Logs are `/tmp/poe-728-build.log`, `/tmp/poe-728-types.log`,
`/tmp/poe-728-package-lint.log`, `/tmp/poe-728-eslint.log`,
`/tmp/poe-728-public-green.log`, and `/tmp/poe-728-packed.log`.

Root inspected `/tmp/poe-728-mkdir.png`: an ad-hoc memory-backed implicit adapter
shows silent existing-directory materialization, successful last-child removal
and `test -d`, retained new-directory verbose output, and file-collision failure.
The screenshot is visual validation, not a committed screenshot test.
Remote delivery and publication remain separate from these local checks.

## Ownership

Worker edits are limited to `packages/safe-bash/src/commands/filesystem.ts`, the
existing `packages/safe-bash/tests/commands/filesystem.test.ts`, and this plan.
No new test inventory, README edits, Git actions or release claims. Root owns
normal builds, guarded lint, remaining maintained types/public validation,
commits, push, issue closure and release monitoring.
