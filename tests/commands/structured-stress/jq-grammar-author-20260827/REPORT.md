# jq grammar source-author handoff — August 27, 2026

**AUTHOR HANDOFF ONLY.** Another independent leaf must review the source and the unapplied canonical TEST-ONLY proposals. This is not full jq, full shell, superiority, project closure, or evidence of 72 hours worked.

## Revisions and ownership

- Source: `b9187c0f601c278b334f5a391d552c38c433444c` — exactly six structured source files; no archive/network/shell/FS/root/package/export/documentation edits.
- Frozen validation/evidence payload: `97bf80100140bf746efb8c0dec9f77dddcfef207` — 173 explicit owned files in this new subtree. This report is a subsequent documentation-only handoff commit, not part of that payload hash.
- Stable structured source SHA-256: `120a10c34d96b26f584c6e4349ef9098c0537d76952078e70e9ce6ab5c3f0176`, using the unchanged review common.mjs sourceSnapshot() algorithm.
- Accepted starting source: `0278a3032d7851de4c2f5141bbc863cdf310c39d`, structured SHA-256 `30c573976d4dddb5e8e545f8e3914aeb166e0232f92ed0dfe20514205056db8f`; accepted independent evidence `bb1ceabef3a3a4c3791af64d9efb7384f6ca773f`.
- The package is still virtual-bash, with zero runtime dependencies and unchanged public exports. No native process/eval wrapper is added to product code.
- No delegation occurred. All owned test processes finished; no active owned children. Owned source/evidence paths were clean before adding this report. Final CLI handoff records the report commit and post-commit owned cleanliness.

## Source changes

The JSON input path now has a shared incremental byte/token parser for direct input and fromjson/tonumber. It keeps separate string/escape/nesting state, byte-based line/column locations, complete-token validation and streaming output. Quoted strings and keys never pass through a global numeric replacement. UTF-8/BOM sequences can cross chunks; a single JSON parser spans input files, while per-source readBytes preserves cancellation and iterator closure.

Numeric tokens preserve native decimal lexemes and distinct parsed NaN/infinity values until rendering. The ordinary nan/infinite/isnan/isinfinite filters support the observed semantics. Equality is distinct from ordering, including parsed-NaN identity and IEEE NaN results; containment, subtraction, unique/grouping use equality rather than a sort comparator. Remainders use bounded 64-bit integer conversion and native NaN/zero behavior without unbounded integer allocation.

The parser supplies native EOF versus delimiter failures, malformed closer diagnostics and exact byte offsets. Runtime diagnostics retain stdin/file locations and the null-input unknown-location form. Compiler arity errors include multiline source context, byte-column padding and multiple-error counts. split/2 remains explicitly unsupported: no regex flag stub or unrelated grammar feature is added.

Stdout failures now retain the thrown object's identity for EPIPE, EIO, ordinary Error and JqError, with no fallback stderr write or replay. This exposes a conflict with one old author JqError-sink assertion; that change is **contract-backed, not native oracle evidence**, and is flagged for independent review rather than silently rewriting the test.

## Native evidence and profile

Executable: `/usr/bin/jq`; version: `jq-1.7.1-apple`; build: `--with-oniguruma=builtin`; executable SHA-256: `1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`.

Initial996 + extra111 + equality24 vectors were frozen against the accepted starting structured hash **before any source edit**. Subsequent context70, file72, internal-boundary15, arithmetic734 and integer-bound32 cohorts record their then-current source hashes before corresponding followup remediation. All expected bytes remain frozen. The final casefold70 check was post-source validation, passed without source changes, and is separate from pre-fix evidence.

Capture programs generally explicitly use LC_ALL=C, LANG=C, TZ=UTC and TERM=dumb. The equality24 one-shot capture inherited its environment instead of supplying those overrides; it is not falsely labeled an explicitly C-locale capture. All use isolated argv without a shell. The executable pin is unchanged at final verification. Official jq 1.7 documentation and tagged jq-1.7.1 jv_parse.c, jv.c, builtin.c and locfile.c were consulted; native bytes, not assumed JSON.stringify/IEEE behavior, determine expectations.

## Final measured results

Every final command and raw output is in committed-r3-*.json, with source hashes before and after each cohort. The complete recorded r3 phase is stable for both structured and broader source hashes; it still is **not a clean committed-HEAD validation**, because other workers have uncommitted files and evidence/test artifacts are separate commits.

| Cohort | Final result | Counting boundary |
| --- | --- | --- |
| Unchanged independent main | **790/790 executions, 256/256 vectors** | All original routes/chunks and direct pipeline-stage checks retained |
| Original42 subset | 42/42 vectors, 84 base-route executions | Subset of main, not extra tests |
| Historical155 / additive81 | 310/310 / 162/162 executions | Subsets of main |
| Reviewer20 / chunk subset | 318/318 / 288/288 executions | Chunk subset overlaps reviewer20/main |
| Immutable legacy94 | **94/94 exact, 376/376 executions** | Both original direct/Shell and whole/bytewise routes |
| Expanded legacy94 | 3106/3106 exact executions | Every split endpoint plus original fixed chunk sizes; same94, not new vectors |
| Small author-native neighbors | 2039/2039 vectors, 36306/36306 executions | Both routes, whole/bytewise and every interior split; includes file stream chunking |
| Internal 16384-byte boundary | 15/15 vectors, 330/330 executions | Declared boundary/chunk set, not all16384 split positions |
| Final casefold supplement | 70/70 vectors, 280/280 executions | Post-source review, no source change |
| New author node:test suite | **2157/2157** | 2039 +94 +15 frozen-vector tests and9 limit/error controls; overlaps rows above |
| Original seven stderr boundary controls | 7/7 on each of3 runs | Separate repetitions, not21 unique scenarios |
| Earlier historical / nearby suites | 238/238 and117/117 | Preserved as their own cohorts |
| Earlier author114 | **113/114** | One unchanged host-JqError expectation conflict |
| Earlier author safety | **15/16 on each of3 runs** | Same host-JqError conflict, no skipped controls |
| Whole unchanged structured suite | **1550/1580, 30 failures** | No skips/cancellations; all30 explicitly classified |
| Scoped / global TypeScript | Pass / pass | Current moving worktree; no unowned fixes made |
| Full in-memory build | Pass,520 emitted artifacts, zero diagnostics | Root build configuration, only outDir redirected to memory |
| Built root ESM smoke | 10/10 exact |5 existing vectors × direct/Shell; overlaps main |

