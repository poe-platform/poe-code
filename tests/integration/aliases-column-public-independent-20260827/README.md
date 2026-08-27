# Independent pre-candidate public integration fixture freeze

Owned scope: **only this new directory**. This is a delegated substantive worker's
fixture preparation, not the root integration implementation. The module APIs,
Shell lifecycle, worker client, module documentation, and existing installed-package
test conventions were inspected. **This is not a blind module review.** No root
exports, package/configuration, AGENTS, module source, or private repository is changed.

Current authoritative update: root **has authorized Curie public/default integration
70→73**, following independent alias fixture `3ceac6f3` and shared-input `18c02655`
acceptance. Curie owns source/config/documentation root wiring. This freeze precedes
the actual integration candidate; exact source/export/pack/option-route bindings
remain pending from root. No emerging candidate has been inspected or accepted here.

## Fixed contract and coverage

`cases.json` fixes the existing 70 names plus exactly `egrep`, `fgrep`, `column`:
**73 distinct default registered definitions**, through both `createAgentCommands`
and `agentCommands`. `expr` and `du` are explicitly excluded. Neither `curl` nor
`safejs` may auto-register; both remain opt-in. The exact list
also rejects any other unexpected optional command. Runtime dependency and optional
dependency maps must remain empty.

Twenty-one byte/status/diagnostic fixtures cover ERE alternation, literal fixed
patterns, conflicting matcher flags, no-match/quiet status, literal nested `env`
invocation, table alignment and current ragged-tail padding, empty separator cells,
long/clustered options, output delimiters, down/across TAB fill, nontruncating table
width, rejected options, all-three pipelines, VFS pattern/input/output files,
redirection, and shared `-` stdin. No native oracle or parity assertion is involved.

Procedural cases additionally fix:

- Standalone alias plugin works without a registered `grep`; all seven factories
  and plugin exports are exercised, including independently registered definitions.
- Alias/column and candidate aggregate collision preflight leaves every previous
  registry entry unchanged; explicit replacement preserves an unrelated sentinel.
  Candidate-only column conflicts require top-level `replace:false` to override
  nested family `replace:true`, and top-level true to override nested false. These
  are deliberate JavaScript injections even if family types omit nested replace.
- Middleware visits literal public command names exactly once, including nested
  invocation and pipeline forwarding; both alias entry and exit are observed.
- Configured regex request timeout **37ms**, worker heap **32MiB** and stack **2MiB**
  reach both aliases. Candidate aggregate plugin and definitions routes are checked
  independently. Standalone aliases share `maxWorkers:1/maxQueuedRequests:0` capacity.
  This does not assert that separate families share one shell-wide regex budget.
- Column `maxRows:1`, invalid-limit preflight, options snapshot, and output budget;
  the candidate's aggregate plugin and definitions must propagate column settings.
- Actual public Shell abort/dispose awaits active alias worker retirement, with
  post-abort reuse. A controlled postMessage interception holds a real worker's
  matcher request after its ready handshake; no fake worker or private product import.
- Actual Shell column-owned VFS iterator `return()` gates exec and dispose; opaque
  input cancellation observes late rejection. External Shell stdin return rejection
  for each alias rejects exec with the original error, rather than expecting a
  fulfilled exit-2 result. These do **not** promise forced termination of opaque host
  work or arbitrary external-stdin cleanup waits. The existing ShellInput ownership
  boundary is not expanded.

`positive.ts.fixture` and `negative.ts.fixture` are explicit installed-consumer
inputs, not canonical `.test.ts` files. The runner materializes them as ordinary
`.ts` files in the relocated consumer and checks strict NodeNext, exact optional
properties, unchecked indexing, and **skipLibCheck:false**. All declared root and
subpath runtime functions are imported; option shapes derive strictly from exported
factory parameters, without requiring unpromised named option-type exports. Named
type exports can be separately declared later. Negative diagnostics must
occur at every fixed invalid-use line with API type-error codes, not missing-module
errors. Both modes check 13 distinct invalid-use lines. Candidate lines 13–16
independently reject invalid regex and column options through BOTH `agentCommands`
and `createAgentCommands`. Baseline substitutes four replace-invalid controls there:
future aggregate propagation typing is explicitly DEFERRED, not passed. No project
test-discovery/typecheck configuration or exclusion changes.

