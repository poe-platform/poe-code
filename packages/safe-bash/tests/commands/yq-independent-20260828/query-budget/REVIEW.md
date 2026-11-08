# Independent PRECODE yq query/resource review

Status: Static review complete; two resource-contract choices blocked.

Implemented Through: Not applicable — no yq implementation was inspected or authorized.

Purpose: Test whether the adopted future private adapter contract is expressible
over the selected existing jq sources, without changing those sources.

## Authority and evidence

This is an **informative review**, not another normative specification. The
authority is b311 initial-profile-v1, amended by final-contract-v1 at
`5783b8e03912f7774d2a86ba1dae9de778121273`, then final-adoption-v1 at
`cfa6fbcb72c5a3e228c4ffbea7cb1719827b2707`. Old quoted-character, duplicate-anchor,
and merge-key restrictions do not override the adoption. The write-spec skill
and Symphony reference were read; no authoritative/sealed document is changed.

`SOURCE_IDENTITY.json` binds selected bytes, Git blobs, revisions and line spans.
The final README/JSON hashes are respectively
`14cee48cac1803f92432b4f7df8f3311514b12277357805945bd11156e8646ff` and
`1b2cf2740586d6847286d5a28788beb748d09e8b2181f02e6476d3b7634cefb8`;
adoption README/JSON hashes are
`7e2f1a691409a09130f4cf2d539914eb76feab81d13c7cdc9f2c72d3a268c081` and
`22e83a0e6f602103ac9378654dd62fc7098c461ac90b7385e5d6b06cec156be6`.

EXACT5137 is identified from `contract.json#/authority/fixedSourceBaseline`,
the earlier source-identity packet, and Git metadata: commit
`5137a74ec855a32d8a8860eb66b62eb44d11e290`, tree
`48e5ae39ce98e1c8e416bae77da40d88b75e1db5`. It is not a guessed abbreviation,
current HEAD, command count, or whole-current-tree qualification. The future
module candidate remains EXACT5137 + independently **accepted** length change +
new yq/private-query-adapter paths only. The observed length candidate
`74361026502d76b8c2b696f9c60e410ac9b78d95` changes only the reviewed string arm
within the selected interpreter delta; Plato's acceptance is a separate unmet
dependency. Baseline line references below use 5137, not its four-line-shifted
live interpreter. DESIGN.md's initial 270fedbe version and additive 0b8064d2
version are separately authenticated, not falsely called identical.

## Findings requiring a decision

### QB-F1 — synchronous boundary helpers versus owned checkpoints

The adopted `workUnits.owned/checkpoint` charges every recursively validated and
encoded node and calls `Budget.tick` after at most 1,023 owned units without an
await. The private surface simultaneously specifies synchronous
`measure(value): number` and `stringifyJson(...): string`, reusing `Budget.value`
and `stringify` (final contract lines 153–162, 247–268).

`limits.ts:72–97` recursively visits the whole graph, calling `step` but never
`tick`. `input.ts:290–316` does the same for encoding. An array with 1,023 null
members has 1,024 visited nodes and only 5,116 compact bytes. Both operations
fit the other P1 limits but cross the owned-unit checkpoint boundary inside a
synchronous call. An asynchronous preflight cannot insert an await into the
subsequent reused traversal; an `async` wrapper cannot do so either. Per-fragment
payload charges are also not supplied by `stringify` itself.

**Blocked choice:** explicitly classify these reused boundary traversals as
fixed-engine work with disclosed synchronous checkpoints, or revise the private
boundary/ownership requirements to support the adopted asynchronous counting and
encoding rule. This review chooses neither and authorizes no engine refactor.
Pre-counting exact output can solve byte admission; it does not solve this
checkpoint conflict. Existing intermediate engine calls are already qualified
by `workUnits.engine` and are not a new finding. See case `B01`.

### QB-F2 — whole-alias work preflight lacks the required observation/reservation

