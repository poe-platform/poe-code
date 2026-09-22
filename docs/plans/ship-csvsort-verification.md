# ship-csvsort verification

Inspected the working candidate on 2026-09-20. This is an audit/documentation
receipt, not acceptance of a CSV command or a release. The requested package
pattern was moved by unrelated work to
[its archived location](archive/safe-bash-command-package-pattern.md); that move
was preserved.

## Capabilities and documentation

`packages/safe-bash-command-csvsort` is named `safe-bash-command-csvsort`, private,
TypeScript ESM, with empty runtime dependencies. Its source exports only
`sortRecords`, `CsvSortError`, `SortKey`, `SortRecord` and `SortLimits`. It has no
CSV parser, selector, inference, serializer, CommandDefinition, VFS/stream SDK
or invocation cleanup adapter. No csvsort export/dependency is declared in the
safe-bash manifest. The [wiring prerequisite findings](safe-bash-csvsort-wiring-prerequisites.md)
still apply; no held XAN sources were read or imported.

Updated the command README with a runnable admitted-record example, exact SDK
option, required quotas, outputs/errors and runtime profile. It explicitly says
there are no supported command flags and distinguishes exact integer ordering
from native precision-28 inference. Added the unavailable-command boundary to
safe-bash's existing support/usage section, preserving unrelated edits.

The prompt's native research profiles remain compatibility requirements, not
implemented capabilities. Full grammar, inference, temporal clocks/locales,
QUOTE_NONNUMERIC float provenance, byte-stream chunk/error/cancellation and
CLI/SDK command controls cannot be qualified by this sorter alone. No runtime
repair was validated or made. No placeholder command or sorter-only public
subpath was introduced to imply command acceptance.

## Executed Markdown QA

1. Inspect source exports, manifest and package pattern without opening held paths.
   Confirmed the capability boundary above.
2. Run `npm run test:unit --workspace=safe-bash-command-csvsort`: 21 passed,
   zero failures/skips. These are admitted-record controls, not full CSV controls.
3. Run `npm run lint --workspace=safe-bash-command-csvsort`: passed ESLint and
   both package typecheck configurations.
4. Run `npm run build:workspaces -- --workspace=safe-bash-command-csvsort`:
   passed the maintained selected workspace build closure.
5. Execute the README example against `dist/index.js`: payload order was
   `two\n`, then `ten\n`, as documented.
6. Stage with `node scripts/package-safe.mjs --out-dir out/ship-csvsort/stage
   --version 0.0.0-ship-csvsort`; npm-pack each of the three staged public packages
   with scripts disabled. Staging and packing passed using existing built inputs;
   this was not a fresh full safe-bash build qualification.
7. Install only these public tarballs offline, with scripts disabled, in a fresh
   OS temporary consumer outside the checkout. Initial safe-bash-only install
   rejected the local-version SafeFS dependency; supplying the staged public
   SafeFS/SafeJS tarballs resolved that setup failure. No private command
   workspace packages were installed.
8. Inspect the packed manifest: `./commands/csvsort` absent. Import the requested
   subpath under Node, `--conditions=browser`, and `--conditions=workerd`:
   all exit 1 with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Compile a strict ES2022
   NodeNext `.mts` consumer: exit 2, TS2307 for the csvsort subpath/declarations.
   These are concrete negative results, not passing packed export acceptance.
9. Run `git diff --check` for the modified safe-bash README: passed.

No runtime/build infrastructure was changed; full repository routes were not
run for this documentation-only task. No visible CLI behavior changed and no
csvsort command exists, so CLI screenshots were not taken. Generated-document
rendering was not exercised; document screenshot qualification remains unrun.
Actual browser/workerd engines were not run. Export-condition rejection does
not qualify those engines or prove whole-artifact dependency/isolation claims.

`/out` could not be created (read-only filesystem). Temporary staging/tarballs
used ignored `out/ship-csvsort`; that task-owned directory and the external
consumer were removed after recording the results.

## Delivery

Requested packed runtime/type acceptance is incomplete because the command and
export are absent. Required parser/inference and real adapter acceptance must
precede successful installed command checks. This audit does not implement those
prerequisites or reduce their compatibility requirements.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. Neither the private package nor any public artifact was published.

