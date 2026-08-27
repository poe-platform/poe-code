# Independent canonical jq proposal review — REJECT v2

August 27, 2026 UTC. This is a different, non-author leaf's **test-proposal review**, not source acceptance. No product module was imported, no moving product was executed, and no canonical/source/historical file was changed. No delegation, dependencies, network, or external documentation claims. All created files use `apply_patch`.

**Verdict: REJECT the precise v2 application plan.** Its 26 rows identify the right native semantic corrections, but the replacement boundaries, byte assertions, lookup details, and naming instructions need the concrete corrections below. This does not authorize returning the implementation to stale rejection behavior. Corrected test changes still require separate independent approval and later stable source acceptance; this rejection is not a claim about the moving implementation.

## Pinned evidence

- Proposal v2 SHA-256: `73b3056266ca0022d079b0d3bcd5b02ff911d806affb8cd0811f95717c177684`.
- PROPOSAL.md SHA-256: `4acd9347610cd5a0a06b4db529c0846dfec5a2d421c1c0e02b9f8e50ad40be60`.
- canonical-before.json SHA-256: `f7513eb7bfe095b584f0430e1caa8f50eb909cdb8d316a633d264cd4ab082650`.
- Independent native-review.json SHA-256: `49db842e9677e2287336dcf057bc9521da042ba46fafde584d724598212985e8`.
- Machine-readable audit.json SHA-256: `031f5fc5c73bf9c1f1e888b6370de9ff9d3a78d952605bcf3619b31b6ed23b11`.

`inputs-before.json` pins 140 read-only inputs. `inputs-after.json` checks them again, including the proposal, all five current original files and their exact dated text snapshots, contracts, native proofs, and inventory. The separate preparation manifest from `d5b8fff` additionally verifies 235 historical files and 12 preparation files. Every original assertion block, native artifact hash, and vector hash matches. Any changed proposal input fails the check; this review never follows a newer proposal silently. Endpoint hashing does not rule out transient ABA edits.

Historical facts remain historical: original42 accepted closure `bb1ceabe`, independent **790/790** in its bounded cohort, legacy94 **45 exact / 49 gaps (43 stderr-only + 6 acceptance)**, and the original **22 red tests**. The accepted original42 checkpoint did not establish a stable whole-product pass. Nothing here renames a baseline green, adds these executions to 790, or rewrites original fixtures/results.

## Native-only observations

`native.mjs` spawned only `/usr/bin/jq`, version `jq-1.7.1-apple`, build `--with-oniguruma=builtin`, executable SHA-256 `1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`. Full environment: `PATH=/usr/bin:/bin`, `LC_ALL=C`, `LANG=C`, `TZ=UTC`, `NO_COLOR=1`; no inherited environment. Native execution used an isolated temporary cwd under this owned subtree, no host shell, a five-second watchdog, and bounded capture. Exact argv/input/status/stdoutHex/stderrHex, environment, timestamps, executable hash and cwd namespace hashes are recorded.

There are **110 vector observations, each repeated identically; 222 invocations including version/build**: 93 planned constituents (89 historical22 + 4 supplemental), 11 missing shared-loop neighbors, and six controls using the resource helper's actual default stdin `null`. These are labeled separately, not presented as 110 unique inputs. All 102 observations with an existing tuple agree; eight additional neighbor observations supply missing targeted diagnostics. No native mismatch was found.

**File-route limitation:** 91/93 planned constituents use their exact literal argv and stdin. The two `file-unicode` constituents require a regular file containing invalid UTF-8 bytes `f09f`, which text-only `apply_patch` cannot create. Their independently captured controls instead open `/dev/fd/3`, with those exact bytes, before stdin `98800a`. Both repeated outputs match the frozen literal-file oracle. These are explicitly labeled fd variants, **not** exact filename/regular-file reruns. They preserve separate byte streams, EOF and ordering, not seekability or VFS effects. Later literal-file verification remains required; these controls cannot waive it. No binary fixture was silently rewritten through another tool.

Native processes do not establish product chunk partitioning, cancellation, budgets, VFS preservation, or shell-pipeline behavior. Native writes can be coalesced by the OS. These 26 tests contain no public-shell pipeline; the resource test's `tonumber`/`fromjson` filters and the raw multi-record error filter remain intact. Separate historical/direct/public-shell pipeline cohorts must still run later.

## All 26 rows

`audit.json` independently extracts the current canonical literal inputs, matches **every constituent**, checks historical baseline classifications against the independent final evidence and preparation inventory, and records exact input/proof/expected bytes, schedules and explicit old-to-new name mappings. “Runs” means retained canonical command invocations, **not executed virtual tests in this review**. Total: **461**, with all endpoints and extra bytewise/slurp calls included.