Initial-profile README lines 220–230 requires proof, **before allocating an alias
copy**, that the entire copy fits cumulative invocation work. Final contract
retains that bulk projection and separately charges future checkpoint ticks
(lines 249–268). This is stronger than charging each copied unit immediately
before that unit's allocation.

`Budget.steps/nextYield` are private (`limits.ts:45–63`). The frozen ownedWork
surface has step/tick but no remaining-work observation or reservation operation.
Interpreter/Decimal work also advances that same counter, so a yq-only ledger
cannot infer the remaining amount. Calling `step(copyUnits)` precharges those
units but not later mandatory `tick()` increments; charging them again while
copying changes the adopted accounting. At remaining work 1,024, a copy with
1,024 owned units needs at least one further checkpoint step: a plain
`step(1024)` reservation succeeds although the full planned work cannot fit.

**Blocked choice:** settle whether the requirement is whole-copy work admission
including future checkpoints or per-unit admission, and, if whole-copy, identify
an authorized mechanism over the shared counter. Neither silently exposing or
resetting Budget nor adding another effective work budget is an accepted answer.
This is a gap in the specified forwarding/preflight contract, not a claim that
all conceivable adapter designs are impossible. The counter-state witness is
synthetic, not a claim that a particular YAML document reaches that state. See
case `B02`. Node/value/depth and alias-reference bulk projections remain required
and independently expressible with cached counts.

## Confirmed source bindings and limits

### Decimal admission, generated values and encoding

- `numbers.ts:48–74` contains the exact literals -1147483646 and 999999999,
  but **does not reject** all tokens outside that interval. It clamps zero's
  exponent, checks the upper **adjusted** exponent `exponent + digits.length - 1`,
  and rounds/truncates below the lower exponent. Checking the constants alone
  is not proof of rejecting lexical admission. `decimalNumber` preserves
  coefficient trailing zeros; no trailing-zero normalization is inferred here.
- Input lexical range/safe-magnitude admission precedes conversion, per b311
  section 3.3. The yq-owned admission needs bounded digit/exponent arithmetic;
  calling `decimalNumber` first loses the rejected spelling. No BigInt/power-of-ten
  allocation is needed for this admission. The existing engine's `%` uses BigInt
  at `values.ts:138–139`; the admission prohibition is not reinterpreted as a
  demand to remove a fixed query operator.
- Baseline `parser.ts:163–164` converts positive query literals; unary minus at
  `interpreter.ts:30–34` projects through binary64. Consequently input
  `1e-1147483647` fails lexical range admission, while a query literal with those
  bytes becomes Decimal zero with exponent -1147483646. A yielded-graph validator
  cannot recover discarded lexical digits. Cases freeze the **existing query
  dialect**, not an invented second lexical policy for query source.
- A nonzero tiny Decimal can have `.double === 0` and still retain nonzero text.
  `numberValue` is not an exact-integrality test. Validate digits/exponent as
  well as finite/safe integral double before encoding. `numberText` otherwise
  renders NaN as `null` and bounds infinities (`numbers.ts:102–113`); it is not
  a numeric validator. Query `nan | tostring` yields a permitted string: the
  adopted checks are on input and final yielded graphs, not every intermediate.
- Normalized Decimal text is the JSON encoder's numeric token. Untouched tiny
  values need not round-trip through binary64. Negative tiny **query** literals
  can become -0 through baseline unary evaluation. No alternate numeric engine,
  full Core range, or native yq parity is claimed.

Primary YAML 1.2.2 sections 10.2.1.3–4 and 10.3.2 were read on 2026-08-28.
Core's decimal integer spelling permits a sign; octal/hex prefixes in its table
do not. Signed hex therefore remains a string, not a rejected unsafe integer.
Core also resolves nonfinite spellings; this profile deliberately rejects their
numeric values. YAML does not prescribe this Decimal implementation's accuracy
or exponent constants. The primary locator is recorded in the identity file;
no external parser or example implementation was imported.

### Ordered objects, keys and depth

