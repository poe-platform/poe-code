# ssconvert plugin registration verification

The exact literal `ssconvert` is available in a host-created safe-bash Shell
using `agentCommands()` and `ssconvertCommands(options)`. Conversion stays in
the TypeScript ESM domain engine, shared with `poe-code/ssconvert`. No native
utility is installed, spawned, or used as a product fallback by this adapter.

## Registration decision

Retain explicit host opt-in through `@poe-platform/safe-bash/commands/ssconvert`.
Agents invoke ordinary `ssconvert`; there is no new invocation syntax. The
portable/default command inventory is unchanged. Existing Node root SDK exports
remain available; browser root selection remains the portable core and does not
implicitly enroll ssconvert. Browser execution of the domain engine is unmeasured.

A single Node 22.22.2 measurement imported built core in 268.35 ms with a
27,193,240-byte heap delta, then the plugin in an additional 310.80 ms with a
13,709,144-byte heap delta. This sequential observation includes shared-module
effects and garbage-collection uncertainty; it is not a repeated performance
benchmark. The domain manifest includes pdf-lib/fontkit, jpeg-js, htmlparser2,
office-package, pdf and safe-fs. Those dependencies and required explicit host
budgets/environment favor keeping it out of the portable aggregate.

## Validated repairs

- Actual Shell child dispatch with `replaceEnv: true` exposed configured exports
  and injected PWD. The adapter now forwards exactly the invocation exports.
- Both command and SDK codec contexts dropped stdin provenance. Optional
  `stdinIsDefault` now reaches the actual domain capability context; omitted,
  true and false remain distinct, independently of equal empty input bytes.
- Independent stress reproduced replacement of descriptor bindings after plugin
  creation. The adapter snapshots descriptor records/maps, adapter mappings and
  bound transport hooks/redirect count before invocation.
- The maintained runner's name filter exposed HTTP/TLS test teardown running before
  async fixture acquisition settled. Teardown now awaits the recorded acquisition
  before closing; filtered execution exits cleanly and all four normal HTTP and
  six normal TLS cases pass. No assertion, supported version, timeout or native
  capability was relaxed.

## Verified coverage

- Requested Gnumeric 1.12.61 primary archive is retained only under
  `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz`; its recomputed SHA-256 is
  `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
- `reference-profile.json` captures QA dependency libraries, activated plugins,
  environment/locales, fonts and isolated container bindings. Its incomplete
  status and recorded blockers remain authoritative.
- Domain maintained tests: 304 files, 6,187 tests passed. Domain maintained lint,
  source and test typechecks passed; these scripts execute fresh without a cache.
- Final selected safe-bash workspace build closure with `--no-cache` passed,
  including guarded integration admission, ESM/declaration emit and postbuild.
- Focused diagnostic command run: 110 tests passed across the ssconvert command
  suites, including eight independently authored stress cases.
- Corrected maintained safe-bash command run with `--test-name-pattern=ssconvert`
  completed with status 0 after discovering 1,346 files. The reporter counted
  1,432 passes and zero failures in 676.70 seconds; this includes file wrappers.
  The name filter excludes unrelated behavior and is not full-suite qualification.
- Maintained runner checks: 558 tests passed, including exact literal discovery
  registration of the new independent stress test. Historical seals were retained.
- Final guarded root ESLint completed after the fixture repairs with status 0,
  zero errors and four existing warnings; 17,034 subjects were linted with complete
  receipt accounting. The earlier guarded run also passed.
- Standalone package metadata/export tests passed. Built public package imports
  executed `ssconvert --version` with status 0, expected version/path diagnostics
  on stdout and empty stderr; SDK `createEngine` resolved through its root subpath.
- Browser-condition root import selected portable core without ssconvert.
- Virtual `ssconvert --help` screenshot was captured and visually inspected:
  aligned option descriptions, ordinary literal command syntax, no runtime error.

## Remaining qualification

This registration work does not establish complete Gnumeric 1.12.61 parity.
The existing reference profile's unsupported/unmeasured features, arbitrary
native plugins, dependency-specific locales/encodings, remote adapter deployment,
rendering and browser domain execution remain outside verified coverage. Unit
tests use original in-memory fixtures/memfs and injected capabilities, not native
oracles, files on disk or LLM calls. Binding records are snapshotted; injected
capability implementations and descriptor producers retain their own documented
ownership and cooperation contracts.

The first filtered maintained shell run was incomplete: it exposed the HTTP
cleanup failure/leaked acquisition and was interrupted to release its test children.
The corrected maintained command run passed and is tracked separately from the
successful focused runs. No full repository unit/E2E or native differential run
was performed in this registration task; those scopes are not passes.

Maintained safe-bash typecheck is blocked before consumer/runtime checks:
`Public SafeFS must preserve shared SafeJS runtime identity` expects the root
`./safe-fs` export import to equal `./packages/safe-js/dist/safe-fs.js`, but the
current root manifest has no such export. The guard is retained unchanged; no
consumer groups or runtime executions were verified by that failed route. This
is a current concrete integration mismatch, not a passing typecheck or authority
to bypass shared namespace identity.

No README edits, commits, pushes, releases or publication were performed.
