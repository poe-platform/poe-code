# localeCompare O15 observer disposition

## Author result and hold

Author investigation on August 30, 2026: the four literal O15 failures are a
host observer-domain mismatch for the three guest-created final-attempt records.
No locale ordering, guest-value, mutation, or alias defect is established by
these cases. This is a proposed bounded observer correction, not independent
approval, a rewritten historical pass, or permission to ignore all prototypes.
Root must assign a different independent reviewer before acceptance or release.

The original Nash candidate remains immutable, manifest SHA-256
`ee2039bf7f5bd54cd74c7ae71e864f043617015f0a159cf6014f979568c93696`.
All 49 prior artifact hashes were rechecked. No production or test changes were
made during this investigation. The only new publication path is this report;
all inline procedures and raw data are captured separately as JSON evidence.

## Frozen inputs and execution identity

Noether's NOT_READY manifest is
`/Users/kjopek/Workspace/poe-code-safejs-localecompare-independent/out/safejs-remediation/localecompare-independent-validation/tmp/candidate-20260830-3557da97-literal-o15-red/manifest.json`,
SHA-256 `e683ab02c1ce1ebf3cf30ed94f297b2d412f255ce01f1609683552b609c049c6`.
Only exact manifest-allowlisted copied artifacts were read, after hash, byte-count
and canonical-containment checks. No original audit archive reads occurred.
All six original full observations, including four literal REDs, are copied
unchanged into this new capsule's `preserved-original/` directory.

The author's isolated workspace stays at base
`e6b70989225781249f2cf395b927186894fad7c2` plus the frozen localeCompare delta.
Noether's base `3557da97dbbdf21e9e0b149672ab31419628544e` has documentation-only
intervening changes according to the frozen intake. This is not a claim about
later main or a new npm artifact. The same previously forced-built public
`poe-code/safejs` entry and exact source entry were used. Runtime hashes are
included in the disposition manifest; there was no new full build or full suite.

## Exact assertion and cause

The original host observer assigns `returnValue = result.returnValue` and runs:

`check('final attempts', returnValue.finalAttempts, family.finalAttempts)`

Its `check` uses Node `isDeepStrictEqual(actual, expected)`. This is check
index 5, the sixth of ten checks, not a failed guest boolean. The aggregate
host `ok` then becomes false; public execution completed successfully.

Both actual and expected own data are exactly:

`[{ id: "a", attempt: 1 }, { id: "b", attempt: 2 }, { id: "c", attempt: 3 }]`

The arrays both have `Array.prototype`. All three actual element records have
null prototypes; JSON-decoded expected elements have `Object.prototype`.
Node's default strict deep comparison includes prototypes. The predicate is
therefore correctly false for the raw objects it received, but it compares two
different representation domains rather than only the intended attempt values.
No comparison result or native recipe has been replaced or normalized.

## Public contract and non-universal prototype treatment

The precise current source contract is preserved in `evidence/source-contracts.json`:

- `src/index.ts:45` exports both public copy functions.
- `src/run.ts:165` returns `RunResult`, incorporating `InterpreterResult`;
  `src/interp/interpreter.ts:148` aliases `InterpreterValue` to
  `SandboxValue`, and line 184 exposes that value as `returnValue`.
- `src/interp/interpreter.ts:554` creates object-literal records with
  `Object.create(null)`. The unchanged original O15 source creates its final
  attempts using `jobs.map(job => ({ id: job.id, attempt: job.attempt }))`.
- `src/interp/values.ts:619` copies ordinary input records into null-prototype
  records; line 764 preserves a sandbox record's prototype on outward copying.
  Calling only `deepCopyFromSandbox(actual)` does not turn null into
  `Object.prototype` and is not a fix for this observer mismatch.
- `src/interp/host-bridge.ts:1015` preserves ordinary host record prototypes.
  The three `pause` acknowledgements consequently retain `Object.prototype`.
  They must not be silently converted to null or accepted with any prototype.
- Existing `src/interp/values.test.ts:116` expressly expects null-prototype
  copying in both directions. Lines 95 and 235 cover outward copy and alias/cycle
  preservation; line 263 covers sparse arrays. Their existing data expectations
  use Vitest `toEqual`, with separate identity/prototype checks, not a promise
  that a raw guest literal strictly equals a native-prototype record.

Paths in that list are relative to `packages/safejs/`. The README's boundary
copying guidance is supporting documentation, not the sole authority. These
facts describe the existing raw public data contract, not a universal waiver
for unsupported language features or permission to erase Error/Map semantics.

## Bounded distinguishing execution

The original six host programs were retained as prefixes, with an additive
host-only diagnostic appended after their original output. Guest source,
original checks, settings, native comparator, LCG/time/UUID stream and all caps
remain unchanged. The only original input remapping selects this owned source
or public-built entry. An additional observer entry loads public copy APIs.
These are new diagnostic executions, not replacements for the historical runs.

