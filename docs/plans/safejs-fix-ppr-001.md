# PPR-001: raw native Promise alias memoization

## Scope and baseline

- Author workspace: `/Users/kjopek/Workspace/poe-code-safejs-promise-aliases`.
- Main base: `4358488f9478bcb3c5a89af4fcd61c3cdfcf037f`; successful
  `git -c pull.rebase=false pull --ff-only` before inspection and edits.
- Approved PPR-002 prerequisite manifest SHA-256:
  `64b0d70928472558f48bfedeae6699cabd3107c44ef682c2a7a66b01da56cb32`.
  Its eleven publication files were applied with `apply_patch` only in this
  clone after checking every approved preimage/postimage hash. All six existing
  base files matched the approved preimages exactly: no merge conflict or
  upstream adjustment, no index staging. Keep this prerequisite separate from
  the PPR-001 publication delta. The prerequisite clone remains read-only.
- Evidence and immutable candidate destination:
  `out/safejs-remediation/ppr-001/`, ignored by this clone's local exclude.
- Before original payloads: bootstrap all 38 excluded paths from inventory
  verification metadata and deny the entire security directory; read only
  individually allowlisted public Promise sources/reports.

## Work sequence

1. Reproduce unchanged native/public raw-input workflows on current main plus
   the approved prerequisite; determine whether alias splitting remains.
2. Add failing public regressions for shared Promise and resolved-value identity,
   input journal deduplication, and completed restoration without input Promises.
3. Make the smallest conversion memoization repair justified by those failures.
4. Validate genuine v6 compatibility, fresh v7 restoration, broad replay tests,
   configured types/lint/format/build and strict new-test types.
5. Freeze prerequisite and PPR-001 delta separately, with exact base/current
   preimages, evidence, hashes and limitations for subsequent independent review.

## Boundaries

No private caller adapters, replacement input Promises on restore, reconciliation
proof invention, provider requests, LLMs, real guest IO, security research,
historical marker rewrites, commits or pushes. Historical broken raw-v6 captures
and pending-proof stalls are separate; this work does not claim to repair them.
Independent validation and publication remain later coordinator-controlled work.

## Root cause and isolated repair

PPR-002 alone does not fix PPR-001: on this current base plus its approved
prerequisite the unchanged full source returns Promise aliases
`[false,false,false,true]` and five input journal rows for two native Promises.
Both unchanged tiny controls (entry arguments and bindings) return false for
Promise identity, resolved-value identity and marker visibility, with two input
rows for one native Promise. Repeated awaits of the same property already work.

Both native conversion branches bypass their existing graph-local `state.seen`
WeakMap for Promise values. The repair adds a lookup and registration in each
branch (six production lines total). A raw Promise now has one sandbox wrapper,
one copied settlement value/reason and one journal input identity per conversion
graph. Existing replay-input encoding already memoizes a shared wrapper; it needs
no change. No replay counters, format markers, decoding or restoration code are
modified in the PPR-001 delta. Distinct Promise objects remain distinct. Cross-root
identity between separately converted arguments/bindings/imports is not asserted.

### PPR-001 publication delta (not the prerequisite)

- `packages/safejs/src/interp/values.ts`
- `packages/safejs/src/interp/host-bridge.ts`
- `packages/safejs/src/run.promise-aliases.test.ts`
- `packages/safejs/test/fixtures/public-promise-alias-source.ts`
- `packages/safejs/test/fixtures/public-promise-alias-v7.json`
- `docs/plans/safejs-fix-ppr-001.md`

The three v7 fixture snapshots were genuinely generated before the memoization
repair, after applying PPR-002. They retain the historical split aliases and exact
saved journal/counter values, and must continue restoring that saved history.
Pretty-printing the new JSON fixture changed whitespace only, not snapshot data.
They are compatibility controls, not assertions that historical output is repaired.

### Base/current preimages

The two production-file preimages are unchanged by the prerequisite and match
`git show HEAD:<path>` byte-for-byte. All four new delta files are absent at base
and after the prerequisite. Approved prerequisite files are hash-verified separately.

