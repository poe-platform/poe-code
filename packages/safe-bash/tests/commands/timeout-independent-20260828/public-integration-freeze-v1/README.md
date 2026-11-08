# Timeout public integration: independent pre-wiring freeze v1

This is a new public-composition freeze, not another module/numeric/native audit.
Root accepted the repaired module `a23867d6a42e1cb2f2e7278cf22061737a4bea9d`
under independent evidence `33518147bde6863c3ca60ae14a9c0394f737d54c`.
The reviewer has already inspected that module and the fixed baseline. No public
wiring candidate was supplied or inspected before this freeze. Thus this is
**pre-public-candidate, post-module-source**, not a pre-module-code holdout.

## Author contract

- Compose exactly baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290` plus the four
  accepted timeout module files, then explicit public blobs for `src/index.ts`,
  `src/plugins/index.ts`, and `package.json`. Supply commit/blob/mode/size/SHA256
  for every public replacement before admission. Do not substitute current HEAD.
- `BINDINGS.json` authenticates the existing 268-input selected build manifest:
  264 baseline files plus four module files. No whole-Git-history/archive claim.
  New concurrent WebDAV/XAN product changes must not enter this composed view;
  existing baseline WebDAV remains byte-identical. New product paths require
  root scope change, not an automatic allowlist expansion.
- Root and explicit `virtual-bash/commands/timeout` export the same three factory
  functions: `createTimeoutCommand`, `createTimeoutCommands`, `timeoutCommands`;
  types `TimeoutScheduler`, `TimeoutCommandOptions`, `TimeoutCommandsOptions`.
  Leaf target is `./dist/commands/timeout/index.{js,d.ts}` with explicit import
  and types entries. The rest of package metadata/exports/scripts/dependencies
  remains unchanged. Direct factories/module bytes remain accepted a238.
- `AgentCommandsOptions.timeout?: Omit<TimeoutCommandsOptions, 'replace'>`.
  The actual DI key is **invoke**, not invoker. Aggregate top-level replace is
  authoritative, including hostile untyped nested replace values. Scheduler
  methods retain their trusted receiver. Callable context.invoke wins; fallback
  only if the property is absent, never present undefined/noncallable.
- Independent literal inventory is 77 baseline names plus timeout = **78**.
  Curl/SafeJS remain opt-in; getopts is a builtin, not another plugin. Bare Shell
  has an empty registry unless configured; the default under review is
  `agentCommands()` / `createAgentCommands()`, not implicit Shell installation.
- One pinned baseline aggregate test still has a stale 76-name list omitting
  which, although pinned aggregate source includes which. Our expected77 list
  is independently explicit and includes which, not derived from the candidate.
  Author must declare synchronized maintained inventory-test/documentation
  blobs separately, outside product build inventory; no editing historical
  evidence to turn old counts into new passes.

## Frozen cases and prerequisites

`cases.mjs`: 30 public runtime families R01–R30, eight admission/control families
A01–A08, explicit names, output records, option vectors, schedules, and boundaries.
`types.mjs`: ten exact consumer payloads, four positive/six negative, strict
NodeNext/exactOptionalPropertyTypes/noEmit/skipLibCheck:false. Payloads stay data;
later stage consumer.ts only below owned node_modules. Positive root/leaf APIs
replace neither old negative-export raw results nor old declarations.

Runtime layouts: authenticated source composition; actual offline installed
public package; physically moved public package. Types execute installed and
moved, with entrypoint-specific actual declaration-read closure. Leaf-only types
must read the leaf, not unrelated root. Root types still require root. No internal
dist import or production-source fallback in public consumers. Return raw
compiler stdout/stderr, diagnostic code/file/line/token/full message and load
hashes, not just expected exit codes. Predicates freeze diagnostic meaning rather
than one compiler pretty-print spelling; no unrelated diagnostic is accepted.

Lifecycle adapters select the aggregate's actual timeout handler; observational
wrappers may delegate and record but may not replace behavior. Bind the exact
accepted PC01/PC02 predicates/schedules in BINDINGS. R24 retains the root-approved
boundary split: raw handler/invoke reject identical borrowed sentinel, but live
outer Shell maps to1 and exact 31-byte stderr. R23 caller and R25 actual retirement
collision never accept raw124. Prove retirement entered/threw; do not assume it.
R28 explicitly distinguishes actual Shell cancellation during cleanup (124) from
a trusted raw invoker returning7 after deadline (7); no new host-error policy.

R07 uses text.maxBufferBytes versus timeout.maxTimerMilliseconds. A timer chunk
cap is not a failure limit. Each family's independent observable change and its
untightened positive are frozen, with a differing-value leakage counterfactual.
Shared maxCommands/substitution/output/source/expansion budgets remain Stage2;
no new Shell, reset, capability field, timer token limit, signal emulation, or
hard/opaque-provider preemption is authorized.

## Admission and later execution

Before any public candidate execution, seal a candidate-specific executable
adapter, exact public blobs, tools/dependency closure, build/pack inventory,
all consumer payload hashes, load guards, scoped mutants, order, and watchdogs.
Authenticate baseline and accepted module **before** public replacement and
authenticate declared resulting bytes **after**; never apply an old hash to new
bytes. Reproduce whole candidate pack, not just accepted module pack e6f.
Authenticate all committed selected inputs and all fresh-tree entries/modes;
reject unknown files, symlinks, AGENTS before content, and hash/mode deviations.
No broad live checkout census, AGENTS copies, hidden overlay or live fallback.

Proposed supervisory ceilings for later exact recipe: 10 seconds per cooperative
runtime/type control, 120 seconds per build/install/pack child; output cap 16MiB
per child and 1MiB per bounded runtime record. These are verifier STOP limits,
not product budgets or authorization to kill into a pass. Adjustments, if needed,
must be separately pre-execution bound, never retry-until-pass. Node22.22.2 and
the accepted 2274-file tool closure/12 metadata-only aliases are reference pins;
revalidate and record actual tool loads, not merely disk identity, on execution.

Per-case pre/post integrity, awaited registered cleanup, natural child close,
owned timer/handle/promise counts and unhandled rejection receipts are required.
Ordinary assertion failures may continue only after clean reap and intact
bindings; admission/cleanup failure STOPs, records exact remaining unrun phases.
Intentional mutants/guards remain separately counted. No public test is run by
this freeze; `validate.mjs` executes synthetic freeze predicates only.

## Sealing and retained qualifications

`seal.mjs` authenticates selected committed blobs and protected evidence, writes
BINDINGS and MANIFEST once, with preread Node/Git identities. `validate.mjs` checks
the sealed bytes first, runs 36 predeclared synthetic controls once, retains each
outcome and writes VALIDATION plus a separate validation seal; no product imports,
build, compiler, npm, native tools or public execution. Never overwrite a run.

Original 31/34, missing original diagnostic bytes, preparation failures, module
reconciliations, accepted 34/34 source+moved and exact e6f pack remain unchanged.
This freeze approves no new candidate. Native12/SafeJS stay0; private helper
behavior, public wiring, entire78 readiness and full gate are not accepted here.
No unresolved API contradiction was found. Root must provide the coherent
candidate, explicit public/test/documentation blob list and whole-pack binding
before independent public admission/execution.
