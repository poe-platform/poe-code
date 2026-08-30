# Independent SafeJS cleanup capability-surface review

August 27, 2026. **No privileged `CommandContext.registerCleanup` exposure was
observed in the bounded supported-facade probes below.** This is not a universal
non-leak, whole-engine security, replay, or project-completion claim. No product,
contract, runtime, export, environment-plugin, or private-engine source changed.
No delegation occurred. The sibling SafeJS → Shell → grep cleanup workflow was
not duplicated; the only standalone shell-result command here is `true`.

## Frozen identities

| Input | Identity |
| --- | --- |
| Public product | `f44958bf48778737a58535e2bc9b37c292ac28c4` |
| Full committed tree | `b56256393025d5f0cf0d2b33c05bd5d5f39ac608`, 15,798 tracked entries |
| Complete `git archive` SHA-256 | `d942398b277a621b82b98dbaab267291ac4dc7b613f884b617650357964989bd` |
| Built public package SHA-256 | `1a757856aff57daa1fd3e5c40f4e011b1bb1ec43877f2fd5c8b6fae7f8e3ff5e` |
| Current private HEAD | `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e` |
| Corrected cases SHA-256 | `112d5b0630eb3caa01d88aca88804d36a290f14dd0a162c34bf08e6c545a41d7` |

`bb23ec2` does not resolve in the public repository; it **does** resolve in the
read-only private repository and is its actual current HEAD. This independently
confirms the private identity reported by the earlier `ef1699b` evidence, rather
than assuming that a public Git lookup disproves it. The candidate includes the
cleanup contract from `07acb1a` and runtime cleanup implementation `4c16d9c`.

Both attempts build the **complete committed archive**, without a live source
overlay, using its unchanged `npm run build`. `npm pack --offline --ignore-scripts`
produces identical package bytes in both attempts. Tar extraction into an isolated
consumer's regular `node_modules/virtual-bash` directory avoids dependency
installation. The child imports **`virtual-bash` through its actual package
exports**, resolving `dist/index.js`; 164 loaded public JS files are hash-audited.
The archive's source, package manifest, barrels, lockfile and TypeScript configs
remain unchanged. Runtime package dependencies remain empty.

### Engine provenance and tooling

This is a **public-product / explicit current-source-hook injection run**, not a
claim that the private engine package was installed or imported through its own
published exports. The injected `run`, `Budget`, `makeFsModule` and
`declareHostOperation` come from their actual source-definition modules; those
names are exported by the inspected private `src/index.ts`. Existing private
`dist` exists but was not executed or assumed current. No upstream proposal is used.

All 264 regular engine package files outside `.git`, `node_modules`, `dist`,
`.cache` and `.turbo` are copied unchanged into a fresh owned `/tmp` tree. There
are 63 **actually loaded** engine source files, each matched by SHA-256 to both
the copy inventory and private before/after inventory. No private source bytes
are archived in this repository. Private HEAD, index hash, porcelain status,
selected metadata (including AGENTS and gitignore), and the entire copied-source
inventory match before and after **each** attempt. Preexisting private root
manifest/lockfile edits and untracked paths remain present and untouched.

The custom Node loader transpiles only copied `.ts` source in memory using an
unchanged regular copy of existing TypeScript 5.9.3. This is source loading, not
an engine build or engine typecheck. All runtime file imports must resolve inside
the isolated tree, without symlinks or public source fallback; every loaded file
path/hash is logged. Copied TypeScript, `@types/node` 22.20.1 and `undici-types`
6.21.0 have per-file provenance. Node is 22.22.2, Darwin arm64. Installed npm
10.9.7 is read-only build/pack tooling; its identity is in `evidence/ARTIFACTS.json`.
No installs, dependency additions, private caches, tsbuildinfo, worktrees or
symlink writes are used. This does not certify the full private public-package
dependency graph or a clean standalone engine typecheck.

## Exact bounded results

| Attempt | UTC capture | Cases passing | Cases failing | Interpretation |
| --- | --- | ---: | ---: | --- |
| 01 | 09:43:33.443–09:43:50.603 | 0 | 13 | Initial harness assumptions; retained, not 13 product defects |
| 02 | 09:45:58.053–09:46:10.935 | 13 | 0 | Corrected bounded cohort; zero skipped |

