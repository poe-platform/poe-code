# ship-csvgrep packed export verification

Executed against the dirty working candidate on 2026-09-20, based on HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`. This verifies local packaging;
it is not a release or full csvkit compatibility receipt. Preserved unrelated
changes, including the package-pattern move to
[its archived location](archive/safe-bash-command-package-pattern.md).

## Capabilities and ownership

`packages/safe-bash-command-csvgrep` remains `safe-bash-command-csvgrep`,
`private: true`, TypeScript ESM, with empty runtime dependencies. Command,
matching, VFS/stream lifecycle and limits live in the command workspace and its
private CSV engine; safe-bash's csvgrep entry only exports the workspace API.
Registration is opt-in. No runtime repair was validated or made in this task.

Updated the package README with exact short/long flags, examples, numeric default
quotas, SDK results, cancellation, VFS confinement responsibility and versioned
CSV/regex limitations. Updated safe-bash's existing support row with those
profiles' boundary. No product CLI or document-rendering behavior changed.

Full Python grammar, Sniffer, other codecs, quoting 1/2, open ranges, native
field-size units and csvkit file-iteration NUL behavior remain unqualified or
explicitly unsupported. The independent grammar/error/chunk/cancellation matrix
in [the acceptance document](safe-bash-csvgrep-acceptance.md) remains authoritative;
passing the implemented subset does not close those cells. Pinned source targets
are csvkit `194c904256a09dc203c460944d35e9d414244503` and agate
`34856488cfcbe9077af8e3e557cbf98a044fdd64`; native release research is
csvkit 2.2.0 / agate 1.14.2 / Python 3.9, not later source behavior.
No native executable or held XAN source was used.

## Executed Markdown QA

1. Inspect manifests, entry points, implementation, README and archived package
   pattern. Production command/matcher/CSV engine contain no host imports,
   fetch, process access, dynamic import or WASM fallback. VFS containment is
   delegated to the supplied provider, not inferred from lexical paths.
2. Run `npm run test:unit --workspace=safe-bash-command-csvgrep`: 55 passed,
   no failures/skips. Existing independent controls cover aggregate precedence,
   Unicode matching/stripping, malformed/unsupported patterns, short rows,
   physical numbering, byte splits, quotas, producer ownership and cleanup.
3. Run `npm run lint --workspace=safe-bash-command-csvgrep`: ESLint and both
   typecheck configurations passed.
4. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`:
   maintained selected dependency build closure and native postbuild passed,
   using the shared cache route. This is not a fresh full-repository build.
5. Run `npm run test:unit --workspace=safe-bash-csv-engine`: 9 passed,
   no failures/skips, including byte splits, selectors and writer controls.
6. Stage with `node scripts/package-safe.mjs --out-dir out/ship-csvgrep/stage
   --version 0.0.0-ship-csvgrep`, then `npm pack --ignore-scripts` each of the
   staged SafeFS, SafeJS and SafeBash public packages. Passed.
7. Offline-install only those public tarballs, with scripts disabled, into a
   fresh OS temporary consumer outside the checkout. Passed; inspected lock
   membership and confirmed no private command/contracts/CSV engine workspace
   installation. Public artifact dependencies are still installed normally.
8. Copy and execute maintained `safe-packages-private-command.mjs` under Node,
   `--conditions=browser` and `--conditions=workerd`: all passed. Includes real
   csvgrep CLI/SDK equality, canonical runtime identity, producer ownership,
   explicit unsupported regex and missing-file handling.
9. Compile maintained `safe-packages-csvgrep-types.mts` with strict ES2023
   NodeNext, exact optional properties and unchecked indexed access, with no
   custom condition and each browser/workerd `--customConditions`: all passed.
10. Bundle the installed private-command fixture with esbuild's browser platform
    and each browser/workerd condition; execute in separate Node VM realms with
    explicit web capabilities and without Buffer/process/require: both passed.
    An initial bundle attempt ran before fixture copying completed and failed
    entry resolution; after install/copy completion the sequential checks passed.
11. Run `git diff --check` on the changed safe-bash README: passed.

Packed csvgrep targets are `./dist/safe-bash/commands/csvgrep/index.js` and
`./dist/safe-bash/commands/csvgrep/index.d.ts`. Private implementation and
declarations resolve within the public artifact. Tarball SHA256 receipts:

- SafeBash: `4670e942a535e43d77c71889b91d26792bb1ea774adb0b5c3d77708b981c8909`
- SafeFS: `7ceb6e85462f5c1704ebf0db6e831d862c4ab002e2f383b39640afe898a9f7cb`
- SafeJS: `236be5f1bddb668962d0932f8da50a6ad6862f961bce42fa29613fa38dde6ec3`

Implementation SHA256 receipts:

- Command: `7b0370aaa991537c4cfbd9f3cde8fb35cef744ec8d0fcda0672d0bd24f2b8143`
- Matcher: `693ce7c7b2e2881c872e29c3051f58da5fa6752b3b96dbf1649d4e5430b3e406`
- CSV engine: `c003d6102507cab752151b724d56d9adc970b51b2a5a2e8fe913ef281d484ca2`

Actual browser/workerd engines, exhaustive compatibility and checkpoint/replay
execution were not qualified. These are conditional graph checks. The complete
safe-bash artifact still declares external dependencies (including pako,
@noble/hashes, @kayahr/text-encoding and jsonc-parser); no whole-artifact
zero-dependency claim is made. No shared code/infrastructure changed, so full
repository routes were not run. CLI screenshots and generated-document
screenshots were not applicable because this task changed capability copy only,
without changing visible CLI output or a document renderer.

`/out` is read-only on this host. Used ignored `out/ship-csvgrep` and an external
temporary consumer instead; both task-owned directories were purged after QA.

## Delivery

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private package or public artifact was published.