| Path                                        | Base and post-prerequisite SHA-256                                 |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/values.ts`      | `487d392c295977bdd144713382e5ab142d85a3dfac27a8fe9cfea8c669dbbf75` |
| `packages/safejs/src/interp/host-bridge.ts` | `8bc1c6cb653fa70d281732d7bb893a02cfd0e6a87f6eff093d448b9d56678420` |

## TDD and exact original-workflow results

- RED: 14 failing / 5 passing, all 19 cases in the newly added test file;
  `evidence/red.log`. The pre-format test source is retained as
  `evidence/red-green-test-preformat.ts.txt`.
- GREEN: 19/19, `evidence/green.log`; all fourteen identity failures repaired.
- Original full source SHA-256:
  `94f71537e4d19ff33a45cb950607c4e1eec1922276f15825166e4658cc64e9ff`.
- Original alias source SHA-256:
  `784f6eb021150c6c0d83365061cea4db1cc53d2504e643900aff633d178347be`.
- Unchanged prefulfilled original fixtures and pure-data boundary stub are used
  through public raw-input APIs. Native runs precede SafeJS runs. Additional
  bounded microtask-pending controls are not historical pending-proof reproductions.
- Exact RED values, native values, journal rows and metadata are retained in
  `evidence/baseline-original.json`. Exact GREEN native/fresh/restored full values,
  complete automatic/completed snapshots, calls and comparison flags are retained
  in `evidence/green-original-serialized.json`.

### Full original RED value

```json
{
  "balance": 13,
  "names": ["open:0", "credit:1", "replace:0", "settle:1"],
  "promiseAliases": [false, false, false, true],
  "inputOutcomes": [
    {
      "key": "left",
      "status": "fulfilled",
      "same": false,
      "batch": "left",
      "sameHandle": true,
      "markerVisible": false
    },
    {
      "key": "right",
      "status": "fulfilled",
      "same": false,
      "batch": "right",
      "sameHandle": true,
      "markerVisible": false
    }
  ],
  "closure": {
    "initialBalance": 8,
    "currentBalance": 13,
    "processed": ["left", "right"]
  },
  "emissionAliases": [true, false, true],
  "emissionBalances": [8, 8, 13, 13],
  "initialIsFirst": true,
  "lastIsCurrent": true,
  "numeric": [16],
  "numericIndexes": [1, 2],
  "empty": [[19], [], false],
  "trace": [
    ["boundary", "both-pending"],
    ["await", "left"],
    ["fulfilled", "left", "left", false],
    ["event", "left", "open", 3],
    ["event", "left", "credit", 8],
    ["closed", "left", 2, true],
    ["closure", "left", 8, 8, 1],
    ["boundary", "after:left"],
    ["await", "right"],
    ["fulfilled", "right", "right", false],
    ["event", "right", "replace", 6],
    ["event", "right", "settle", 13],
    ["closed", "right", 2, true],
    ["closure", "right", 8, 13, 2],
    ["boundary", "after:right"],
    ["closed", "numeric", 3, false],
    ["closed", "empty-seeded", 0, false],
    ["closed", "empty-unseeded", 0, false]
  ]
}
```

### Full native value = GREEN fresh value = GREEN restored value

```json
{
  "balance": 13,
  "names": ["open:0", "credit:1", "replace:0", "settle:1"],
  "promiseAliases": [true, true, true, true],
  "inputOutcomes": [
    {
      "key": "left",
      "status": "fulfilled",
      "same": true,
      "batch": "left",
      "sameHandle": true,
      "markerVisible": true
    },
    {
      "key": "right",
      "status": "fulfilled",
      "same": true,
      "batch": "right",
      "sameHandle": true,
      "markerVisible": true
    }
  ],
  "closure": {
    "initialBalance": 8,
    "currentBalance": 13,
    "processed": ["left", "right"]
  },
  "emissionAliases": [true, false, true],
  "emissionBalances": [8, 8, 13, 13],
  "initialIsFirst": true,
  "lastIsCurrent": true,
  "numeric": [16],
  "numericIndexes": [1, 2],
  "empty": [[19], [], false],
  "trace": [
    ["boundary", "both-pending"],
    ["await", "left"],
    ["fulfilled", "left", "left", true],
    ["event", "left", "open", 3],
    ["event", "left", "credit", 8],
    ["closed", "left", 2, true],
    ["closure", "left", 8, 8, 1],
    ["boundary", "after:left"],
    ["await", "right"],
    ["fulfilled", "right", "right", true],
    ["event", "right", "replace", 6],
    ["event", "right", "settle", 13],
    ["closed", "right", 2, true],
    ["closure", "right", 8, 13, 2],
    ["boundary", "after:right"],
    ["closed", "numeric", 3, false],
    ["closed", "empty-seeded", 0, false],
    ["closed", "empty-unseeded", 0, false]
  ]
}
```

### Tiny original control

For both unchanged arguments/bindings placements, native and GREEN fresh/restored:

```json
{
  "promiseAlias": true,
  "value": 7,
  "sameHandle": true,
  "sameAlias": true,
  "markerVisible": true
}
```

RED for both placements:

```json
{
  "promiseAlias": false,
  "value": 7,
  "sameHandle": true,
  "sameAlias": false,
  "markerVisible": false
}
```

### Journal and restoration comparisons

Full input rows: RED five, GREEN two, at primary/remote paths. GREEN automatic
capture has two settled fulfilled inputs; completion has two consumed fulfilled
inputs. Tiny inputs: RED two, GREEN one consumed fulfilled input. These are
identity/lifecycle observations, not scalar-balance claims: balance stays 13.

Nine fresh restore executions (three generations for full/arguments/bindings)
match entire native values. The full automatic checkpoint reissues exactly
`both-pending`, `after:left`, `after:right`; completed generations make no
boundary calls. Zero provider requests and no original/replacement input Promises
on restoration. The saved callable is rebound at `["bindings","boundary"]` only.

For all nine restores:

```json
{
  "valueEqualNative": true,
  "valueEqualFresh": true,
  "serializedInitialInputsByteEqual": true,
  "replayMetadataEqual": true,
  "promiseReplayMetadataEqual": true,
  "snapshotUnchanged": true,
  "callsEqualExpected": true,
  "noProviderRequests": true
}
```

Prototype-sensitive `rawInitialInputsDeepStrictEqual` is **false**, not concealed:
newly encoded host metadata property tables have null prototypes; JSON decoding
creates ordinary host containers. Complete serialized initialInputs bytes are
identical, including explicit guest nullPrototype and property descriptor fields.
The first ad hoc GREEN evidence attempt used Node deepStrictEqual on these host
containers and stopped; its empty output and diagnostic are retained, not rewritten.
No production workaround was made. Replay and promiseReplay are also raw-strictly
identical across fresh/completed restores. The v6 fixture comparisons start from
serialized metadata and pass all raw comparisons.

## Validation and compatibility

- Broad replay/conversion suite: **21 files / 547 cases pass**. Includes new alias
  tests, prerequisite public-input restoration, v6 compatibility, promise ordering,
  reference rebinding, migration/restore guards, host bridge, value conversion,
  dump/replay data, completed/failure/stress replay and crash/snapshot roundtrips.
- Six genuine v6 saved/completed controls pass **36 successive generations**,
  with value 7, expected effects, unchanged inputs/journals/counters, immutable input
  snapshots, v6 writer semantics, zero unexpected callable/provider requests.
  `evidence/v6-generations.json` records every generation and flag.
- Three genuine pre-repair v7 completed alias snapshots still pass with their
  original split output and metadata. No blanket version rejection or relabeling.
- Prerequisite missing-provider, callable-path, unsupported-format, source-mismatch
  and explicit migration controls remain passing. This does not certify arbitrary
  v6/v7 checkpoints or repair historical unsupported jobs-v1 snapshots.
- Full build: 67/67 tasks plus root schema generation, TypeScript and bundle pass.
- Configured root ESLint, root build TypeScript, SafeJS package TypeScript and
  package rules pass. Strict NodeNext new-test types pass after adding the required
  JSON import attribute; the initial failed gate log remains preserved.
- Configured Prettier check is scoped to the six PPR-001 delta files; no global
  reformat or unrelated files changed. All full terminal gates use `env -u TERM`.
- Full build generated four untracked terminal-pilot font assets. They are excluded
  from both prerequisite and PPR-001 publication manifests and remain untouched.
- No visual CLI change, screenshot gate, full-repository test suite, adversarial
  suite, workflow lint or security probing was part of this bounded repair.

## Remaining limitations and handoff

The old raw-v6 missing-created-work failures and historical pending-proof stalls
remain separate; this task neither edits those captures nor claims retroactive
repair. Bounded pending fulfillment here is not proof that recovery-provider stalls
are resolved. Helper-path settled-versus-consumed journal observations are also
separate; no scalar-only parity claim closes them. Historical valid v7 alias
snapshots intentionally preserve their captured split identities, while new raw
input graphs memoize aliases. Broader checkpoint compatibility remains unproven.

Candidate root: `out/safejs-remediation/ppr-001/candidate/`. The manifest records
base SHA, exact approved prerequisite, base/current preimages, PPR-001-only postimages,
all evidence hashes and validation outcomes. Separate prerequisite and PPR-001
patches prevent accidental bundling. Freeze is read-only after hash verification;
independent validation and publication are explicitly not authorized or completed.
No Git index staging, branches, commits, pushes or writes to other clones occurred.
