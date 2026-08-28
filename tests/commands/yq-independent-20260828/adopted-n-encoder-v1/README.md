# Adopted N/Encoder Expectation Specification Evidence v1

Status: Root decisions recorded; additive exact expectations awaiting fresh independent review.

Implemented Through: Not applicable

Purpose: Seal only root's N1–N4/NUL expectations and pending resource directions over the preserved decision checkpoint.

## Problem Statement

The parent checkpoint is `544f8279138cb1335ded08f9db638410e91c1324`, not an
implementation. The current root assignment resolves its specified language and
encoder choices. `decisions.json#/rootAuthority/decisionQuotes` records those
exact excerpts; the new decisions are not attributed retroactively to 544f8279,
5783b8e0 or cfa6fbcb. This packet is evidence, not a competing product spec.

## Goals and Non-Goals

Only this new directory and the umbrella current index are writable. Original
`freeze/`, `normative/`, `query-budget/` and `reconciliation-v1/` remain unchanged,
including 194/80/62 overlapping records and their historical holds/check outputs.
No record is rescored and no unique-case union is asserted. No implementation,
dependency, external parser, native oracle, type/build execution, private access,
AGENTS copy, broader feature work or length replay is included.

## Normative Language and Authority

`MUST`/`MUST NOT` here identify already-adopted requirements, not new policy.
The sealed b311 initial profile, 5783 final contract and cfa6 root adoption remain
effective except for the exact current root deltas. Nine selected inputs and
four preserved Git subtrees are authenticated in `sources.json`; no source
archive is retained. The working parent index initially matched 544f8279.
Concurrent HEAD movement is recorded separately and is not a new module base.

## Exact Derivations and Crosswalk

### N1: original G03, production-specific scope

The input is the original G03 bytes, including a real LF inside the quotes:

```yaml
{"red
  blue": 1}
```

Primary chain: **140 → 141 → 142 → 144 → 148 → 160 → 157 → 109 → 110 →
116 → 115 → 113 → 74 → 73 → 72**, with prefix **69**. The braced entry retains
FLOW-IN; 110 selects multiline double-quoted content. The unescaped break becomes
one U+0020; the continuation indentation is presentation. Result: one string key
`red blue`, integer value `1`. Productions 154–155 and 192–193 govern the separate
implicit-key controls, not this braced entry. No collection-key support is added.

Sources: `https://yaml.org/spec/1.2.2/#742-flow-mappings`,
`https://yaml.org/spec/1.2.2/#75-flow-nodes`,
`https://yaml.org/spec/1.2.2/#731-double-quoted-style`,
`https://yaml.org/spec/1.2.2/#65-line-folding`, and §8.2.2.

N1-01 freezes compact JSON `{"red blue":1}\n` (15 bytes); N1-02 freezes existing
default YAML `"red blue": 1\n` (14 bytes). N1-03/04 retain original G04/G06
refusals. This proves the stated supported production route, not global YAML
conformance or blanket multiline-key permission. No remaining value ambiguity
is identified for G03 under the adopted production-specific reading.

### N2: nonzero normalization, no range or zero waiver

N2-01 maps original NUM-15/normative N07. `10e-1147483647` has coefficient `10`
and decimal exponent `-1147483647`. Removing its one trailing zero yields
coefficient `1`, exponent `-1147483646`, exactly the inclusive lower boundary.
Its exact value is nonzero and nonintegral; it cannot violate the exact integral
magnitude gate. Its projected double is finite safe zero, not a nonfinite or
unsafe integral double. The canonical selected-engine text is `1E-1147483646`.
This follows static `numbers.ts:30–74` inspection, not module execution.

For this identity case: argv has four entries/nine UTF-8 bytes; source is 15
bytes, raw numeric scalar 14, canonical value 13, and stdout 14 including LF.
There is one scalar node at depth zero, one input/output document/result, and no
collection members, anchors or aliases. These are far below the corresponding
fixed caps. The query is one admitted `.`. Numeric and size gates therefore do
not supply another refusal. Work/cancellation/sink behavior remains conditional
on the unchanged frozen contracts and pending resource mechanism: this packet
does not invent an exact step schedule or prove a runtime outcome.

N2-02 still normalizes below the lower boundary; N2-03 retains the original
`1e-1147483647` refusal. N2-04's oversized exponent token with coefficient `1`
still fails by bounded lexical admission, without overflow, powers or BigInt.
N2-05/06 retain zero-exponent refusals; normalization is **nonzero only**.
N2-07 preserves the accepted zero upper endpoint. N2-08/09 retain exact-unsafe
and rounded-unsafe integer gates after normalization. No premature raw-exponent
interval veto may silently re-reject the specifically adopted N2-01 case.

### N3: adjacent 16-bit escapes only

