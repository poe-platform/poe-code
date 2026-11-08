# yq final contract v1 — sealed design addendum

Status: **DESIGN ADDENDUM SEALED; ENUMERATED ROOT CHECKS PENDING; NO
IMPLEMENTATION AUTHORITY** (2026-08-28).

## Authority

The immutable b311 profile is adopted except where this addendum expressly
supersedes it. Its README SHA-256 is
`75af84bd5e888a3080e9096b86ed0a25be95105524011851193b9bf39192ba50`; its
decisions JSON SHA-256 is
`2d7e03e6e8e38020e62b96245ea95826208a400df19c106f0c3f857d4fa3d3fc`.
Both are read at commit `b311c2364ceca13daab4086dfb21157b9b8ae856`.
The source baseline is `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
The separate length protocol `debfdd8b42930d8c5f1c0301897e4eeaa68e0979`
is unchanged and still needs its separately assigned freeze/authorization.

| Authority | Exact scope |
| --- | --- |
| Root-adopted | b311 C1/L1/E1/P1 and settled boundaries, as superseded below; fixed private caps; help/version behavior; merge-key amendment; numeric policy; direct-handler boundary |
| Root check | exact information bytes, public API, private adapter, finite diagnostic catalogue, and the two bounded primary-spec choices in `contract.json` |

`contract.json` is the exact same-addendum catalogue. It is normative where
this summary is abbreviated.

## Superseding amendments

All caps are inclusive private constants. There is no public configuration,
`YqLimits`, default-limits export, DI limits, or second hard-ceiling vector.
P1 is retained with its 8,192-byte query cap and gains: 4,096
`CommandContext.args` entries, 65,536 aggregate well-formed UTF-8 argv bytes,
and 16,384 UTF-8 bytes per literal non-`-` VFS operand. `args` excludes the
command name and includes `eval`/`e`, option values, filter, paths, and `--`.
Count entries before string traversal; measure each string without building an
aggregate encoded buffer. Finish all CLI/path validation before synchronous
compile or any stdin/input-VFS/stdout acquisition.

The only information invocations are sole `-h`, `--help`, or `--version` after
an optional leading `eval`/`e`. They return 0 and fixed LF-terminated stdout;
any combination with another argument, including `--`, is
`CLI_INFO_COMBINATION`/2. They still pass argv admission but create no query
session/Budget, inspect/acquire no input, and make no input VFS call. `-c` and
`-r` require an explicit JSON output selection. All other C1 output,
multidocument ordering, and refusals remain adopted; no flag is added.

A decoded string key `<<` is ordinary data when quoted, block-style, or
explicitly `!!str`/expanded-str tagged. Only plain untagged `<<` is rejected,
with no merge behavior. `!!merge`/the expanded merge tag remains unsupported.
YAML 1.2.2 actually resolves plain untagged `<<` as a string, so this is an
intentional anti-extension restriction, not a grammar claim.

Finite/safe-integral rules, no-`BigInt`/no-power allocation, and normalized
Decimal range `[-1147483646, 999999999]` are adopted. Baseline blob
`fe90b5fcbef68a4a2a4aed164d7599d0dcd22630`, lines 58–59, contains those
literals; a different reviewer must still validate the range binding.

## Exact pending root-check proposals

```ts
export interface YqCommandsOptions {
  readonly replace?: boolean;
}
export function createYqCommand(): CommandDefinition;
export function createYqCommands(): readonly CommandDefinition[];
export function yqCommands(options: YqCommandsOptions = {}): VirtualShellPlugin;
```

Only the plugin consumes a once-read, pre-effect validated `replace`; the
fixed command factories have no pointless option. No export is implemented.
The exact private `createYqQuerySession`, `YqQuerySession`, and non-resettable
`YqOwnedWork` signatures are in `contract.json`. They bind existing `Json`,
`parse`, `Interpreter`, `Budget`, `Budget.value`, and `stringify`: one Budget,
empty variables, one synchronous terminal compile attempt, serialized runs,
generator return in `finally`, and shared idempotent close. Scanner/encoder work
uses only controlled shared step/tick/admit methods; no Budget reference,
worker, lease, scheduler, public query bridge, or async compiler is invented.

Proposed version bytes are exactly:

```text
virtual-bash restricted YAML profile
```

Proposed help bytes are the exact UTF-8 `exactInformation.help` JSON string.
They name the same profile, list only approved syntax, and claim no Mike Farah
or package version. The finite catalogue contains every normal CLI, query,
input, schema/key/tag/numeric, alias, named limit, VFS, and encode code. Unknown
exceptions escape; there is no wildcard code.

The preferred frame is `yq: CATEGORY: CODE [at SOURCE[:LINE:COLUMN]]\n`.
Framing tokens are ASCII; a JSON-escaped filename preserves valid non-ASCII
UTF-8 and is incrementally capped at 256 bytes with an in-string `...`.
Location is included only when structured and truthful. Exact fallback is
`yq: limit: DIAGNOSTIC_TRUNCATED\n`.

## Accounting, output, and settlement

`contract.json` fixes every counter, lifetime, unit, and preallocation point.
The one Budget mapping is `{maxInputBytes:67108864,maxValueBytes:8388608,
maxOutputBytes:16777216,maxSourceBytes:8192,maxDepth:128,maxAstDepth:64,
maxSteps:1000000,maxResults:100000,maxCollectionSize:100000}`. YAML does not
route the same received bytes through `readChunks`, avoiding double input
charge. Input composition and alias copies preadmit retained allocations;
engine-yield validation necessarily occurs after engine allocations. A result
is admitted exactly once after validation and before encoding.

Stdout is inclusively capped at 16,773,120, reserving 4,096 of the 16,777,216
combined cap. Exact document/diagnostic bytes are charged before first submit
and never reclaimed after zero/partial/full sink acceptance followed by
failure. This is admission, not physically written bytes or a transaction.

The retained simultaneous logical inventory and conservative known-payload
envelope `M + Q + max(2E, 3E + 2s)` remain. Whole documents may coexist as raw
fragments, decoded text, metadata, expanded input, query internals/result, and
encoder fragments/join/suffix/buffer. None of this proves heap, RSS, CPU,
latency, live leases, races, or hard preemption.

The direct handler maps only catalogue failures. Exact caller reason, sink or
accepted-owned-output rejection (including EPIPE), escaping control/execution,
then cleanup failure remain raw in that precedence; diagnostic attempts cannot
mask them. Outer Shell routing may authentically select downstream/pipeline
numeric outcomes, so this does not promise Shell always rejects. Register the
shared idempotent close before acquisition; owned stdout/stderr remain sibling
destination scopes and closing stdout cannot cancel the command or siblings.

## Primary grammar finding and freeze boundary

[YAML 1.2.2](https://yaml.org/spec/1.2.2/) productions 1–2, 96–97,
107–135, 202/211, and section 10.3 were inspected. The profile's invocation of
`nb-json` conflicts with its rejection of raw DEL/C1 and U+FFFE/U+FFFF inside
quotes: production 2 permits TAB plus U+0020–U+10FFFF there. Also, section 7.1
permits anchor-name reuse and resolves aliases to the most recent preceding
match, while b311 rejects duplicate anchor names. Root must choose separately
for each: (A) align to the specification, with the exact safe qualifications in
`contract.json`, or (B) retain b311 and label the rule a deliberate restricted
subset. No choice is silently made. The existing completed-anchor,
no-current/cycle, and deep-copy safety rules remain adopted. Implicit keys keep
the specification's single-line/1,024-code-point grammar rule; this is grammar,
not a configurable safety-cap vector. The
[YAML 1.1 merge draft](https://yaml.org/type/merge.html) is exclusion context
only.

Before code, root must check the five enumerated proposals, a different review
must check Decimal binding, and later independent grammar/limit cases must be
frozen. No parser, command, query bridge, test, export, dependency, source
refactor, eval-all/slurp/write/schema feature, or implementation is authorized.
Static immutable-source/spec inspection only; source/product/test/native/
reference execution count is zero.