`limits.ts:100–120` uses a WeakMap order list plus null-prototype objects.
`object()/put()/objectKeys()` preserve numeric-looking insertion order and treat
`__proto__` as data. Plain assignment into an unrelated null-prototype object,
spread, `Object.keys`, or JSON parse/stringify cloning does not preserve that
private ordering metadata. Alias deep copies need the same representation;
shared references are not deep copies. Existing query object duplicate fields
overwrite in first-key position (`interpreter.ts:98–104`); this is distinct from
YAML decoded-key duplicate rejection. `keys` sorts using code-point comparison;
`keys_unsorted` uses insertion order (baseline interpreter lines 219–222;
`values.ts:10–21`). These are not interchangeable encoder key policies.

`Budget.value` starts root depth at zero and also checks `depth + 1` for every
collection, even empty. Thus 128 nested singleton arrays ending in a scalar
pass the depth predicate; 129 fail. An empty collection at depth 128 fails the
additional collection check, although `stringify` alone would admit that empty
node. Mandatory graph measurement closes that mismatch; it is not an encoder
waiver. AST validation starts at depth one (`parser.ts:193–218`); 63 postfix
optional operators on identity give depth 64, and 64 give depth 65.

### One Budget, admissions and lifetime

`defaultBudgetMapping` matches the nine existing `JqLimits` fields, with
`maxQuerySourceBytes` mapped to `maxSourceBytes = 8192`; argv/path/document/scalar/
anchor/alias/node/stdout-reserve caps stay private. The exact 21-cap vector is
independently repeated in `check.mjs`, not derived as its own expectation.
`Budget` exposes no input/output/result admission methods; the private adapter
must checked-project the existing counters before assigning. `JqLimitError`
has only a fixed formatted message, not a `limitName` property (`limits.ts:26–30`).
The nine exact known messages can be mapped after authenticating the error
class and execution stage; arbitrary messages/abort reasons are not limit codes.

Compile once before any input/output acquisition, keep the AST, empty variable
map, Budget and Interpreter across documents, and validate each final yield
before exactly one result admission. Do not route YAML bytes through structured
`readChunks` as well as owned input admission. Completed operands, zero yields,
and mapped failures do not reset cumulative counters. Unlike jq's command loop
(`jq.ts:150–186`), yq stops on its first selected failure. `Interpreter.run`
contains no outward-result increment (`interpreter.ts:24–96`); adapting that
class, rather than invoking the jq command, avoids duplicate results/CLI budgets.

Engine collection/value checks remain where they actually are. Examples of
allocation before checking are object copy then measurement (`interpreter.ts:102`),
string concatenation and object merge (`values.ts:105–107`), and division's
string splitting (`values.ts:126–127`). Final contract line 249 explicitly
qualifies final engine yields as checked **after** allocation. These are not new
requirements to refactor jq and cannot be described as preallocation safety.

### Retention and exact output

Retain separately: owned raw chunks and any partly consumed provider chunk;
decoded text; tokens/anchor records and source references; original/expanded
ordered graph; compile source/AST; active generator input and intermediates;
yielded graph; output fragments, joined text, suffixed text and bytes. A provider
chunk can contain multiple documents: an 8 MiB per-document limit is not an
8 MiB cap on all referenced raw input. Pending or completed anchors retain graph
references until the document ends; reused names do not erase already retained
graphs/copies or definition events. Copies of retained source fragments precede
advancing/finalizing a reusable producer. Transient awaited sink writes are not
automatically another retained copy.

`stringify` retains bounded fragments then joins them; scalar/key JSON fragments
are created before append's size check (`input.ts:293–309`). A yq preflight must
prove exact remaining output before that allocation; merely passing `maxBytes`
to stringify does not provide the adopted before-fragment guarantee. Existing
whole-document buffering is allowed, with the b311 conservative logical envelope
`M + Q + max(2E, 3E + 2s)` plus raw/source/metadata/intermediates excluded from that
formula. This is neither a total retained-memory cap nor a heap/RSS lease.