## Independent task review and fresh recheck

Rechecked the live working tree on 2026-09-20, preserving existing package,
README and integration edits. Reviewed all five csvsort source/test files for
unnecessary abstractions, proxy-only functions, duplicated logic, host access,
ordering, failure paths, quotas, cancellation and payload/key ownership. No
concrete sorter defect or test-supported simplification was identified. The
entry point is a static export; the iterative sorter has invocation-local state.
Production files contain no host imports, ambient clock, network or dynamic
loader. Tests use in-memory records, without native controls or fixture files.
This review covers only the admitted-record stage, not unavailable CSV behavior.

Fresh maintained package unit checks passed all 21 tests without skips. Package
lint passed ESLint and both typecheck configurations. The selected maintained
`build:workspaces -- --workspace=safe-bash-command-csvsort` closure passed.
No code, shared infrastructure, CLI appearance or document renderer was changed;
repository-wide routes and screenshot checks were not run for this recheck.

Fresh staging used version `0.0.0-ship-csvsort-recheck` and existing public-package
built inputs. Packed the three public packages with scripts disabled, then
installed those tarballs offline into a new consumer outside the checkout.
No private command/contracts workspace was installed. The csvsort import failed
with exit 1 and `ERR_PACKAGE_PATH_NOT_EXPORTED` under Node, browser and workerd
export conditions. A strict ES2022 NodeNext declaration consumer failed with
exit 2 and TS2307 for the same subpath. These negative condition probes do not
qualify actual browser/workerd engines. Task-owned `out/ship-csvsort-recheck`
staging/tarballs and the external consumer were purged after inspection.

Completion remains blocked by the missing CSV command/SDK, parser, selectors,
inference, serializer, stream/VFS invocation lifecycle and public packed
runtime/declaration export. The supplied native grammar/type/temporal controls
remain unqualified; these 21 tests do not establish CSV compatibility. Existing
capability documentation accurately describes this boundary. No placeholder
command, reduced compatibility profile or unrelated repair was added. Local
commits: none; verified remote-main delivery: none; successful releases: none.
Nothing was published.

## Current packed-export verification

Executed the Markdown QA steps above again against the live candidate based on
HEAD `35d01c57f8078d8afa916dc59929395d857e9c55`. This is a dirty working-tree
verification, not verification of that committed revision. Source SHA256 values:

- `src/index.ts`: `e8e50e0eec43c7e915543be366b2c14778c53cfbcd337493a06a26a8c57893b8`
- `src/sort.ts`: `8ed7d7843c6b43adab89945f84617eea68b090bf002a241e658d541da67bf2cb`
- safe-bash manifest: `0922427f5c994d4663e1336c778871d5be7dfa9aabb8f0cbea848c69b8df8d5c`

Maintained command unit route: 21 passes, zero failures/skips. Package lint,
including both typecheck configurations, and the selected maintained workspace
build closure passed. Existing user documentation matches these capabilities;
no code or documentation capability claims needed changing.

Staging version `0.0.0-ship-csvsort-current` passed using existing public-package
build outputs. Packed all three public packages with scripts disabled; offline
installation into a fresh external temporary consumer passed without the private
csvsort workspace installed. Packed manifest lacks `./commands/csvsort`.
Independent imports under Node, browser and workerd export conditions each
failed with status 1 / `ERR_PACKAGE_PATH_NOT_EXPORTED`. Strict ES2022 NodeNext
consumer compilation failed with status 2 / TS2307 for the requested subpath.
These are acceptance failures, not successful conditional-runtime coverage.

CSV compatibility, CLI/SDK command equivalence, invocation cleanup, original/
checkpoint/replay command execution and actual browser/workerd engine cells
remain unverified because the required command API does not exist. Full
repository gates were not run for this receipt-only change. No visible CLI or
rendering change was made; screenshots were not applicable to this change.
Task-owned staging, tarballs and the external consumer were removed. Unrelated
edits were preserved. No commits, remote-main delivery, release or publication.