N3-01 retains original Q11 input and yields U+1F680, UTF-8 `f09f9a80`.
N3-02 retains UTF-12 and yields U+1F642, UTF-8 `f09f9982`. Scalar arithmetic is
`65536 + (high - 55296) * 1024 + (low - 56320)`, within scalar range.
The 13 records separately cover unpaired high/low, reversed, intervening ordinary
text, intervening escaped line break, and mismatched high/high forms; all refuse
with existing `INPUT_YAML_SYNTAX`. Adjacent means literal adjacency, not equality
after folding or deleting text. `\U0001F680` is unchanged; surrogate/out-of-range
`\U` values still refuse. Single-quoted backslash text stays text and malformed
UTF-8 still selects `INPUT_INVALID_UTF8`. No global decoding/filter rule changes.

### N4: direct tag-family validation

Core §10.3.2's float lexical family overlaps integer spellings; §10.2.1.4 also
admits integer-looking explicit floats. Root selects direct family validation:
N4-01 (`!!float 7`) yields numeric `7`; N4-02 (`!!int 7.0`) fails the integer
lexical family. N4-03 remains nonfinite refusal; N4-04 is the ordinary integer
control. Sources: `https://yaml.org/spec/1.2.2/#1032-tag-resolution` and
`https://yaml.org/spec/1.2.2/#10214-floating-point`.

### Encoder: exact NUL bytes, existing frames

E-01 maps ENC-07. NUL's chosen escape is the six literal ASCII characters
`\u0000`; default YAML stdout is `"\u0000"\n`, hex `225c7530303030220a`, nine
bytes. E-02 is the bounded two-document framing control: the first document has
no header; the next has `---\n`; total stdout is 22 bytes. No NUL byte occurs in
either YAML output. No escape spelling for other characters is selected.

Every byte field records literal UTF-8 text, lowercase hex and byte count.
Failure frames retain the exact catalogue category/code and existing optional
truthful source/location syntax. No line/column or diagnostic-location golden
is invented. All 54 entries stay unchanged; ALIAS_CYCLE remains the separate N5
reachability observation, not an additional closure or newly reserved code.

## Resource Directions and Open Questions

QB-F1 is **adopted design only**: new yq-owned asynchronous measurement/encoding
traversals in new files, with owned checkpoints. Existing internal compiler and
interpreter synchronous phases retain their qualifications; no broad refactor.

QB-F2 is **adopted design only**: whole-copy work preadmission includes checkpoint
charges; estimation is separately charged; actual admission precedes copying;
consume admitted work once, without refunds, new per-alias/document Budgets or
interleaved query consumption in the serialized session.

The author still owes the precise private precharge/reservation-credit mechanism
that avoids double ticks and a new shared API, before final resource freeze.
No mechanism is proposed, implemented or accepted here. The original WRK-22
helper-scope hold stays unrescored; an async wrapper does not make the old
synchronous helper yield. B01/B02 remain unchanged historical witness records.
There are no unresolved semantic choices in these 32 bounded expectations;
fresh independent review and the resource mechanism/final freeze remain pending.

Length is already fully accepted through the immutable 3387 addendum; no replay
or prerequisite is reintroduced. Future module base remains EXACT5137
`5137a74ec855a32d8a8860eb66b62eb44d11e290` plus accepted
`74361026502d76b8c2b696f9c60e410ac9b78d95` plus new yq/private-adapter paths only.

## Test and Validation Matrix

| Check | What it proves, not product acceptance |
| --- | --- |
| Four unchanged preparation checkers | Their original static byte/schema assertions still hold; historical blocker labels are not current rescoring |
| `node .../adopted-n-encoder-v1/check.mjs` | 32 data records, exact crosswalk/byte fields, selected hashes, unchanged 29-file old-tree content and complete membership before/after, plus in-memory negative controls |
| write-spec `check_spec.py README.md` | Evidence-document structure only |
| Primary review | N1 production chain and N4 lexical family manually derived; no external parser |

The new checker reads only own data, selected Git inputs and the four bounded
old packet trees. Its membership check detects added files/directories as well
as removals/content changes in those trees. It is not an append-proof check of
the entire repository. Negative controls mutate only in-memory copies; no old
artifact is rewritten. `CHECKS.json` records actual preparation outcomes.

## Conformance Criteria and Provenance

This is a 32-record additive packet, not 32 new unique product cases or passes.
`lineage` distinguishes original held witnesses, reused prior controls and new
bounded controls. The old 194/80/62 inventories and the parent crosswalk remain
unmodified/unrescored. Primary YAML 1.2.2 was browsed on 2026-08-28; no official
test-suite fixture was imported and no website snapshot/hash is claimed.
No implementation authority, resource acceptance, parity or global conformance
follows. A different fresh reviewer must inspect the sealed candidate next.
