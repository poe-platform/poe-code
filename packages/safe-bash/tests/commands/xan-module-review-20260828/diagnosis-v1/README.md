# Independent XAN diagnosis v1 — original outcomes unchanged

Friday, August 28, 2026. Ownership: **only this new subtree**. No delegated
children, product execution, native probes, network, dependencies, product/config
edits or original-evidence writes. Source inspection and synthetic planning are
postcandidate. This is bounded diagnosis, not completion of the full review.

## Classification from authenticated RAW records

Both layouts have 667 original IDs. SOURCE remains **569 PASS / 79 FAIL / 19
BLOCKED**; MOVED remains **570 / 79 / 18**. All **195** failed/nonpass outcomes
(158 FAIL + 37 BLOCKED) have individual case/raw/obligation/subassertion bindings
in CASES.json. Each raw file and selected line is hashed against the archived
result, never a live continuation directory. Original mapping omits five failed
flag variants per layout; diagnosis explicitly associates their original rule
IDs and records that distinction rather than silently editing the old 161 map.

| Root cause | Class | SOURCE | MOVED | Representative RAW case |
|---|---|---:|---:|---|
| Equivalent wording/option alias excluded | VERIFIER | 10 FAIL | 10 FAIL | X4-R04/P0 |
| Generic diagnostic specificity undecided | POLICY TENSION | 15 FAIL | 15 FAIL | X4-S01/P0 |
| Output options appended after `--` | VERIFIER | 45 FAIL | 45 FAIL | X4-R01/file-split |
| Middleware discards result (3 workflows + 2 origins) | VERIFIER | 5 FAIL | 5 FAIL | F01-files |
| Async bridge/middleware lose cancellation provenance | VERIFIER confound | 2 FAIL | 2 FAIL | F08-shell-mapped-status-not-escaping |
| Exact diagnostic versus exhausted work/capacity | POLICY TENSION | 2 FAIL | 2 FAIL | F11-ledger-maxWork--1 |
| Default work/capacity ledger unimplemented | VERIFIER incomplete | 6 BLOCKED | 6 BLOCKED | F11-default-maxWork-0 |
| Generator omits depth-one witness | VERIFIER incomplete | 2 BLOCKED | 2 BLOCKED | F11-default-maxSelectorDepth--1 |
| No legal frozen depth-three witness | Verification limitation, not product failure | 2 BLOCKED | 2 BLOCKED | F11-default-maxSelectorDepth-1 |
| Even-only output generator misses odd targets | VERIFIER incomplete | 4 BLOCKED | 4 BLOCKED | F11-small-maxOutputBytes--1 |
| Two-authority conflict never injected | VERIFIER incomplete | 1 BLOCKED | 1 BLOCKED | F10-authority-conflict |
| Cooperative 35-second incomplete attempt | RESOURCE CUTOFF | 4 BLOCKED | 3 BLOCKED | F11-default-maxInputBytes-0 |

Thus the prior “25 matcher failures” is **10 verified mechanical equivalents +
15 held specificity interpretations**, not 25 proven verifier-only errors.
The eight generator nonpasses are **2 depth-one omissions + 2 depth-three
grammar limitations + 4 odd-output omissions** per layout. The depth-one reason
incorrectly mentions depth three. None establishes a product impossibility.
The conflict raw really attempted a *single same-answer* invocation despite the
summary's `attempted:false`; the intended conflict was not attempted. No original
FAIL in this set is promoted to PASS or claimed a conclusively isolated PRODUCT
bug. Precedence remains confounded and F11 policy unresolved; independent static
source findings belong to the other worker.

## Retention and qualification boundaries

- Continuation archive: 1,304 files / 90,695,294 payload bytes, SHA256
  `05619a20fc1ce8012b5dd3539b3e37a47070fb9c799b39d13248fdc8d44e88d8`.
  Streaming verification checks every entry against its seal, bounded at 96 MiB
  per JSONL line and 256 MiB total; no extraction and no raw CLI dump.
- Every failed/nonpass case has both RAW_OBSERVATION and CASE lines. This does
  **not** mean every desired field was retained. Pipeline intermediate bytes are
  absent (`stageBytes:[]`); alias-h's first full result is absent, though its stdout
  was asserted in memory. File workflow retains both intermediate files.
- Resource input/output payloads are digest-only. The unused collector's empty
  `stdoutBase64` is **not** zero actual output. Cutoff output/input byte totals
  and digests are partial, not complete witnesses. All 7 cutoff attempts drain.
- Filephase failures occur before intended selector/header validation because
  `-o out.csv` is parsed as operands. Zero reads/no output alone cannot qualify
  the intended pre-I/O or post-header phase. Case matchers fail before later
  phase/cleanup assertions; raw events are observations, not those assertions.
- F11.md traces first quota exhaustion, every reservation/release, exact frozen
  34/43-byte diagnostics, zero emission, residual budgets and all 18 configured
  caps. Arithmetic is static implementation-counter accounting, not measured
  allocation or complete normative ledger coverage.

## Artifacts and seals

`BINDINGS.json`: exact pinned source excerpts and hashes. `CASES.json`: each
original failed/nonpass case and remaining subassertions. `CORRECTIONS.json` plus
`corrections.mjs`: four-family versioned transforms, not installed changes.
`CONTINUATION.md`: executable preparation recipe, semantic holds and parent gap.
`qualify.mjs`: post-seal synthetic controls only; no actual 79-case replay.
`PRE.json` and its atomic commit seal the recipe **before** qualification.
The subsequent handoff/result seal records actual synthetic outcomes separately.

Run synthetic qualification only against the explicit pre-seal commit in a fresh
owned snapshot containing exactly PRE's inputs. The initial-name and final-name
checks detect newly added entries; they are not merely original-path checks.
Run `node tests/commands/xan-module-review-20260828/diagnosis-v1/diagnose.mjs <result-commit>`
from repository root to reproduce committed diagnosis from original archived evidence.
That read-only script never loads the product or rescores old assertions.