The corrected cohort has **17 actual engine runner entries**, including four
separate reflection/spread negative invocations and one fresh-invocation check.
The pre-aborted case deliberately has zero runner entries. These counts are not
unique capability coverage or all-current-input acceptance. Frozen inputs were
recorded before each product build/run. Five primary guest sources changed for
the disclosed harness correction; this is **not** an unchanged-input rerun.

The 13 case names and exact sources are in `cases.mjs`. They cover:

1. `command`, `stdio`, `fs`, `command.args`, `command.env`,
   `command.setExitCode`, its `call`/`apply` members, `stdio.readText`,
   `stdio.write`, `fs.readFile`, and `fs.writeFile`.
2. Guest availability of `Object.getOwnPropertyDescriptor`,
   `getOwnPropertyDescriptors`, `getOwnPropertyNames`, `getOwnPropertySymbols`,
   `getPrototypeOf`, and `Reflect`; direct negative descriptor/prototype/Reflect
   calls and a separate function-spread negative.
3. Missing `command.registerCleanup`, `context`, `invoke`, `signal`, `stdin`,
   `stdout`, `fs`; absent ambient `context`/`registerCleanup`; closure
   `bind`/`caller`/`arguments`/`closure` and closure `.context` paths.
4. Missing named `registerCleanup` import and a guarded absent-cleanup call.
5. A guest-local same-name function that returns `guest-only`, does not register
   host cleanup, and disappears in a fresh invocation. The explicitly supplied
   exported environment value `registerCleanup=caller-string-data` stays a string.
6. A finite 1,000-iteration program with `maxSteps=100`, returning exit 124 at
   `101 > 100`; no waiver or removal of the real guest budget.
7. Pre-abort and live caller abort after a successful property probe and one
   explicit `stdio.write("surface-probed")`; exact caller Error identity retained.
8. Explicit standalone public `makeSafeJsShellModule`: namespace and `exec`
   properties without dispatch, rejection of a `registerCleanup` option before
   dispatch, and the sanitized result of one real Shell `true` execution.
9. A supported FS `stat` result and its `isFile` method.

Across the 17 inspected values, supported own-key/entry enumeration,
`Object.assign`, object spread for non-functions, `Object.hasOwn`, direct type
access, `__proto__`, `prototype` and `constructor` checks disclose no host cleanup
function. Callable spread is explicitly **unsupported**, not counted as a
successful spread probe; its attempted use gives the exact negative diagnostic.
Guest descriptor/prototype reflection APIs listed above are unavailable. The
host separately inspects actual facade descriptors, prototype chains, and
identity equality with the live privileged context/hook; that observation is not
misrepresented as guest reflection support.

Host middleware sees the actual enumerable function-valued `registerCleanup`
created by Shell, registers one bounded idempotent counter callback per admitted
context, and forwards the **same** context via `await next()`. Its descriptor,
function identity and VFS identity are preserved. All 15 accepted host-only
markers run once. The runtime observer forwards original source, options, budget,
signal and real results/errors, without a fake engine or extra guest module.

### Effects, errors and containment

- All cases have zero VFS writes and zero input pulls; the sentinel file's bytes
  and directory entry remain unchanged. Only the stat-result case reads VFS
  metadata, and only the shell-result case dispatches the standalone shell.
- Named import: `Module 'command' does not export 'registerCleanup'. Available exports: args, cwd, env, setExitCode.`
- Absent callable and missing Object reflection methods: `Attempted to call a non-function value.`
- Reflect negative: `Identifier 'Reflect' is not defined.`
- Function spread: `Cannot spread function into object literal.`
- Shell option negative: `TypeError: Unsupported option: registerCleanup`, zero
  executor calls. The raw runner rejects this error; the harness does not rewrite
  it into an `ok:false` engine result. The observation schema's `cancellation`
  field records any caught boundary error; this row's `exactCallerReason:false`
  is **not** a cancellation failure.

Exact stdout/stderr, returned versus thrown engine errors, exit codes, budget
options, context descriptors, late cancellation settlement and no-effect counters
are preserved in both `report.json` and the original child stdout logs.

