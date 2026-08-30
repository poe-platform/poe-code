# Independent N/Encoder Review Protocol Specification

Status: Prepared; first-stage static expectation seal only

Implemented Through: Not applicable

Purpose: Freeze independent witnesses before inspecting the separately authored additive packet.

## Normative Language

MUST and MUST NOT identify mandatory reviewer checks, not new product authority.
Root's current assignment overrides historical unresolved N1–N4 choices.

## Problem Statement

The reviewer is neither the additive-packet author nor the product implementer.
The author directory `adopted-n-encoder-v1/**` has not been read. This seal uses
root decisions, authorized historical Git objects, and primary YAML productions.
It establishes fixture independence, not a new native protocol or implementation.

## Goals and Non-Goals

Freeze a small hand-authored set and practical falsification controls. The only
owned directory is `tests/commands/yq-independent-20260828/adopted-n-encoder-review-v1/`.
Production, sibling tests, and historical evidence MUST remain read-only.
No dependencies, product imports/execution, native oracle, private access, broad
YAML research, original-cohort rescoring, or implementation authorization follows.
Original 194/80/62 cohorts overlap and MUST NOT be summed into a new denominator.

## Model and Byte Boundary

`witnesses.json` fixes 18 original records, not 18 passes. Root-required numeric
and tag spellings recur intentionally; no external suite or sibling fixture was
copied. Each `inputUtf8` is JSON-decoded once, then UTF-8 encoded, including its
terminal input LF. Literal YAML escape text therefore has doubled backslashes
in this JSON file. Invocation is the direct handler with arguments
`["-o", "json", "-c", "."]`, explicit stdin, one document and one identity yield;
ordinary caps, no cancellation, and cooperative successful sinks are assumed.

For acceptance, `jsonPayloadUtf8` is exact encoded output WITHOUT framing;
stdout is that payload followed by exactly one `0a`, status 0, empty stderr.
Decimal metadata is a descriptor, not JSON.parse of a tiny numeric token: the
nonzero value MUST NOT be replaced by its binary64 zero projection.
For refusal, stdout is empty and the pinned category/code/status are required.
Diagnostic framing is `yq: CATEGORY: CODE [at SOURCE[:LINE:COLUMN]]\n`.
Brackets denote optional fields, not literal bytes. Exact source/location suffix
bytes remain pending truthful parser metadata; no line/column is invented and no
diagnostic-byte pass is claimed. Failure must occur before any identity output.
The NUL record additionally fixes the YAML string payload; first YAML output has
no header and one framing LF. Later-output separators are outside these witnesses.

## Frozen Reasoning

### N1: Production-specific keys

Primary source: `https://yaml.org/spec/1.2.2/`, revision 1.2.2 (2021-10-01),
browsed 2026-08-28; locators only, no downloaded suite or snapshot hash claim.
Sections 7.4.2/7.5 give 140 → 141 → 142 → 144 → 148 → 160 → 157 → 109 → 110:
these top-level braced-map keys reach FLOW-IN, then 116 → 115 → 113 → 74.
Sections 6.4–6.5, productions 70–74, make one break a space and one intervening
empty line one LF, discarding continuation indentation. Thus W01/W02 differ.
The block control instead uses 187 → 188 → 192 → 193 → 155(BLOCK-KEY) →
160 → 157 → 109 → 110 → 111 and cannot contain that break.
The 154/155 single-line/1024-character restrictions also govern compact implicit
pairs via 152/153; they are not a blanket rule for all braced keys. These witnesses
have no unresolved production ambiguity; no statement about every possible key follows.

### N2: Numeric admission, not engine clamping

The inherited profile §3.3 and final contract `numericAmendments` bind lexical
admission, inclusive normalized exponent range [-1147483646, 999999999], finite
conversion, exact safe-integral magnitude and converted integral-double checks.
The pinned `numbers.ts:48–74` preserves trailing zeros, clamps zero exponents,
rounds below its minimum, and tests the upper adjusted exponent. Those operations
are NOT an implementation of rejecting lexical admission. Lines 39–45 establish
the tiny canonical token once the bounded canonical input is selected.

Root N2 requires removing NONZERO coefficient trailing zeros before normalized
range admission. For W04, digits `10`, exponent -1147483647 become digits `1`,
exponent -1147483646; exact value is nonintegral and finite conversion is +0,
which is safe, so the remaining numeric gates do not veto this tiny witness.
W05 MUST NOT normalize zero to bypass its exponent refusal. W06 cannot strip a
zero. W07's huge raw exponent token MUST be refused by bounded lexical processing,
not rounded/clamped first. No raw-exponent cutoff equal to the normalized lower
bound is invented: that would incorrectly veto W04. No BigInt or powers of ten
are allowed in this admission; existing query internals are not rewritten.

