# Candidate source-inspection qualifications

Date: August 28, 2026. These are static observations and author-claim boundaries,
not independent behavior results. The accepted 194-record/eight-overlay normative
freeze at `bd471ef682d768692a682d40009a874f51e3ad68` and verification
`de89e478d8ddce62eac955708f1b87d7be1bd137` predate the candidate. This worker read
candidate bodies and author fixture text before complete successor executor
preseal. That inspection is not an independent precode behavioral holdout.

## Provenance and membership limits

The immutable handoff is
`065f824d06e36de3fafaee1b7a5baa278f40407c:tests/commands/yq-author-20260828/repair-allocation-v1/HANDOFF.md`.
The source commit's observed write set contains five product modifications:
`src/commands/structured/query-core.ts`, `src/commands/yq/accounting.ts`,
`src/commands/yq/encoder.ts`, `src/commands/yq/index.ts`, and
`src/commands/yq/parser.ts`. Its two additional modifications are the author
repair `PROTOCOL.md` and `repair.test.ts`; the proposed production selection
excludes them. A commit write set alone is not a verified selected-source delta.

Initial JSON reading counted 281 author-manifest entries, including eight test
data paths. The author reports a 273-entry source archive and a complete 870-entry
package. A 271-entry consumer projection is the expected baseline-plus-seven
selection, not an independently verified successor projection in this packet.
The stopped audit did not authenticate raw artifact SHA or inspect tar entries.
No verified 846+24 composition, README equality, package changed-file count,
complete projection hash or whole-candidate Git tree identity is claimed.

## Four finding boundaries

- WRK-06: the author's C+1 raw-document rejection is not at-C success. The frozen
  public document cap is 8,388,608 raw bytes. The source parser's initial scan
  charges content codepoints, including comments, through the actual command's
  shared work budget before composition. A specific at-C ASCII comment witness
  with 8,388,606 scanned content codepoints plus CRLF exceeds the fixed
  `maxSteps = 1,000,000` gate already at that scan, before further query/checkpoint
  costs. This is static arithmetic for that witness, not a universal public-cap
  impossibility theorem or an executed at-C result.
- WRK-07: author repair fixture `parseOne` calls the real parser with a real YQ
  ledger but `noopWork`; its actual fixed scalar C/C+1 claim is AUTHOR-only and
  not a real-command shared-Budget success proof. For the specific quoted ASCII
  witness containing 1,048,576 `a` characters, scanning source text entails
  1,048,578 codepoints, already greater than frozen `maxSteps = 1,000,000`.
  This particular public witness is masked by that gate. No claim is made that
  every representation at the 1,048,576-byte scalar cap is unreachable.
- WRK-13: parser ledger/event observations and structural/reversed-order controls
  belong to the author repair evidence; static inspection does not independently
  prove pre-materialization collection admission or unchanged behavior.
- WRK-17: YAML/JSON encoder checks with internal `maxBytes` 7 and 8 are
  `PROOF_CONTROL`, not lowered public boundaries or fixed-public-output-cap
  acceptance. The public output caps remain unchanged. No public cap obligation
  is replaced by these controls.

These statements refer to the selected new-origin accounting, parser, index and
query-core files at `b8f5d60d75452e1dd181167fb87abd995221f6e3`, and author repair
fixture text at `e889e5236ec5666977697bb758dce510d689efe3`. No cap was lowered,
state injected, fixture invoked or proof of repaired behavior manufactured here.
The CARRY checkpoint width remains 1023; no CARRY policy is changed.

## Evidence roles

Author 9 repair controls, 26 YQ controls, 19 parent-jq controls and 18 capture
roles remain AUTHOR-only, including build/types, actual Shell, offline install,
physical move and negative-binding claims. Their reported passes are not ours.
The new package remains an author artifact; even a later successful byte binding
would be `BOUND_AUTHOR_BUILD`, not independent source-to-output proof.

Old immutable tool identities and scoped-build/map-relocation/packing methods may
be referenced, but require fresh tool verification and an independently compiled
new source before reuse as build proof. All affected source, installed and moved
semantics, loaded-code controls, actual consumer types and fixed-public-cap
obligations remain future work. Direct module entries are not public integration;
the handoff explicitly keeps public/default YQ integration held. No global
typecheck or full-feature green is claimed.
