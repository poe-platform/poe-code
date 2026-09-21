# Split and template expansion verification

The TypeScript ESM `ssconvert` engine uses
`packages/ssconvert/src/conversion/split.ts` for per-sheet and identity-bearing
graph artifact filenames. The existing explicit Safe Bash virtual command uses
the same SDK engine, byte capabilities, cancellation and VFS publication path.
No native product dependency or fallback was introduced. No README, export,
publication or unrelated implementation changes were made for this task.

## Reference identity

The existing primary archive in `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz`
was authenticated in this run: SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The inspected source `src/ssconvert.c` hashes to
`0d600c72a05645e6940730bf6e733636ec25f814c20a218cb5e5255da5b198df`.
Expectations derive from `resolve_template`, `export_objects_for_sheet`, and
`do_split_save`. Primary sources remain only in out.

The retained dependency/plugin/locale snapshot is
`sheet-selection-and-range-profile.json`: native binary SHA-256
`d7b57fbb10a99097326d381f6e8c6ab9150092fca78cd03d7f41e5c968d64e82`,
GOffice source SHA-256
`558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`,
LC_ALL/LANG=C, TZ=UTC, captured importers/exporters and dependency versions.
This is an existing captured reference, not a fresh oracle measurement.
`docker ps` failed because the daemon socket was unavailable; no fresh native
differential or dependency/plugin recapture is claimed.

## Verified behavior

- `-S` and `--export-file-per-sheet` retain common command/SDK selection order,
  including repeated IDs; sheet/range/workbook saver eligibility is checked
  before publication. Temporary first-sheet/focus views preserve caller state.
- Zero-based `%n`, `%s`, `%o`, `%%`, disappearing unknown ASCII substitutions,
  trailing percent, nonrecursive replacement, NUL termination, and appending
  `.%n` after the complete filename when the original has no percent.
- Unicode and path components are retained through URI conversion. Collision
  writes occur sequentially; artifacts and successful output usage retain each
  publication. Prior files survive the first failing sheet save, and no later
  sheet starts. Unauthorized scheme substitution is refused, not sanitized.
- Renderers emitting `sheet` (workbook sheet ID) and optional `objectName`
  delegate native filenames to the engine. The emitted index advances even on
  failure. Known graph file errors produce `Failed to write URI: DETAIL`,
  continue objects on that sheet, and skip later sheets with exit status 1.
- Graph cancellation preserves exact reason identity and closes the async
  renderer. Resource-limit errors remain fatal. Failed graph publication bytes
  reserve budget because the capability may already have written partial data;
  result artifacts/output usage count successful publications.

The NUL and graph-name cases were red before implementation. The independent
agent supplied red graph-continuation and failed-write-budget regressions before
their repairs. All file fixtures are original, tiny and in memfs; unit tests do
not invoke native tools, query LLMs or create host files.

## Remaining mismatches and unmeasured cases

- URI-only legacy renderer artifacts retain renderer-owned filenames and cannot
  establish native sheet/object naming or sheet-boundary failure behavior.
  Renderers must emit identities for the newly verified path.
- Native graph traversal sorts objects by anchor. The rendering capability
  supplies its iteration order; native anchor sorting, graph selection/focus,
  actual image rendering and renderer-internal failures are not qualified here.
- Unknown multibyte substitutions consume one native UTF-8 byte versus one JS
  code unit; native invalid-UTF-8 URI behavior remains unmeasured. Non-UTF-8 CLI
  names remain explicitly unsupported, not silently converted into passes.
- The denied HTTPS mapping is an intentional capability divergence from an
  unrestricted native invocation. Real-root containment, S3/WebDAV/remote URI
  escaping, platform-specific unsafe names, symlink/race policy and failed graph
  partial-file effects need separate provider/oracle qualification.
- An actual virtual-command screenshot was inspected. ASCII names and status
  were readable; the screenshot font showed a missing glyph for the Unicode
  name. File bytes/names were verified by memfs assertions; this is not Unicode
  terminal-font acceptance or native rendering parity.
- Safe Bash's maintained typecheck exited 2 before consumer checks:
  `Public SafeFS must preserve shared SafeJS runtime identity`, expected root
  export `./packages/safe-js/dist/safe-fs.js`, actual undefined. No consumers ran.
  The existing unrelated root export work was preserved; this gate is not a pass.

## Checks

- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`:
  exit 0; maintained dependency closure built office-package, safe-fs, ssconvert.
- `npm test --workspace=@poe-code/ssconvert`: exit 0; 235 files, 5,311 tests.
  Direct package tests execute freshly without shared task-cache admission.
- `npm run lint --workspace=@poe-code/ssconvert`: exit 0; ESLint and both
  source/test TypeScript checks, independently rerun after the final repairs.
- `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts`:
  exit 0; 56 tests, including the identity-bearing graph virtual-command case.
- Scoped Safe Bash ESLint for `tests/commands/ssconvert.test.ts`: exit 0.
- Independent post-repair split/lifecycle run: 34/34 cases pass.
- `npm run typecheck --workspace=@poe-platform/safe-bash`: exit 2; the
  pre-consumer export assertion described above failed. It is not waived.
- `git diff --check`: exit 0. This does not inspect pre-existing untracked
  files as a staged patch; it is only a whitespace check, not a delivery gate.
- Actual virtual-command screenshot inspected via the maintained generic
  screenshot route (`npm run screenshot -- --output out/ssconvert-split-visual.png
  node --import tsx out/ssconvert-split-visual.ts`). The root poe-code launcher
  does not expose this opt-in virtual command. Owned script/image scratch was
  purged after reduction; existing oracle sources/evidence were preserved.

No local commit, push, remote-main verification or release was performed.
