# Independent YAML Specification Audit — PRECODE

Status: Prepared independent review; four case choices blocked; no code-go.

Implemented Through: Not applicable

Purpose: Audit the adopted restricted profile against primary YAML grammar and selected Decimal source without creating another product specification.

## Problem Statement

Root adopted a restricted YAML 1.2.2 Core reader over the existing jq dialect,
not full YAML, Mike Farah syntax, or an implemented command. This review checks
whether an independent author can freeze exact cases without silently deciding
an unspecified boundary. It reports **no unconditional contradiction proven**;
N1 identifies a conditional grammar contradiction under an overbroad reading.
Four cases are blocked rather than assigned invented status/output goldens.

## Goals and Non-Goals

Scope is grammar/Core, lexical numeric admission, tags/keys, anchor records,
streams, block chomping, quoted Unicode, information forms, and related codes.
Product source, other reviewers' packets, and historical authority are read-only.
There are no product/native/reference/YAML-parser executions, dependency changes,
official-fixture imports, whole-repository archives, or AGENTS copies.
Budget/depth/private-session implementation review belongs to query-budget;
large cap recipes and future replay infrastructure belong to case-freeze.

## Normative Language and Authority

`MUST`, `MUST NOT`, and `SHOULD` refer only to the adopted authority or cited
primary specification. This informative packet creates no new normative policy.

Effective order is immutable initial-profile-v1 at
`b311c2364ceca13daab4086dfb21157b9b8ae856`, amended by final-contract-v1 at
`5783b8e03912f7774d2a86ba1dae9de778121273`, then only the additive
final-adoption-v1 at `cfa6fbcb72c5a3e228c4ffbea7cb1719827b2707`.
The initial profile's old status labels and superseded restrictions do not
override that chain. DESIGN.md is historical proposal/context, not a competing
current CLI or encoder policy. Historical 270fedbe, 0b8064d2, e9db2157 and b311
full revisions and ancestry are recorded in `selected-inputs.json`.

Eight selected files were authenticated from exact Git revisions, including the
two final-contract hashes quoted by root. Each matched both inspected HEAD
`16c4502da78ac209e8979d7bd576f2be5492f104` and working bytes. HEAD had moved from
`c62662548c74832376ca4a84d19272ada356c053` during concurrent work. This is not
a whole-tree/current-candidate qualification. No historical source tree was
copied or modified. The checker reports later selected-file differences instead
of attributing unrelated concurrent changes to this review.
The fixed source revision `5137a74ec855a32d8a8860eb66b62eb44d11e290` is **not**
an ancestor of that inspected HEAD (`merge-base --is-ancestor` exits 1).
Its authority is the explicit sealed source binding and matching numeric blob,
not assumed ancestry; its actual tree and parent are recorded in the manifest.

## Findings and Open Questions

### N1 — High: implicit-key scope needs an unambiguous freeze

Binding: `final-contract-v1/contract.json#/languageAmendments/implicitKeyGrammar`.
Case: **G03**, `{"red\n  blue": 1}` (the fixture contains an actual line break).

YAML productions 140–149 pass ordinary braced map entries through FLOW-IN;
the single-line/1024-character bound belongs to 154–155 and 192–193, not every
entry lacking `?`. Therefore G03 is valid YAML. A blanket reading of the
contract's implicit-key sentence contradicts that grammar. A production-specific
reading is consistent; **the sentence alone does not prove that blanket intent**.
See primary §7.4.2 and §8.2.2, also §7.3.1 production 110, and the official
1.2.2 changes page's separate flow-mapping-key length note.

Blocked choice: explicitly confirm the production-specific reading, or identify
an intentional extra profile restriction and its approved diagnostic. Under the
latter reading, `INPUT_YAML_SYNTAX` cannot truthfully mean that YAML itself is
malformed. No new diagnostic or public limit is invented here. G04/G06 are
actual malformed-key controls; G05 is the explicitly permitted key form.
The 1024 bound where applicable measures source presentation through separation
before `:`, not just decoded scalar length; escapes and quotes matter.

### N2 — High: trailing-zero normalization changes range admission

Bindings: b311 README §3.3 steps 2–4; final `numericAmendments`; authenticated
`numbers.ts:48–74`. Case: **N07**, `10e-1147483647`.

The adopted phrase is “normalized decimal exponent”, without an explicit
trailing-zero normalization rule. Removing the trailing coefficient zero gives
digits `1`, exponent `-1147483646`, inside the interval. Preserving it gives
digits `10`, exponent `-1147483647`, outside. The selected engine preserves
trailing zeros at lines 56–57, then rounds/clamps at 60–70; it does not implement
the proposed rejecting lexical validator. The upper source test also uses
`exponent + digits.length - 1`, not the same raw exponent as the lower test.

