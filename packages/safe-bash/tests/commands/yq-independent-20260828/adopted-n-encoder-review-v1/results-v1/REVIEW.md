# Independent N/Encoder Static Review Specification Evidence

Status: Complete bounded static review; no fixture conflict found

Implemented Through: Not applicable

Purpose: Review the routed author seal against the unchanged independent preparation, without product execution or QB mechanism acceptance.

## Normative Language

MUST and MUST NOT describe evidence boundaries, not new product requirements.
No result here authorizes implementation or final resource freeze.

## Problem Statement

This is the resumed, different reviewer from preparation commit
`fb84072aab4e5fd75ad4e3e8912a8ddc5c2194f5`, not the author or product implementer.
The original `PROTOCOL.md`, `witnesses.json`, and `manifest.json` remain byte-
and Git-mode-identical. The author packet was first read only after root routed:

- Candidate: `914d2c9b61f68adc2adf5e4297f702248c2bd5ef`.
- Actual parent: `6620463abdf7e952aaa855abfba13159a6c5cc83`.
- Decision checkpoint: `544f8279138cb1335ded08f9db638410e91c1324`.
- Author subtree: `29898a525d78447fa8f788531ca9c64076684e59`.

## Goals and Non-Goals

The review covers exactly the existing 32 author records, the original 18
independent witnesses, and seven frozen negative-control families. It adds no
input-case breadth. `check.mjs` is a static tuple/integrity comparator, NOT a YAML
parser, yq implementation, or native oracle. It imports only Node builtins.
No production, author, sibling, historical or prepared file was changed.

The inline 32-record comparison table manually annotates the author's existing
inputs using the presealed root/grammar/numeric reasoning. Expected values are
not populated from `author.expect`, and no author checker becomes the oracle.
The primary derivation remains the preparation's YAML 1.2.2 production review;
no new primary research or compatibility claim was added.

## Authentication and Provenance

`RESULTS.json` records each author/prepared file's path, Git mode/blob, SHA-256
and byte count, plus nine selected author source bindings. It records the exact
parent-to-author binary diff hash and all seven changed paths: six new packet
files and the independently inspected umbrella-index update. No production or
export changes occur in that author delta. The index's parent bytes equal the
decision checkpoint; unrelated checkpoint-to-parent changes are identified by
status-diff hash/count only, not attributed to this author or audited as QB work.

Before and after execution, seven protected historical subtrees and all 35 files
match their checkpoint membership, content and Git file modes. Their original
seal members also match. The prior query-budget length addendum is retained,
not mistaken for a new mutation. The author directory's complete six-file live
membership and bytes match the routed Git tree. These bounded live checks detect
new entries, including directories, within those scopes; they do not certify an
append-proof whole repository or arbitrary concurrent changes between snapshots.

The four legacy checkers and the author checker ran freshly from byte-
authenticated working files. Each result records command, exact checker hash,
exit status, full stdout/stderr and stdout hash. They were NOT executed in a
candidate checkout: their live HEAD is recorded, selected inputs authenticated,
and no unsealed source overlay is treated as candidate evidence. The only local
helper import is the inspected, authenticated `freeze/recipes.mjs`; it creates
bounded fixture bytes, not command results. Nested processes are read-only Git.

## Fixture Findings

All 32 expected tuples match: 12 expected accepts and 20 expected refusals.
These are static comparisons, NOT runtime passes. Their lineage remains six
prior held witnesses, seven prior controls and 19 new bounded controls.

| Author records | Independent finding |
| --- | --- |
| N1-01–04 | Braced FLOW-IN key folds the actual LF to one space; compact JSON and YAML frames agree. Block implicit and compact unbraced pair controls remain restricted and refuse. |
| N2-01–03 | `10e-1147483647` normalizes to the admitted nonzero lower-edge token; `100e-1147483649` remains below range after removing two zeros; the unnormalized one-digit lower control refuses. |
| N2-04–07 | Huge raw exponent and both out-of-range zero exponent directions refuse before clamping; zero exactly at the upper exponent boundary retains `0E+999999999`. |
| N2-08–09 | The first exact integer is 9007199254740992 and unsafe. The second exact noninteger normalizes to digits 90071992547409919/exponent -1, then binary64 rounds to that same unsafe integer. |
| N3-01–02 | Adjacent literal 16-bit pairs yield U+1F680 and U+1F642 respectively; scalar arithmetic and UTF-8 bytes agree. |
| N3-03–08 | Unpaired high/low, reversed, intervening ordinary text/escaped physical break and high/high mismatch all refuse. Removing an escaped break cannot create literal adjacency retroactively. |
| N3-09–13 | Valid `\U` remains a scalar; surrogate/out-of-range `\U` refuse. Single-quoted escape text stays literal. Raw UTF-8 surrogate bytes select `INPUT_INVALID_UTF8`, not a YAML escape diagnosis. |
| N4-01–04 | Direct float-family `7` accepts; tagged integer `7.0` refuses; tagged `.NaN` still hits the finite-value refusal; ordinary tagged integer remains accepted. |
| E-01–02 | NUL uses literal `\u0000` inside quotes. One output is hex `225c7530303030220a` (9 bytes); two outputs total 22 bytes with exactly one `---\n` separator and no first header. |