## Running and evidence isolation

```sh
node tests/integration/aliases-column-public-independent-20260827/self-check.mjs
node tests/integration/aliases-column-public-independent-20260827/run.mjs --baseline 0123c83d3aae72a15621acbb29a165b97b2c6ab6
node tests/integration/aliases-column-public-independent-20260827/run.mjs --candidate /absolute/path/to/root-declaration.json
```

Each run exclusively creates a unique temporary evidence directory and prints its
`report.json` location. Canonical fixtures and historical evidence are never updated
by the runner. Build uses `git archive` of the exact full commit's `src`, package
metadata/lock and TS configs; no live product overlay. Existing local TS development
tools are used, with compiler implementation/version/hash recorded. The isolated
source alone gets a temporary development-tool symlink, removed before packing.
No root build, install, new dependency, native service, or broad gate is run.

The runner builds the archive, runs offline `npm pack`, extracts the actual tarball
into `node_modules/virtual-bash`, **moves the consumer**, and retires the original
source directory. The installed package is not a symlink, contains no `src`, and its
dist inventory must match the built artifact. This is an extracted npm package
installation, not a claim that an npm registry install was exercised. No npm lifecycle
script is permitted without a new explicit review. Consumer-only Node declarations
and undici types are copied from existing development tools, not runtime dependencies.

Runtime is a clean Node subprocess with no tsx/NODE_PATH/NODE_OPTIONS fallback,
explicit read permission only for the moved consumer, and worker permission. The
Node warning about `--allow-worker` is retained: this is a resolution/fixture guard,
**not a hostile-JavaScript security sandbox certification**.

Authenticity is measured where loading happens: a synchronous Node module load hook
hashes the actual returned source bytes for every loaded product JS module, checks
them against the installed file and packed inventory, and rejects non-dist/non-JS
paths. Worker constructor instrumentation records the actual installed URL, file
hash, configured resource limits, ready handshake, requests, and exit. Worker hashes
are checked again after execution and against packed inventory. This authenticates
the worker entry URL/bytes plus execution handshake; it is **not an in-worker loader
trace of every worker dependency**. Missing worker entry is separately tested.