No guest runs in the parent. The strict-rejection child has a 384 MiB V8 heap cap,
60-second outer deadline, and an independent parent 10-second per-case watchdog.
Every native build/archive/pack/guest child is owned and waited, with explicit
PID/process-group retirement recorded. Neither attempt triggers a watchdog;
attempt 01 exits 1 and attempt 02 exits 0 while the parent remains alive. Each
Shell is disposed; after a 20 ms observation interval the corrected child's only
active resource types are its two `PipeWrap` reporting handles. Natural exit and
process-group checks confirm **no known owned children remain**. Execution trees
are removed; retained `/tmp` attempt directories contain evidence only.

## Initial harness failures, not erased

`evidence/attempt-01/inputs/*.mjs.txt` preserves all four original harness files;
the `.txt` suffix classifies them as captured input data, not runnable test files.
Both raw attempt directories, source hashes, build logs, import audits and
failures remain archived. Corrections are bounded and source-grounded:

- Three cases initially attempted forbidden function spread inside the general
  inspector, preventing later results. Inspection now distinguishes callable
  spread and retains an actual rejecting function-spread control.
- One combined reflection probe used an unbound `Reflect` expression whose error
  prevented returning the results. Each unsupported call now has its own public
  invocation and exact error assertion rather than assuming guest catchability.
- One assertion incorrectly expected closure `call` and `apply` to be absent;
  the actual engine explicitly implements them. Their returned facades are now
  inspected too; no host operation is invoked through them.
- Six otherwise progressing cases expected VFS `readdir` to return strings;
  the public contract returns `DirectoryEntry[]`. The sentinel assertion now
  checks the exact `{ name: "sentinel", type: "file" }` entry.
- One absent-call regex used the wrong diagnostic wording; it is replaced with
  the exact actual error, not a broad diagnostic waiver.
- One standalone bridge negative incorrectly expected a returned failure record;
  the actual runner rejects. Both returned and thrown outcomes are recorded, and
  the exact thrown TypeError is asserted without changing product behavior.

## Source-path review and limits

Frozen product `src/commands/safejs/index.ts` constructs only `fs`, `stdio`, and
`command`; the latter is an explicit `args/cwd/env/setExitCode` whitelist, never a
spread of `CommandContext`. FS construction passes a private-field Node bridge
to the explicitly injected real `makeFsModule`. `src/integrations/safejs/shell.ts`
exports only `exec`, accepts only `cwd/env/stdin`, and copies only
`stdout/stderr/exitCode` from execution results. Neither bridge passes the host
context or cleanup hook into a guest value. The cleanup runtime's hook is
invocation-scoped and closes at settlement; it is not added to SafeJS options.

Actual copied engine review covers module normalization/namespace binding,
host plain-record/function conversion, cancelable wrapping, own-property member
lookup, Object enumeration/assignment, object spread, and closure `call/apply`.
Host-operation policy metadata is held in WeakMaps, not attached context fields.
These relevant source hashes, including `run.ts`, `modules/registry.ts`,
`interp/host-bridge.ts`, `interp/cancel.ts`, `interp/interpreter.ts`,
`interp/globals/object-array.ts` and `interp/methods/function.ts`, are in the
per-file inventories and actual-import audit; no private code is vendored here.

No exposure-triggered guest marker registration is attempted because no host
cleanup callable is found. Arbitrary malicious host injection, unsupported raw
engine surfaces, every possible prototype graph, remote providers, stale private
dist, and sibling integration cleanup ownership remain outside this review.
Existing raw-engine limitations are neither reopened nor accepted as fixed.
There is no source-fix request or new API proposal from this bounded cohort.

## Reproduction

```sh
node tests/integration/safejs-cleanup-regression/surface/verify-evidence.mjs
node tests/integration/safejs-cleanup-regression/surface/run.mjs /tmp/NEW_SURFACE_OUTPUT
```

The first command verifies committed evidence without loading the engine. The
second requires the current local private source and the identified cached
tooling, creates new regular temporary copies, freezes the same public commit,
and records the actually present private state. It refuses to reuse an evidence
directory. New private source identities require interpreting a new run on their
own evidence, not inheriting this result. There were exactly two product/engine
attempts in this review; no repeated trial was used to erase failures.

Evidence verification and JavaScript syntax checks pass. The full owned staged
whitespace preflight reports two `new blank line at EOF` warnings, one in each
unaltered npm build stdout capture; the first commit preflight stopped on them.
Those raw evidence bytes are deliberately preserved. The canonical harness,
verifier and report whitespace check passes separately; no test/source discovery
exclusion or repository formatting configuration is changed.