Numeric admission retains all frozen scalar/value/finite/safe gates. Baseline
clamping is not lexical admission; no power allocation or BigInt admission was
introduced. Exact suffix-free diagnostic category/code/status and empty failure
stdout match the catalogue. The optional truthful source/location suffix remains
unfrozen, as in both packets; no exact diagnostic-location pass is claimed.

## Independent Witness Relationships

All 18 preparation records remain unchanged and their byte/value descriptors
are internally consistent. W04/W05/W15/W16 have exactly matching author input
and mode. Thirteen records have explicitly mapped structural analogues, not
identical fixtures: different key text, numeric coefficient, Unicode scalar,
mismatch scalar, or NUL/literal-string content. W02 is the presealed blank-line
folding guard with no corresponding author record. This is disclosed coverage,
not an invented author result, new fixture request, or defect. The machine report
lists all relationships; none is labeled an executed product witness.

## Test and Validation Matrix

| Fresh check | Actual result and limit |
| --- | --- |
| Four original preparation checkers | Each exit 0, empty stderr. Historical 194/80/62 and hold labels remain unchanged/unrescored. |
| Author `check.mjs` | Exit 0, empty stderr; its 12 in-memory negatives executed afresh, not inherited from CHECKS.json. |
| Independent comparator | All 32 complete expectation tuples, input bytes and argv match; zero tuple mismatches. Present document/scalar/numeric/refusal-class/frame metadata is included. |
| M-NUL / M-FLOW / M-RANGE | 6 / 4 / 5 in-memory mutants rejected, including wrong escape, payload LF, literal-backslash confusion, wrong fold and range/clamping order. |
| M-PAIR / M-TAG | 7 / 2 mutants rejected: valid pair veto, each refusal class admitted, changed `\U`, implicit-first veto and int coercion. |
| M-HISTORY | 4 synthetic inventory mutants rejected: content digest, filename addition, deletion and Git executable mode. No historical file is written. |
| M-RESOURCE | 8 frozen design-control mutants rejected; includes 1024 copy units plus at least one checkpoint against 1024 remaining steps. No actual admission mechanism is evaluated. |
| write-spec checker | Review-document structure only; not semantic or runtime acceptance. |

All 36 reviewer mutants across the seven families are rejected. Mutants use
memory only; refreshed semantic-data hashes are recorded and are not the
rejection oracle. Byte-output mutants refresh their byte count and hex too.
These are static comparator/invariant rejection controls, not parser mutation
tests. The symbolic resource test is not an input reachability claim.

## Resource Chronology and Open Questions

The N author's pending-mechanism wording is its historical seal state, not an N
defect because a later-routed proposal exists. Root now reports a precise proposal
at `89e403e0` plus `6620463a`, under separate different-leaf review in
`qb-mechanism-review-v1`. Its contents were not read or audited here. Current
mechanism acceptance remains independently pending; no implementation or final
freeze is claimed. The preserved preparation's older pending wording is likewise
history and MUST NOT be silently rewritten.

No actual invalid author fixture or N/encoder semantic conflict was found.
Diagnostic suffix precision, product behavior and QB mechanism acceptance remain
outside this review's proof; the first is intentionally unfrozen, not a new issue.

## Conformance Criteria

The bounded N/encoder expectation review is complete and consistent for the exact
routed seal. Root can consolidate the separate QB result without this reviewer
waiting for it. Original overlapping cohorts MUST NOT be rescored or summed.
No implementation, final freeze, native parity, superiority or duration claim
follows. Re-running `node .../results-v1/check.mjs` prints fresh evidence only;
it does not overwrite this committed capture.
