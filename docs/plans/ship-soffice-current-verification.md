# ship-soffice current candidate verification

Executed on 2026-09-20 against the working tree; unrelated edits preserved.
The requested package pattern is currently in
[archive/safe-bash-command-package-pattern.md](archive/safe-bash-command-package-pattern.md).
Existing command README and Safe Bash usage/support documentation already cover
commands, SDK examples, exact flags, limits, byte outputs and runtime profile.
This review adds a README warning about shell redirects: the existing Shell
integration case proves that redirecting onto a source alias truncates it before
conversion admission fails. No runtime or shared infrastructure changed.

## Executed Markdown QA

1. Inspect private manifest, argument/SDK execution, capabilities, budget cleanup,
   CSV primitives, public composition facade and packaging pattern.
2. Run `npm test --workspace=safe-bash-command-soffice` and
   `npm run lint --workspace=safe-bash-command-soffice`.
3. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`, then
   `node --import tsx --test packages/safe-bash/tests/plugins/soffice-wiring.test.ts`.
4. Stage with `node scripts/package-safe.mjs --out-dir
   out/ship-soffice-current/stage --version 0.0.0-ship-soffice-current`.
   Pack only staged public SafeFS, SafeJS and Safe Bash with scripts disabled.
   Install offline outside the checkout with scripts, workspaces, optional
   dependencies and peer auto-installation disabled. Verify no private command
   or contracts package appears in the installed lockfile.
5. Execute maintained soffice runtime and strict declaration fixtures under
   default/browser/workerd conditions. Compile with NodeNext, ES2023, strict,
   exact optional properties and unchecked indexed access, without skipLibCheck.
6. AST-scan installed Safe Bash JS/declarations for private static, dynamic,
   require and import-type references. Inspect public subpath targets.
7. Bundle public soffice with esbuild browser platform and browser/workerd
   conditions. Inspect every graph input and execute event-ordering/capability
   and fixed CSV-byte witnesses in VM realms without ambient host globals.
8. Execute both README examples verbatim against the installed artifact;
   check task whitespace and remove task evidence and temporary consumers.

## Results

Package unit route: 62 passed; Shell integration: four passed. No test failures,
skips or cancellations. ESLint and production/test TypeScript checks passed.
Maintained selected workspace build closure and npm postbuild passed with shared
cache enabled; membership/dependencies came from maintained declarations.

Isolated installed runtime and strict declaration fixtures passed in all three
condition profiles without private workspace packages installed. Public runtime
and declaration targets are `./dist/safe-bash/commands/soffice/index.js` and
`./dist/safe-bash/commands/soffice/index.d.ts`. AST inspection of 1,325 installed
JS/declaration files found no private command/contracts module reference.
Both browser-platform conditional bundles passed VM execution; each had 55
inputs, limited to first-party Safe Bash/SafeFS and the synthetic entry point.
Both README examples ran verbatim against the isolated installed candidate.
CSV produced the specified LF-ended quoted text with inert formula-like cells.
Task whitespace checks passed; temporary consumers and task evidence were purged.

The package remains `safe-bash-command-soffice`, private, ESM, with empty runtime
dependencies; Safe Bash only re-exports it. The aggregate Safe Bash artifact has
its own dependency contracts; leaf dependency claims do not apply to that aggregate.

Temporary harness failures were investigated separately from product checks:
esbuild's synthetic entry point has no disk file, so graph inspection must admit
that exact synthetic path; esbuild rewrites bare `typeof require` to its internal
helper, so negative ambient-authority checks inspect `globalThis` properties.
No product source, test, timeout or maintained route changed to address these.

Candidate public tarball SHA256:

| Artifact | SHA256 |
| --- | --- |
| Safe Bash | `cd69c4b283212e787376df6934a30d04fddb3af6e0555b8a73603e6ee1b820b3` |
| SafeFS | `8abad196c8ca667320a54d233c3e5c6d04a375397d029c1fa11cb847fc0eeff3` |
| SafeJS | `b4dd5935485cbcdf27c99c13298e6b7705123bc0c115f3013c7de8b4177335c4` |

## Unverified and unsupported

Actual browser/workerd engines, Bun, original/checkpoint/replay execution and
native Office conversion were not exercised. Condition checks and VM realms
qualify the scoped graph, not those runtime engines. No execution/replay behavior
changed. Office conversion, workbook import/formulas, layout, pagination/shaping,
notes/slides, PDF/A and PDF/UA remain unsupported; all capability flags are false.
No fonts, host executables, fallback engines or dependency downloads were added.

Source compatibility remains pinned to LibreOffice/core
`d17755172ac96e54e3f10f35dd1b1680f0ef84bd`, separate from installed manifest
26.8.0.3. Supplied native attempts stopped before main in dyld; no native parity,
exit mapping, rendering geometry or standards compliance is inferred.

Full repository gates were not run for this documentation-only change. No CLI
appearance or document rendering changed, so screenshots were not applicable.
`/out` creation failed because the host filesystem is read-only; temporary
artifacts used ignored `out/ship-soffice-current` instead.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No package was published; the private command was not independently packed.
