# BOM/jq diagnostic coordination — assertion retained

**2026-08-27 UTC. No test or product edits.** This review cannot apply a
diagnostic-only correction: the current native-backed difference is **BOM JSON
acceptance, status and output**, not merely diagnostic wording. Root/Archimedes
must authorize any semantic expectation revision after their pending gates.

## Authority inspected

- Author handoff `2dd9472`,
  `tests/commands/structured-stress/jq-grammar-author-20260827/REPORT.md`, names
  structured source `b9187c0f601c278b334f5a391d552c38c433444c` and explicitly
  includes leading-BOM acceptance among native semantic corrections. Canonical
  test proposals remain unapplied.
- Independent review `f84b8e2`,
  `tests/commands/structured-stress/jq-grammar-proposal-review/REPORT.md`,
  **rejects canonical application proposal v2**. It identifies correct native
  semantic corrections but requires corrected proposal approval and separate
  source acceptance. This is neither blanket test authorization nor a request
  to restore obsolete product rejection.

## Exact native and product controls

Native executable `/usr/bin/jq`: `jq-1.7.1-apple`, build
`--with-oniguruma=builtin`, SHA-256
`1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`, matching
Arch's pin. Literal argv `[-c, .]`; no shell; five-second watchdog and 256 KiB
capture cap. The full non-inherited environment matches the independent
reference profile: `PATH=/usr/bin:/bin`, `LC_ALL=C`, `LANG=C`, `TZ=UTC`,
`NO_COLOR=1`. Cwd is this repository's `tests/shell`, not Arch's temporary cwd;
there are no filename/output-file arguments. Three semantic controls are two
unique native byte inputs, plus separate version/build metadata invocations.

| Existing test input | Exact stdin hex | Native and current product |
| --- | --- | --- |
| Plain JSON string | `7b226f6b223a317d` | exit 0; stdout `7b226f6b223a317d0a`; stderr empty |
| BOM JSON string | `efbbbf7b226f6b223a317d` | exit 0; stdout `7b226f6b223a317d0a`; stderr empty |
| BOM JSON bytes | `efbbbf7b226f6b223a317d` | exit 0; stdout `7b226f6b223a317d0a`; stderr empty |

All three exact tuples agree. Product external-sink bytes equal the returned
stdout/stderr byte fields. No product mismatch is established by these inputs.
The fixed shell source hash remains
`4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e`.

The primary tagged [jq-1.7.1 parser source](https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_parse.c),
`jv_parser_set_buf` at lines 679–709, consumes a leading `EF BB BF` prefix before
parsing values. This supports the mechanism, not automatic acceptance of a
pending canonical proposal. The measured pinned Apple executable, not an
assumed generic JSON policy, supplies these native tuples.

## Unchanged 64-test run and decision

One run of the original `bom-capture.test.ts`, with strict rejections, `tsx`,
`--test-concurrency=1`, TAP and a 20-second process cap: **63/64 pass**, one
failure, zero skips/todos/cancellations. **All 16 prior BOM text failures now
pass; byte-field/external-sink checks remain 22/22.** The direct `JSON.parse`
control passes; this leaf changes no public JSON parsing semantics.

The failing test, `existing jq plugin retains its own JSON input decoding`,
now stops at line 152: **expected exit 5, actual exit 0**. It no longer reaches
the old `jq: invalid JSON input at offset 0\n` diagnostic assertion. Merely
replacing that string cannot repair the test: accepted output is now present
and stderr is empty. Preserving exact native behavior would require revising
status and payload expectations, beyond the allowed diagnostic-only change.
No assertion is weakened, normalized, skipped, or revised here; no corrected
64-test rerun is performed without an authorized correction.

Historical `781f272` remains **63/64 with its earlier diagnostic-only failure**:
BOM inputs then exited 5 with empty stdout and a numeric-literal diagnostic.
That observation remains immutable alongside both original initial runs.
The later jq grammar acceptance change is not attributed to the shell's
two-constructor capture fix. This is not a tar byte failure.

## Coordination, proof and limits

Precise facts and the policy/authorization query are in
`/tmp/safe-bash-bom-jq-owner-coordination.txt`. It also routes the still-present
obsolete shell BOM-removal note at `src/commands/archive/README.md:58` through
root/Arch to its current documentation owner. No archive file was edited.

`bom-capture-jq-review.json` records raw TAP, all native input hashes, exact
argv/environment/version/build/byte tuples, product controls and source hashes.
All **487 guarded endpoint entries** matched during the window. Runtime source
was already under active authorship; its tested SHA-256 is
`1d303091932cfca31e1c1b0de7e35609173db7bcd71cc2fb14fd5740faeb9491`.
This is not a frozen whole-product checkpoint or protection against transient
write/revert. No repeated clean-guard attempts or author-stop requests occurred.

Only this new report/evidence pair is committed. The original test and all
earlier BOM evidence/reports, source, manifests and Arch proposals stay intact.
No broad jq/native/full/lifecycle/invocation/source-dot-eval suites, build,
dependency installation, or source-author classification changes were made.
All owned child processes completed; no delegation or watchers remain.
