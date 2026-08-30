# Independent jq REVIEW checkpoint — FAIL

August 27, 2026 UTC. Fresh independent leaf, no delegation. Owned changes are
only this review subtree; no product, author, root, shell, FS or archive edits,
new dependencies, external uploads, or host-jq product integration. This is a
bounded review, not full jq parity, full-product acceptance or project closure.

## Immediate requests to root / structured author (Archimedes)

1. **Host stderr failure boundary: fix retries and replay.** In
   `src/commands/structured/jq.ts:121`, `flush()` only removes queued diagnostics
   after the entire flush completes. A rejected write leaves them queued. The
   outer catch at line 187 accepts `FsError` other than EPIPE and `JqError`, then
   calls `flush(true)` again at line 191. Thus a sink rejecting EIO/JqError is
   called twice, and a successful first diagnostic is replayed after a later
   write fails. The seven independent tests record **4 pass / 3 fail**, identical
   on three strict-unhandled-rejection runs. Do not make host failures recoverable
   filter errors, retry failed host writes, replay already-written diagnostics,
   or consume later input after such failure. Preserve cancellation and limits.
   This queue/flush path is new in d1f78d4; the new tests were not run against an
   extracted previous source tree, so regression attribution is source-diff
   evidence, not a fabricated before/after runtime result.
2. **The already-frozen parse diagnostic still fails.** Exact case
   `review-fromjson-two-error-records`, argv `['-c','fromjson']`, input bytes are
   frozen in `native-frozen.json` and repeated in `legacy-native-proof.json`.
   Both routes return status 0 and stdout `[4]\nfalse\n`, correctly retaining the
   first diagnostic. Native second stderr line is
   `jq: error (at <stdin>:3): Unmatched '}' at line 1, column 6 (while parsing '{"a":}')`.
   Actual second line instead says `Invalid numeric literal at line 1, column 5`.
   `input.ts:65` falls through from an object value's closing `}` to the default
   numeric failure at offset 5; `interpreter.ts` formats that `JqParseError` for
   fromjson. Request correct parser state/error/position, not a fixture change
   or a string replacement tied to this single input.
3. **Keep remaining gaps visible.** The four reported join-arity/split-index
   diagnostics all reproduce. Existing composite assertions additionally expose
   EOF/array/object diagnostics, null-input error locations and six input
   acceptance differences below. Route product remediation to the structured
   author; root decides any follow-up beyond this bounded checkpoint. Do not
   ask this leaf to edit production or silently rewrite historical tests.

## Unchanged main review: exact denominator and result

First command, with `NODE_OPTIONS=--unhandled-rejections=strict`:

```sh
node --import tsx tests/commands/structured-stress/jq-42-independent-review/review.ts --post-handoff --structured-sha256 66dc67c31edcaf32c63b635b0d559545894ab83751b677750494fa16001ced9c --report post-handoff-d1f78d4-01
```

Exit **1**, stable source within this run. `post-handoff-d1f78d4-01.json` records
all exact status/stdout/stderr and per-stage results without normalization,
expectation changes, capability skips, or exclusions.

| Cohort | Unique vectors all routes/transports | Exact executions |
| --- | ---: | ---: |
| Whole historical independent | 155/155 | 310/310 |
| Whole historical additive | 81/81 | 162/162 |
| New frozen reviewer | 19/20 | 316/318 |
| **Total** | **255/256** | **788/790** |
| Original42, subset of historical | 42/42 | 84/84 |
| Direct route, subset of total | 255/256 | 394/395 |
| Public Shell route, subset of total | 255/256 | 394/395 |

The historical audit's **0/42** result is preserved. The original42 categories
are 17 Unicode, 2 filter-control/NUL, 11 recovery, and 12 diagnostic-only. Their
passing current replay is not an additional denominator or full parity claim.

Five reviewer malformed-UTF8/surrogate inputs have 23, 28, 27, 34 and 27 bytes.
Every interior cut is tested, plus whole and bytewise delivery, on both routes:
**134 cuts × 2 + 5 whole × 2 + 5 bytewise × 2 = 288/288**. These are part of
318 reviewer executions, not additive to 790. The other 15 reviewer cases account
for 30 executions, with the two fromjson failures. Frozen number lexemes, object
key order, copy/pipeline and recovery controls remain exact where reported pass.

## Actual 22 legacy failures: independently proved classification

The original five test files are executed with an exact-name selector derived
from author `final-owned.tap`: **22 tests, 0 pass, 22 fail, 0 skip**. The names
match all 22 author failures exactly. No original test/vector is changed. This
does not independently rerun or certify author **1439/1461** broad-owned counts.

`legacy-native-proof.json` freezes **94 bounded probes / 95 native invocations**
(one version query) before public product import, using pinned `/usr/bin/jq`,
`jq-1.7.1-apple`, executable SHA-256
`1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`.
All argv and input/file bytes are exact, local, bounded and isolated. Historical
native expectations present on selected raw/join/reviewer cases are asserted
unchanged, not replaced by author expectations. Product replay uses direct and
public Shell routes, each whole and bytewise: **164/376 pass, 212/376 fail**;
**41/94 exact vectors, 47 stderr-only, 6 status/stdout differences**. This is a
separate, overlapping diagnostic cohort, never added to 790.