Before/after full tree enumeration detects changed/deleted/**new file entries** in
installed package, archived source (excluding only generated dist), and fixtures.
Archive tar bytes are hashed before/after. Live Git status is recorded, not used to
veto unrelated concurrent edits or substitute them into the archive. No append-proof
filesystem transaction or detection of transient writes restored between checks is
claimed. The compiler resolution trace and copied declaration inventory are retained.

Negative controls use separate consumer copies: delete real declared export entries;
poison installed root with a repository-source import; directly attempt forbidden
source read; remove the worker entry selected by actual execution; compile fixed
invalid public API uses; and deliberately corrupt one expected stdout, requiring
exactly that case to fail. The baseline also attempts the missing root named imports
and an explicit 73-count assertion, requiring their **EXPECTED RED** outcomes.
Root/subpath declarations for a future candidate are never invented from baseline.

## Required root declaration / unresolved integration decisions

The candidate manifest must contain **exactly** these fields (no skip/expected-result
overrides):

- `candidateCommit`: exact full integration commit SHA, supplied after authorization.
- `fixtureCommit`: exact full commit SHA of this freeze; the runner authenticates the
  entire local fixture tree against its Git archive before candidate work. Do not
  replace this with a later weakened fixture commit without explicit review.
- `declaredBy`: root/integration owner's explicit attribution; this is a trusted host
  declaration, not a cryptographic signature or inferred authorization.
- `packageExports`: the complete exact `package.json.exports` object from that commit.
- `surfaces`: `aliases` and `column`, each with `root:true` REQUIRED and `subpath`
  string (`virtual-bash/...`) or null. Root function exports follow existing
  conventions; root=false cannot waive them. Optional subpaths follow the declaration.
  Every declared surface must expose its entire inspected function API and resolve
  identical runtime function objects. Undeclared subpaths are NOT RUN, not passes.
- `agentOptions`: `regex` and `column`, each an array of actual property-name segments
  selecting the aggregate option which accepts `RegexExecutionOptions` or
  `ColumnCommandsOptions`, respectively. The owner must declare these routes; the
  baseline aggregate currently has no regex propagation route. No proposed key is
  asserted to exist. Both plugin and definition factory routes must behave alike.

The current harness accepts aggregate column options shaped like the inspected module
options (`{limits:...}`) and regex options shaped like the inspected regex object. If
integration intentionally declares a different nesting contract, resolve that before
running rather than silently adapting to whichever setting happens to pass.

Declared root/subpath export targets must be nonempty, enabled, package-local files
or nonempty conditional/fallback structures containing such targets. Runtime still
loads actual declared public exports. The binding schema currently requires literal
subpath keys and simple option routes; wildcard-only export bindings and other target
forms require clarification before running, not a product-failure classification.

Candidate branch cannot run until that manifest is supplied. Module probes use direct
**installed dist module** paths only in explicit `--baseline` mode and label composed
pipelines as internal probes, not public/default success. Candidate mode uses only
declared bare package specifiers and the real aggregate, never baseline composition.

## Historical evidence and limits

Historical baseline: `baseline-evidence.json` authenticates the earlier author run
against `0123c83d3aae72a15621acbb29a165b97b2c6ab6`: **45/45 scoped internal/standalone
runtime probes**, strict positive types and **10/10 required invalid-type lines**,
**181 actual main-thread product module loads**, and **29 ready/exited real workers**.
Five negative-control families pass; deliberately corrupted expected stdout produces
exactly **44 pass / 1 intentional failure**. The two missing-family root imports and
the explicit 73-count assertion are **EXPECTED RED**. Candidate public tests remain
**NOT RUN**. That historical self-check rejected 11 invalid declaration mutations.
The final finishing validation is separately recorded in `final-validation.json`,
including final fixture hashes, new raw-report location and current check counts.

The measured environment is Node **22.22.2**, npm **10.9.7**, with the existing local
TypeScript compiler authenticated in evidence. The harness requires a Node environment
providing synchronous `node:module.registerHooks`; this is not evidence for every
Node 22 minor. Recorded commands, loaded hashes, fixed results, raw-report location/hash,
and source inventory are retained; no capture is silently relabeled as a later run.

Authoritative handoff facts, preserved without rerunning/reinterpreting their cohorts:
module source evidence final combined `0123c83d3aae72a15621acbb29a165b97b2c6ab6`;
column functional **39/39**, **12 source + 12 moved + 6 regressions** accepted;
alias author **82/82 after precisely 2 public-Shell return-rejection fixture
corrections**, independent review pending Curie at that earlier handoff; shared stdin final `f8819e9d`
accepted with independently corrected fixture **35/35 + 6/6**, with no arbitrary
cleanup guarantee. Those historical counts are not this fixture's test denominator
and do not certify a future integration commit. The earlier handoff said Curie was
not authorized and alias settlement review was pending. Those are historical facts,
superseded by the current authorization and accepted `3ceac6f3`/`18c02655` update above.

`draft-history.json` preserves this worker's original draft assumptions, failures,
and corrections separately from those historical cohorts. This preparation does not
claim candidate acceptance, a whole repository gate, deployed-provider acceptance,
universal native compatibility, superiority over just-bash, or 72 hours of work.