Blocked choice: state the canonical coefficient/exponent transformation before
the profile range check. Reading the two constants is insufficient. An explicit
pre-conversion rejection can intentionally be stricter than the engine; that is
not itself a contradiction. N06 has no normalization escape and is a settled
range refusal. N05 preserves a nonzero Decimal whose binary64 projection is zero.
Input admission is not silently extended to every intermediate query literal.

### N3 — Medium: paired surrogate escape validation stage is unstated

Bindings: adoption `resolvedGrammar.quotedNbJson.retainedSafety/qualification`;
b311 §3.1. Case: **Q11**, `"\uD83D\uDE80"` (literal escape characters).

Primary §5.2 describes code points; §5.7 productions 60–61 describe individual
Unicode escapes. The adopted rules require scalar validity and no unpaired
surrogates, but do not expressly say whether adjacent `\u` escapes are assembled
as UTF-16 before that check. Reject-each-surrogate and assemble-then-validate
produce different outcomes. The libyaml maintainers' issue 110 documents the
same distinction; it is contextual evidence, not normative permission.

Blocked choice: identify the validation stage and permitted pairing, if any.
Q10 remains a mandatory unpaired-surrogate refusal; Q07's `\U0001F680` is a
settled scalar; Q12 is invalid UTF-8, independent of escape grammar. No new
quoted-printable blacklist is permitted by this question.

### N4 — Medium: explicit float family overlaps implicit integer family

Bindings: b311 §3.2 “corresponding Core lexical family” and “does not coerce
content from another family”; catalogue `SCHEMA_TAG_LEXEME_MISMATCH`.
Case: **T13**, `!!float 7`.

Core's decimal integer and finite-float regexes overlap; first-match implicit
resolution selects integer, while the explicit float tag admits integer-looking
lexemes (primary §10.2.1.4 and §10.3.2). Direct tag-family validation and first
implicit-family validation disagree here. The no-other-family sentence needs
an explicit interpretation; rejecting this valid YAML would be an added profile
restriction, not an inherent YAML error.

Blocked choice: confirm direct validation of the explicit tag's lexical family
or expressly settle the narrower rule. T06 independently forbids trimming a
block scalar's retained final LF to make a tagged integer lexeme valid.

### N5 — Low: cycle-code reachability is not demonstrated

The finite catalogue has **54 unique entries**, not 54 demonstrated reachable
failure classes. Root explicitly reserves `ALIAS_DUPLICATE_ANCHOR`; it remains
unemitted and is not deleted or repurposed. Also, completed-only immutable
anchor targets with recursive copies leave no obvious indirect cycle: an alias
to an active pending record already selects `ALIAS_CURRENT_NODE` at that
source location. No normal-input witness for `ALIAS_CYCLE` is established here.
This is a reachability/selection observation, not permission to remove that
entry, add behavior, or assert a 54-code execution-coverage result.

## Settled Amendments and Deliberate Restrictions

- Y1 removes the old quoted DEL/C1/noncharacter blacklist, not fatal UTF-8 or
  scalar validity. Q01–Q15 distinguish raw text, escapes, folding, and invalid
  bytes. Output remains escaped printable YAML; semantic fixtures do not choose
  between equivalent YAML escape spellings.
- Y2 defines event records: new pending bindings shadow old completed ones;
  older completion cannot restore a shadowed record. A01–A03 exercise reuse,
  refusal without fallback, and nested completion ordering. A06 is duplicate
  properties on one node, not permitted name reuse across nodes.
- Every definition event counts toward 1024 per document. The case-freeze
  packet owns the 1024/1025 recipes; this packet does not count those external
  cases as its own evidence. Deep-copy identity and ordering need future runtime
  checks; equal JSON-shaped values alone do not prove either.
- T03 is valid Core YAML deliberately refused by the plain-untagged-merge
  rule. Quoted, explicit-string, block, and alias-derived ordinary string keys
  are not merge operations. Unknown/non-specific tags, non-string keys,
  nonfinite numbers, unsafe integers, other directives and encodings are
  declared restrictions, not newly discovered conformance bugs.
- Percent escapes are not decoded when comparing verbatim tags (primary §5.6
  production 39 and §6.9.1). T07 therefore does not create an allow-list alias.