### N3, N4, and NUL

Root N3 combines only immediately adjacent literal high/low `\uXXXX` escapes
before scalar validity: W08 is U+1F9ED, W09–W13 are refusals, and W14 is the same
scalar via unchanged `\U`. This pairing policy is root's decision, not a claimed
universal YAML implementation behavior. Root N4 validates the explicit tag's
own family. Primary §§10.2.1.4 and 10.3.1–2 support integer-looking float content;
implicit first-match resolution is not an explicit-tag veto. W15/W16 preserve
the positive/negative distinction and all later numeric gates.
Root fixes NUL as the six ASCII payload characters `\u0000`, inside quotes,
not `\0`, `\x00`, raw byte zero, or a doubled literal backslash. W17/W18 and
their independent hex bytes distinguish actual NUL from literal escape text.

## Resource Decisions and Open Questions

QB-F1 is DESIGN: new yq-owned asynchronous traversals with checkpoints in NEW
files only. Existing synchronous compiler/engine/measurement/stringify phases
remain explicitly qualified. Calling a synchronous helper from an async wrapper
does not demonstrate yielding inside that helper.

QB-F2 requires whole-copy work preadmission INCLUDING checkpoint charges, with
estimation separately charged. Actual admission MUST use the same private Budget
before copying, consume once, never refund, never create per-alias/document
Budgets, and serialize against query execution. The exact mechanism is PENDING
the product author's proposal. No forwarding-only solution, inferred synchronous
yielding, implemented guarantee, or resource acceptance is sealed here. The
symbolic negative control is not a claim that an input reaches that counter state.

## Later Review State and Safety

State is PREPARED → ROOT_ROUTES_EXACT_AUTHOR_SEAL → BOUNDED_STATIC_REVIEW.
The reviewer MUST stop after PREPARED, not poll or wait on author files. On resume:

1. Record root-routed full author commit, parent(s), tree, complete scoped file
   inventory, Git blobs, SHA-256, and exact author diff. Inspect committed objects,
   not an unsealed live overlay. Authenticate this review seal independently.
2. Compare author changes with its parent and authorized checkpoint 544f8279.
   Attribute unrelated ancestor changes separately. Require additive packet scope;
   inspect any claimed product/public-export change as a scope violation, not code-go.
3. Require every protected subtree to equal its checkpoint tree before and after
   review, including filenames/modes, additions and deletions. Verify original
   cohort files against their original commits too. Query-budget already has the
   named historical addendum in the manifest; do not misreport it as a new mutation.
   These are committed-tree checks, not append-proof claims about live untracked files.
4. Inspect the author's static checker before execution. Permit only data/Git
   verification without product imports, oracle/process execution except Git,
   network, dependencies, private reads, or historical writes. Record exact checker
   blob/hash, command, result and coverage limits; do not run an unsafe checker.
5. Compare semantic expectations, numeric gates, exact payload/framing bytes,
   diagnostics, authority and resource wording against this seal. Equal JSON values
   alone do not prove literal-byte or resource requirements. Unproved outcomes stay
   pending. Mapping author records to these witnesses MUST NOT rewrite either set.
6. Run the fixed mutations in isolated reviewer-owned copies or memory. Recompute
   packet hashes for semantic mutants so hash rejection alone cannot masquerade as
   semantic detection. Old-tree controls use synthetic tree inventories only; never
   modify history. Record the specific failing check and any undetected mutation.

## Test and Validation Matrix

| Obligation | Fixed witnesses/control | Evidence required later |
| --- | --- | --- |
| N1 contexts and exact folding | W01–W03; M-FLOW | Production chain plus exact bytes |
| N2 ordering and frozen gates | W04–W07; M-RANGE | Lexical versus converted-value reasoning |
| N3 pairing and refusals | W08–W14; M-PAIR | Literal adjacency, scalar and refusal checks |
| N4 direct tag family | W15–W16; M-TAG | Positive and negative family checks |
| NUL encoding/literal distinction | W17–W18; M-NUL | Hex and payload/framing comparison |
| Original history unchanged | M-HISTORY | Complete protected tree and original-file checks |
| Resource nonacceptance | M-RESOURCE | Pending mechanism plus charged-checkpoint review |

## Conformance Criteria

First-stage readiness requires well-formed self-consistent data, source/hash
bindings, a clean owned-path diff, and an atomic explicit-path commit. It does
NOT establish author correctness. Product, author and mutation outcomes remain
unexecuted, with no pass count. Later static review must report mismatches and
pending decisions separately; no parity, superiority, full-gate or duration claim.