| # | Original test name | Classification | Constituents | Runs | Historical exact / stderr / acceptance gaps |
| --- | --- | --- | ---: | ---: | --- |
| 1 | strict UTF-8 rejection remains chunk invariant (not native parity): raw-lone-continuation | stale policy | 1 | 12 | 1 / 0 / 0 |
| 2 | strict UTF-8 rejection remains chunk invariant (not native parity): raw-truncated | stale policy | 1 | 7 | 1 / 0 / 0 |
| 3 | strict UTF-8 rejection remains chunk invariant (not native parity): raw-bad-continuation | stale policy | 1 | 6 | 1 / 0 / 0 |
| 4 | strict UTF-8 rejection remains chunk invariant (not native parity): json-bad-string | stale policy | 1 | 19 | 1 / 0 / 0 |
| 5 | raw native: record-error-prefix | stale policy | 1 | 4 | 1 / 0 / 0 |
| 6 | raw native: file-unicode:-Rc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 7 | raw native: file-unicode:-Rsc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 8 | raw native: invalid:0:-Rc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 9 | raw native: invalid:0:-Rsc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 10 | raw native: invalid:1:-Rc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 11 | raw native: invalid:1:-Rsc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 12 | raw native: invalid:2:-Rc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 13 | raw native: invalid:2:-Rsc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 14 | raw native: invalid:3:-Rc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 15 | raw native: invalid:3:-Rsc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 16 | raw native: invalid:4:-Rc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 17 | raw native: invalid:4:-Rsc | stale policy | 1 | 4 | 1 / 0 / 0 |
| 18 | strict malformed JSON 14 across chunk boundaries | stale policy | 1 | 4 | 1 / 0 / 0 |
| 19 | strict malformed JSON 16 across chunk boundaries | stale policy | 1 | 4 | 1 / 0 / 0 |
| 20 | invalid UTF-8 never becomes replacement text | diagnostic mixed | 5 | 15 | 0 / 5 / 0 |
| 21 | malformed UTF-8 preserves completed JSON prefix across every chunk split | diagnostic mixed | 36 | 297 | 12 / 24 / 0 |
| 22 | valid large decimals survive while malformed JSON and division by zero fail | resource mixed composite | 29 | 29 | 13 / 10 / 6 |
| 23 | strict malformed JSON 5 across chunk boundaries | newly exposed stale assertion | 1 | 4 | outside historical22 |
| 24 | strict malformed JSON 15 across chunk boundaries | newly exposed stale assertion | 1 | 4 | outside historical22 |
| 25 | strict malformed JSON 21 across chunk boundaries | newly exposed stale assertion | 1 | 4 | outside historical22 |
| 26 | strict malformed JSON 22 across chunk boundaries | newly exposed stale assertion | 1 | 4 | outside historical22 |

Grouping **19 / 2 / 1 / 4 is verified**, not assumed. The resource composite includes all 15 JSON strings, four byte inputs, three zero-division/modulo filters, three large-decimal inputs, three arithmetic/conversion filters, and the final surrogate pair. It does not itself configure a resource ceiling; neighboring budget tests must remain separate and unchanged. No first-failure-only audit is used.

## Required corrections to v2

### R1 — row 20's replacement range includes unrelated safety tests

`propose.mjs` searches for absent end marker `for (const [argv, status]`; the current file instead has `const preflight:`. Consequently `oldAssertion` covers `structured-stress/safety.test.ts` lines 37–176, not just the intended test at lines 37–47. It includes preflight no-effect tests, null-input isolation, NUL argv, exit-status controls, output/collection/step bounds, lazy generators, stalled-host late-rejection/cancellation tests, CPU cancellation and seeded roundtrips. The prose says preserve them, but the machine edit span contradicts that promise.

**Correction:** bound this row before `const preflight:`, or use exact test-node offsets. Emit exact non-overlapping edit spans and hashes, not a replaceable suffix-to-EOF block. Verify bytes outside those spans stay identical. Treat shared loops as three edits applied once, not 4/13/6 replacements of the same block. There are six distinct target blocks overall. Never remove tests or change timeouts, signals, limits, effect counters or cleanup checks.

### R2 — hexifying decoded strings is not exact byte comparison

The proposed `Buffer.from(result.stdout).toString("hex")` and equivalent stderr assertion operate on **already decoded strings** in the stress harness and structured `run` helper. This is mutation-blind where native legitimately emits replacement characters: invalid output byte `80` decodes identically to required bytes `efbfbd`. `audit.json` supplies **14 concrete byte mutants** across 14 affected rows; every mutant passes the proposed string-derived assertion and fails actual byte equality. No product mutation or product execution was needed to demonstrate this.

**Correction:** collect copied raw byte chunks before decoding and compare `status/stdoutHex/stderrHex` from those chunks. The existing `executeBytes` path already does this for rows 1–4. For the other target files, test-local wrappers can use the existing fourth-argument sink overrides without product/shared-helper edits. Preserve the stress harness's 128 KiB per-stream capture cap and all original command limits, input, cwd, fs, cancellation signal and awaiting behavior; retain context when needed. Add a bounded test proving invalid-byte-vs-U+FFFD mutants fail. Do not call lossy reconstruction exact bytes or normalize diagnostic lines/columns/record counts.