- Help/version forms and hashes match the adopted bytes: help 501 bytes,
  version 37 bytes, exact version `virtual-bash restricted YAML profile\n`.
  The nine information forms are frozen separately. All advertised options
  occur in C1; optional leading eval/e qualifies “sole argument” in the usage.
  No unsupported flag or native/package version claim was found in the help.
  The actual filters are jq dialect, with no eval-all/slurp/write/schema flags.
- Information-token precedence is deliberately stronger than ordinary `--`
  termination: C10 follows the explicit amendment, not a guessed POSIX rule.
  Attached `-ojson` is not accepted; `-o json` is. JSON-only `-c`/`-r` and
  per-document/per-yield sequencing remain unchanged.

## Primary Source Pinpoints and Provenance

Browsed with `web.run` on 2026-08-28; no parser or native yq was invoked.
Revision is YAML 1.2.2, dated 2021-10-01. These are locators, not a retained
website snapshot or hash claim. No official test-suite fixtures were imported;
the original synthetic inputs need no imported fixture license notice.

| Topic | Primary locator and production/section |
| --- | --- |
| Characters/encoding/escapes | `https://yaml.org/spec/1.2.2/#51-character-set`; §§5.1–5.7, productions 1–3, 24–40, 42–62 |
| Tags and anchors | `https://yaml.org/spec/1.2.2/#69-node-properties`; productions 96–104, §§6.9–7.1 |
| Quoted/plain scalars | `https://yaml.org/spec/1.2.2/#73-flow-scalar-styles`; productions 107–135 |
| Flow-key distinction | `https://yaml.org/spec/1.2.2/#742-flow-mappings`; productions 140–155 |
| Flow-map length historical clarification | `https://yaml.org/spec/1.2.2/ext/changes/`; Changes in version 1.2 (Revision 1.2.0), flow mapping keys |
| Explicit/implicit block keys | `https://yaml.org/spec/1.2.2/#822-block-mappings`; productions 187–194 |
| Block scalar semantics | `https://yaml.org/spec/1.2.2/#8112-block-chomping-indicator`; productions 162–182 |
| Streams/prefixes/markers | `https://yaml.org/spec/1.2.2/#92-streams`; productions 202–211 |
| Core/numeric tags | `https://yaml.org/spec/1.2.2/#1032-tag-resolution`; §§10.2.1.3–4, 10.3.1–2 |
| Surrogate distinction, non-normative context | `https://github.com/yaml/libyaml/issues/110`; issue description, opened 2018-03-02; not a product oracle |

## Test and Validation Matrix

`cases.json` contains **80 original records**: 34 semantic-document expectations,
one retained-Decimal expectation, 32 diagnostic expectations, nine information
forms, and four blocked choices. These are case counts, not a conformance score
or an executed denominator. Single records may contain several scalars/docs;
they are not expanded into an inflated case count.

| Preparation check | Evidence and limit |
| --- | --- |
| Authority authentication | `selected-inputs.json`: eight exact files, full Git revisions/blobs/SHA-256; selected ancestry/current comparisons only |
| Packet structure | `node tests/commands/yq-independent-20260828/normative/check-static.mjs`: own JSON schema, unique IDs, frozen counts, code/category/status lookup, blocked-case non-goldens |
| Information bytes | Same checker: fixed help/version hashes, lengths and nine independently listed forms |
| Document discipline | write-spec bundled `check_spec.py REVIEW.md`: structural audit-document check, not normative correctness |
| Grammar reasoning | Manual primary-source review mapped to Q/B/G/T/A/S records; no YAML parser execution |
| Numeric reasoning | Static selected `numbers.ts` reading and N records; no baseline module imported/executed |
| Future implementation acceptance | Not performed; requires resolved choices and independently authorized product/replay checks |

`check-static.mjs` is opt-in preparation tooling, not a canonical product test.
It reads only this packet and exact selected Git/working files, writes nothing,
and does not import product code. It does not authenticate a full candidate,
detect arbitrary new repository entries, or certify runtime behavior.

## Coordination and Conformance Criteria

Sibling query-budget and freeze packets were inspected read-only after they
appeared. Their Decimal clamping observation agrees with N2; freeze NUM-15
already blocks the same trailing-zero choice. No duplicate implementation or
resource review is claimed. See `COORDINATION.md` for the bounded handoff.

This packet is ready for root's decision review, **not implementation acceptance**.
No conformance, parity, superiority, full-gate, duration, or product-pass claim
follows. Resolve N1–N4 explicitly before treating their four fixtures as goldens;
retain all historical authority and the finite catalogue unchanged meanwhile.