All six exit 0. Native seeds 123 and 42 retain 10/10 and host `ok: true`.
Both source and both public-built cases retain 9/10 and host `ok: false`.
Each still has 54 RNG draws and final clock 1006. The original source SHA-256 is
`0986c4485dbc6cfd7922143087ea053198118925a04aa44e5c1b5812f313b5dd`.
Bounds remain 12,000 ms, 256 MiB old space and 16 MiB output, no retries or
additional guest-budget option. No original localeCompare call was removed.

Before JSON serialization, a finite descriptor-based observer captures full
values, scalar types, negative zero/undefined, all own keys in order, property
flags, array lengths/holes and repeated-reference IDs. It accepts only ordinary
record/array data for this case and refuses other kinds instead of coercing
or omitting them. It never calls getters or source functions.

Each complete return graph contains 23 nodes: four arrays, sixteen guest literal
records, and three host acknowledgement records. The exact guest-record paths
are root, completed indices 0-2, finalAttempts indices 0-2, and trace indices 0-8.
Only those sixteen native expected graph nodes are modeled as null-prototype
according to object-literal construction. Acknowledgements at
`/trace/3/acknowledgement`, `/trace/6/acknowledgement`, and
`/trace/8/acknowledgement` remain strictly `Object.prototype`.

All four complete actual graphs match this explicit provenance model, including
every value, key, descriptor and reference edge. Entire host-event and RNG
pull graphs match their raw native graphs without prototype adjustments.
Both error graphs are precisely undefined, not missing an Error name/stack.
The final-attempt array exactly matches the expected array passed through the
public input-record boundary, with no actual-value mutation.

A separate unchanged source program containing no localeCompare reproduces the
native-versus-raw-record distinction in both source and public-built APIs. Its
shared references, self-cycle, subsequent mutation visibility and full ordinary
error-shaped record fields survive. Eleven deliberate data mismatches per
entry are rejected: added/missing keys, changed primitive type/value, hole,
array metadata, wrong record prototype, key order, split alias, undefined/null,
and negative-zero/zero. Five out-of-domain controls per entry refuse genuine
Error, Map, Set, function and nonenumerable data. No Error is reinterpreted as a
plain record. The full original O15 error channel was empty; these controls do
not claim universal Error compatibility.

The existing 25 data-copy contract tests pass unchanged. No broader gate was
rerun or borrowed as a fresh result.

## Proposed separate observer, not an oracle rewrite

A different reviewer should preserve and rerun the literal controls separately,
then evaluate a new, explicitly named data-boundary observer:

1. Keep native programs, sources, anchors and limits unchanged. Preserve native
   10/10 and all four literal current 9/10 outputs as their own evidence.
2. At only the final-attempts anchor, verify an ordinary three-element array with
   exact id/attempt keys, descriptors, scalar types/order and expected prototype
   provenance. Reject unsupported kinds, missing/extra keys and metadata.
3. Leave actual values unchanged. Convert the independently pinned expected
   final-attempt array with public `deepCopyToSandbox`, then compare strictly.
   Keep all nine other original predicates untouched. Do not apply this
   conversion indiscriminately to errors, host receipts, or complete outputs.
4. Independently compare full descriptor/reference graphs to the exact mixed
   guest/host provenance model described above. Preserve full journals, 54 draws,
   clock 1006 and native values, not merely the ten summary booleans.
5. Retain alias/mutation and negative observer controls. Reject a new discrepancy
   rather than broadening prototype exemptions or using JSON equality as proof.

In this author diagnostic, the proposed anchor passes all four current cases;
that would yield 10/10 under the new observer. This is not a changed result for
any original run. Applying a sandbox-domain expectation to raw native records
instead fails, as captured, demonstrating why domains must remain explicit.

## Preserved failed author attempts

The first attempted complete-output comparison projected every native record
through the input boundary. It failed on exactly the three host acknowledgement
prototypes. That failed attempt is preserved; it demonstrates why a universal
all-record null conversion is incorrect for this graph.

A further author metadata comparison failed because the persistent Node REPL's
`structuredClone` produced objects from a different realm. A minimal receipt
shows identical metadata but differing prototypes. Only cloning of already
encoded typed graph metadata was changed to JSON cloning. Raw runtime values,
prototype labels, references and original observations were never JSON-normalized.
The initial missing REPL import was a setup mistake before payload access.

## Handoff and limits

No localeCompare production repair is requested for this observed mismatch.
The proposed write scope is a new independent observer/report only, with the
original four RED receipts preserved. Any newly demonstrated guest semantic
defect still requires TDD and a separate precise repair; this disposition does
not preapprove arbitrary prototype changes or future captures.

Independent review and publication remain HOLD. The original candidate, README,
SKILL, ledger, guest recipes and other workers' workspaces are untouched. No
commits, pushes, live skill sync, network provider calls, original archive reads,
security probes, standalone QA scripts, builds or full-suite reruns occurred.