| Original failing assertions | Count | Independent finding |
| --- | ---: | --- |
| Four named strict-UTF8 independent safety assertions | 4 | Native replacement; current exact. Explicit former non-native policy retirement. |
| Raw `file-unicode` two modes and five `invalid` inputs × two modes | 12 | Native replacement/file decoding; current exact. Explicit former non-native policy retirement. |
| Raw `record-error-prefix` | 1 | Native emits both x and y plus two diagnostics; current exact. Former stop-first policy retirement. |
| Strict malformed JSON 14 (low surrogate) | 1 | Native/current accept replacement, status 0. Non-native rejection expectation retired. |
| Strict malformed JSON 16 (terminal NUL) | 1 | Native/current accept `null`, status 0. Non-native rejection expectation retired. |
| `invalid UTF-8 never becomes replacement text` | 1 | Prefix/status still sound; old UTF8 regex is non-native. All five constituent cases still miss native `at EOF`. Not exact native parity. |
| CLI `malformed UTF-8 preserves completed JSON prefix...` | 1 | Prefix/status/slurp atomicity remain sound; old regex non-native. Across 36 constituent mode/input probes, 12 exact and 24 missing native `at EOF`. |
| `valid large decimals survive while malformed JSON and division by zero fail` | 1 | First failing assertion is low-surrogate rejection, now native-exact. Full composite inspection is mixed: 10/29 exact, 13 diagnostic gaps, 6 pre-existing acceptance gaps. Do not discard the entire test. |

Thus **20 first-failure causes are non-native acceptance/recovery policy
retirement** (including the composite's low surrogate), and **2 first-failure
causes are old diagnostic regexes with real residual native diagnostic gaps**.
That grouping does not erase the composite's additional gaps. Explicitly labeled
policy tests account for 17; the other three rejection assertions are independently
shown non-native, not retroactively claimed to have an explicit policy label.
Per-test probe IDs, native results and classifications are in `review.json`.

The six current status/stdout differences are inputs `NaN`, `Infinity`,
`-Infinity`, `01`, `1.`, and UTF8 BOM + `0`. Native succeeds with respectively
`null`, positive/negative maximum finite double, `1`, `1`, and `0`; virtual jq
rejects all six with status 5. They are already present inside the untouched
resource test, not a new wide corpus. The prehandoff parser's same strict
number/literal regexp and BOM-preserving decoder support a **pre-existing**
classification by read-only source inspection; no prior-source runtime execution
is claimed. Treat these as remaining compatibility gaps, not newly proved
handoff regressions or accepted parity exceptions.

The other composite diagnostic gaps include `[}`, `{"a":}`, `1e`, `truefalse`,
`[1,]`, `{"a":0,}`, four standalone invalid-UTF8 inputs, and three `-n` zero-divisor
filters. Exact bytes are frozen rather than silently treating these as passing.
No new corpus is requested beyond these existing assertion constituents.

## Four author supplementary gaps, separately crosschecked

`join-zero-arity`, `join-two-arity`, `generator-error-after-output`, and
`generator-error-before-typecheck`: **0/4 exact vectors, 0/16 exact executions**,
all stderr-only. Join status remains 3 with empty stdout; split status remains 5
and preserves the expected prefix. Join compile diagnostics lack native source
context; split indexing diagnostics lack native capitalization and quoted key.
The entire 129 join or 69 split corpus is not independently rerun here.

## Safety, typechecks, immutable evidence and source identity

- Author safety remains **10/10 × 3 = 30/30** strict executions: resource errors
  cannot be swallowed, runtime diagnostics are bounded, stdout failure does not
  become recoverable, blocked stderr cancels/cleans upstream, replacement bytes
  respect value limits, and large replacement work cooperatively cancels.
- New boundary controls remain **4/7 × 3**, not safety success: input Error/JqError
  termination and stderr Error/EPIPE behavior pass; EIO/JqError retry and queued
  diagnostic replay fail. These are host-contract checks, not native fixtures.
- Existing reviewer evidence tests **4/4**. Scoped TypeScript and global
  `npm run typecheck` both exit 0 twice, including after new boundary tests.
  The prior `evidence.test.ts:26` TS18048 is absent. No build was run by this
  leaf; author build/built-package claims remain author evidence, not recertified.
- All **170 historical paths** match audit `96db59ac`; all **15 non-README prep
  paths** match `a2a567c`, including manifest, native vectors and advisory. Only
  the local README is updated to separate historical preparation and this review.
- Every measured structured file matches **d1f78d4**, structured paths are clean,
  and every cohort starts/ends with structured SHA-256
  `66dc67c31edcaf32c63b635b0d559545894ab83751b677750494fa16001ced9c`.
- Main 790 run HEAD is `745eaa62eebbe07b7fd30dccad4a73a1669f7124`; dirty product
  SHA-256 is `121659891756be653216211bf5f9837420c181ca171a1c40d5ce87ea0ca677da`,
  **not** root's earlier `08c5e09989de486507cffa2f512700be456d5637b4120d477c07e5e2921a2cf5`.
  Later cohorts observe HEAD `1faf5e05ee91144c5b4162d41ea81ad1cdbdba09` and different
  dirty product hashes recorded in each report. All individual before/after
  comparisons are stable, but the overall product moves between cohorts.
  No clean committed-HEAD, whole-checkpoint product-stability or ABA guarantee.

Keep the FAIL checkpoint and requests above. Root should route a separate author
fix and subsequent independent rerun; this leaf does not wait for or implement it.