### R3 — replacement templates and exact lookup are underspecified

Rows 1–4 literally propose `executeBytes(vector.argv!, source)`, but baseline input is `input` and each loop declares the generator function `source`, which must be called as `source()`. Row 21 has `result`, `single`, and `slurp` invocations; each needs its corresponding tuple, with slurp stdout empty, and exact stderr for **all** routes. Row 22's final surrogate invocation is inline and must be explicitly captured without deleting it.

Moreover, **six resource filters actually receive default stdin `null`** from `run`, whereas their proof keys use empty stdin. A lookup by the advertised exact `argv + inputHex + files` therefore fails for six constituents. Independent controls using actual `null` yield the same native results, but the key mismatch must be resolved explicitly, not by falling back to virtual output or ignoring input identity.

**Correction:** emit concrete assertion-site recipes for baseline `input`, each `source()`, `single`, `slurp`, every resource loop, and the inline surrogate. Pin expected lookup keys to the actual inputs, using the six newly captured default-input controls; do not change original stdin arrangements just to fit proof keys. Assert missing/duplicate lookup keys fail. The whitelist for raw overrides is exactly the 13 listed fixture IDs; leave all other raw fixture branches and original fixture bytes untouched. The 29 resource constituents and all 36 CLI mode/input pairs must remain represented.

### R4 — contradictory “all other malformed inputs fail” and stale names

Each supplemental row says “retain all other malformed inputs as exact native failures.” Taken literally in the shared loop, this wrongly includes existing accepted exponent index 20 and accepted indices 14/16 as well as the other supplemental successes. The loop has **seven successes** at indices **5, 14, 15, 16, 20, 21, 22** and sixteen failures. V2 also permits leaving success tests named “strict malformed JSON” and native-replacement tests named “strict UTF-8 rejection … (not native parity)”. That would create stale names immediately after the correction.

**Correction:** use explicit six-index overrides `{5,14,15,16,21,22}`, preserving the existing successful index-20 assertion and all other original assertions. If independently proposing stronger exact diagnostics for all 23 members, state that as a separate bounded strengthening, include every tuple and review its delta; eight needed neighbor tuples were missing from the main frozen file and are captured here. Never blanket-fail the remaining array. Publish the explicit 26-row old-to-new map (review suggestions are in `audit.json`), rename the misleading successful/replacement cases, and retain historical names/selectors/results only in their immutable dated evidence. Do not relabel a historical red run as green.

## Preservation and later obligations

Original fixture bytes/hash plus dated complete before-file snapshots **are sufficient historical preservation**, provided they are committed and kept immutable. They are not proof that a later patch preserves unaffected tests or file effects. Current raw file tests set up files and check output but contain no post-run namespace/content assertion; preserving them does not invent source-preservation coverage. Keep the independent grammar cohort's actual file/effect checks and public-shell routes. This review's native cwd hash checks are not a VFS mutation guarantee.

Before any canonical application, a different authorized reviewer must verify a corrected, hash-pinned proposal resolves R1–R4, review the concrete non-overlapping diff, and check unselected fixture/test bytes and all original schedules/guards. Complete the two literal-file native checks with an authorized binary-fixture mechanism or explicitly recorded existing immutable literal-file evidence; do not count fd controls as those checks.

Source acceptance is separate and still required: coordinate author-attested stable structured/product/build hashes; verify compiled public entry provenance; run the prepared **35/178 + 256/790 + 94/376 = 1,344** exact executions without selector changes, skips, stderr normalization or missing stages. Keep original42 closure, all legacy94 (including its five supplementary controls), neighbors, shell/direct stages, file effects, and the seven independent failure-boundary tests repeated three times. Run all retained author/canonical quota and cancellation controls, scoped/global type/build gates, and record unrelated failures honestly. Remaining real diagnostic differences require source fixes; this test review cannot excuse them.

Only after source acceptance and corrected proposal approval should root authorize a separate **TEST-ONLY** application commit, never mixed with source fixes. Independently verify the complete changed canonical files and relevant neighboring cohorts afterward, including all 461 retained invocations and unchanged shared-loop neighbors. Preserve the original22 historical selector but create new dated mapping/selection evidence for renamed live tests. New passing observations must be dated and tied to the stable source and test commits. This review establishes neither full jq parity nor whole-product completion, superiority, or 72 hours of work.

## Rechecking this review

Run `node tests/commands/structured-stress/jq-grammar-proposal-review/review.mjs check` and `node --test tests/commands/structured-stress/jq-grammar-proposal-review/validation.test.mjs`. These do not import product code. Capture/audit scripts refuse to overwrite existing evidence; new executions require separately named artifacts, not deletion or rebaselining of this review.