The driver collects all statuses even when old tests fail. Its exit0 is not a green-suite signal. Read the individual status fields and checkpoint.

## Original49 gap closure and remaining work

Historical baseline stays **45 exact /49 differences:43 stderr-only +6 status/stdout**. The unchanged original94 now has **zero measured differences**. All49 before/after exact reproductions are retained in native-gap-closure.json and NATIVE-GAPS.md. NaN, ±Infinity, leading-zero and trailing-decimal numbers, and leading BOM are accepted with their native serializer/filter semantics rather than converted by global string replacement.

The canonical test suite is intentionally not made green by this source author:

1. **Original22**:19 first-failure policy retirements already matched native at the starting point;2 stale UTF-8 regex tests also contained real native diagnostic gaps;1 resource composite combined obsolete rejections with6 real acceptance gaps and10 diagnostic gaps. Do not rewrite that history as all22 being merely stale.
2. **Four additional acceptance assertions** become red when [01], leading BOM, -Infinity and NaN correctly succeed.
3. **Three additional diagnostic assertions** expect old one-line/generic arity errors, but the source now emits exact native compiler context.
4. **One host-sink assertion** expects JqError conversion to status5. Latest user requirements call for sink identity/no extra writes. This is a separately labeled contract decision requiring independent approval, not native-backed retirement.

PROPOSAL.md plus planned-test-only-changes-v2.json contains old paths/names, exact assertion blocks, immutable file snapshots, native vector IDs/hashes, expected tuples and proposed replacements for22+4. PROPOSAL-ADDITIONAL.md plus additional-test-only-proposal.json covers the3 native diagnostic replacements and the1 host-sink contract decision. **No proposed canonical change is applied.** Root must schedule a different independent leaf and a separate TEST-ONLY followup commit.

Known broader limitations remain: split(regex;flags) is unsupported; the full jq language/options/builtins are not implemented or exhaustively compared; an exploratory huge native string multiplication exceeded its2-second watchdog and yielded no semantic oracle result. That timeout is retained in native-timeout-observation.json, not counted as a pass or silently discarded from history. Historical source README statements about strict UTF-8 and stopping on the first runtime error remain for the documentation owner to reconcile; this leaf did not edit those docs.

## Failed attempts and historical evidence

- Baseline neighbor result:241/996 exact,964/3984 executions. First source pass:972/996, with remaining source-context/null-arithmetic differences; later all996 pass.
- Arithmetic expansion initially708/734, exposing26 real equality/remainder differences; final734/734 after source fixes.
- A newly written stdout EIO control initially failed because the host error became a command diagnostic. It now preserves identity. The initial own FsError test constructor also caused a scoped TypeScript error; the test setup was corrected, not hidden.
- The first broad finalization run had1544/1580 and exposed five genuine cancellation/iterator-close regressions from raw async-generator file joining. Per-source readBytes fixed them; all original cancellation tests now pass. The retained final30 failures are the classified expectation conflicts, not those regressions.
- The r2 broad phase saw a concurrent change to unowned src/commands/archive/README.md. Its structured hash stayed stable, but its broader product hash did not. The committed-r3 rerun is separately recorded and stable; r2 is not overwritten or retrospectively called stable.
- Early standalone global typechecking reported four unowned S3/shell test errors. Later captured global checks pass; this leaf did not change those files.
- The first PROPOSAL.md generation rejected its uppercase artifact name after writing v1 JSON. The corrected v2 supplies complete supplemental assertion blocks. Both versions and the setup explanation remain visible.
- Preserve distinct historical checkpoints: original42 **0/42**, prior independent **788/790**, prior host boundary **4/7** on three runs, accepted exact closure **790/790**, historical legacy **45/49**, and original **22 red**. They are not pooled into present totals or overwritten.
- **547 accepted historical files**—structured tests/evidence and frozen integration reports—match bb1ceabef3a3a4c3791af64d9efb7384f6ca773f byte-for-byte. ARTIFACTS.sha256 seals this evidence payload; canonical snapshots and all old reports stay immutable.

## Reproduce and review

From the repository root, use a fresh prefix; commands refuse to overwrite artifacts:

~~~sh
node tests/commands/structured-stress/jq-grammar-author-20260827/validate.mjs independent-fresh
node tests/commands/structured-stress/jq-grammar-author-20260827/immutable.mjs independent-fresh-immutable.json
node --import tsx tests/commands/structured-stress/jq-grammar-author-20260827/replay.mjs casefold independent-fresh-casefold.json
~~~

Build validation deliberately uses the existing compiler configuration and in-memory module hooks instead of writing unowned dist. It is not an npm-script or packed-install test. Source/evidence commits are separate, and this report follows as documentation only. Capture window starts 2026-08-27T01:37:14.060Z; report recorded 2026-08-27T02:11:34.804Z. That is a bounded author work window, not a72-hour-duration claim.