Combined output is 16,777,216 bytes, stdout at most 16,773,120; the 4,096 difference
is reserved, not another independent budget. Preflight the entire next document,
including YAML separator and LF, before its first write. Charge globally once
for the full admitted operation; rejection after a prefix does not refund it.
Diagnostics use the same ledger, 54 fixed entries and the exact fallback.
`ALIAS_DUPLICATE_ANCHOR` stays reserved/unreachable under ROOT adoption. Numeric
and ordered-object cases use compact JSON to avoid inventing YAML presentation.

### Filesystem, lifecycle and public boundary

`FileSystem.readStream` is optional and synchronously returns a ByteSource;
fallback `readFile` takes `{ signal, maxBytes }` (`filesystem.ts:41–46,72–100`).
The finite OPEN/READ diagnostics distinguish source creation from iteration/
fallback read. No implicit host path, network, writes, input-format inference,
public dependency injection, or added shell-global budget is needed.

Register the shared idempotent close before session-owned admission or input/
output acquisition; finally uses that same close. Serialize active query runs,
make compile failure terminal, close run admission first and share each active
generator's return completion across finally and concurrent close. A direct
context may omit registerCleanup but not finally cleanup. Sibling stdout/stderr
OutputOperations do not make one another children (`output.ts:13–78`).

`readBytes` alone is **not** the cooperative cleanup barrier: on abort it observes
but does not await iterator return (`io.ts:226–233`). Track/register the owned
underlying iterator return so public settlement can await it; do not infer that
an abort race has stopped opaque `next()` work. Source, sink and cleanup errors
must be separated from language catches, including errors shaped like JqError
or FsError. Caller abort wins by provenance and exact identity, then selected
escaping execution failure, then cleanup, then normal result (`command.md:120`).
This does not demand every outer `Shell.exec` reject: the adopted raw-boundary
qualification preserves existing Shell command-exception/status handling.

The proposed three factories fit `CommandDefinition` and `VirtualShellPlugin`.
Only plugin registration accepts once-read `replace`; fixed factories take no
limits. No source/barrel/root/package change is part of this packet. A future
moved consumer must authenticate emitted selected modules/declarations and their
relative `.js` closure; source imports, the current root barrel, or an unmoved
workspace alias do not prove that acceptance. No moved/build/type/public run was
performed or represented as a pass here.

## Frozen evidence and validation

`CASES.json` contains original bounded synthetic input, query, counter-state and
lifecycle recipes. Contract expectations and blocked choices are explicit;
none are recorded as observed product outputs. Isolated admission-state recipes
do not assert that earlier work/input caps permit a full command to reach them.
`check.mjs` performs only JSON/schema, unique-ID, fixed-cap/catalogue/information,
small fixture arithmetic and selected Git byte/hash checks. It never imports or
runs product, native jq/yq, TS build/tests, private packages, or another packet's
executor; it creates no capture directory and rewrites no evidence.

Run from the repository root:

```sh
node tests/commands/yq-independent-20260828/query-budget/check.mjs
```

| Evidence area | Prepared evidence | Remaining dependency |
| --- | --- | --- |
| Decimal/schema/query | N cases, fixed source paths | Future candidate runtime; no oracle run |
| Order/depth/dialect | Q/D cases | Actual private session and encoder |
| Counters/output | A cases, independently fixed P1 | F1/F2 decisions; candidate instrumentation |
| Cleanup/FS/public | L cases | Actual handler/exec/cleanup and moved consumer |
| Contract feasibility | B01/B02 | Root/owner reconciliation; not chosen here |
| Length prerequisite | P01 and selected delta hashes | Plato, not this reviewer |

The bounded review is complete; code-go is not. No full YAML conformance,
performance, security, backend-service, superiority, 72-hour work, or complete
module-acceptance claim follows. Sibling normative/freezer packets retain their
separate ownership and authority limits.
