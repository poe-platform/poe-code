# Expr nullable known-gap scope

## Decision and ownership

On 2026-09-02, narrow the maintained nullable audit in
`packages/safe-bash/tests/commands/expr/regex-native.cases.ts` to the 11 cases
whose results it actually asserts. Select the known-gap pattern before calling
the unchanged real command helper, assert the selection length, and attribute
each exact result assertion to the existing specimen name. Keep the existing
30-second timeout and the neighboring six unsupported-workflow checks unchanged.

The only repository writes are that cases file and this document. Do not change
the matrix generator, shared helpers, production, cohort discovery, worker
implementation, concurrency, native oracle controls, or sealed evidence.

## Deliberate coverage reduction

The original loop executed 21 patterns across 11 subjects: 231 command
invocations. Only the 11 invocations for `\(a*\)*\1` had result assertions. The
other 220 discarded their exit status, output bytes, and diagnostics. Those calls
could detect an escaping exception, rejected cleanup, process failure, or hang;
they were weak smoke coverage, not entirely without observable effects.

Remove those 220 executions rather than inventing successful results or counting
them as passes. This is **not equivalent coverage**: a failure unique to a
removed pattern can cease to be exercised here. In particular, there is no claim
that all 220 supported outcomes have equivalent live assertions elsewhere.
Many execution errors already become ordinary command error results and would
not have failed the original unchecked rows.

The retained live controls still cover matching/capture semantics, regex limits,
protocol validation, worker-only execution, and exact known-gap refusal. None of
those neighboring tests is removed. The historical matrix, native comparison
receipts, seals, old titles, and historical denominators remain unchanged; those
receipts are not presented as current regression coverage. The former title's
claim to preserve all controls is replaced with a known-gap-specific title.

## Qualification setup

Fixed HEAD: `017e562d78e772ebfcfc2ce15616d84d11f94edc`.
Parent reported no overlapping local tests/builds/edits during qualification.
All child test processes used the existing Bash-local tsx loader and the actual
Node `v22.23.2` binary:

```text
/tmp/poe-test-graph-full-20260901/node-runtime/node-v22.23.2-darwin-arm64/bin/node
```

The timed command, from `packages/safe-bash`, was:

```sh
"$NODE22" --import /private/tmp/poe-test-speed-push-20260901/packages/safe-bash/node_modules/tsx/dist/loader.mjs --test --test-concurrency=1 --test-reporter=tap tests/commands/expr/expression.test.ts
```

`NODE22` denotes the exact binary above. Every timing uses the actual maintained
cohort at its original path, not an instrumented copy. Each is a fresh isolated
serial test process; the real worker startup, requests, and awaited cleanup remain
inside the unchanged runtime. No result cache, fallback, retries, or new runner
is installed.

Original source bytes were preserved outside the repository before modification.
The sequence was original A1, candidate B1, candidate B2, original A2. Only the
owned cases file changed between variants, through patches; `cmp` verified the
restored A2 bytes against the saved original. The final file is the candidate.

Before/after each run, qualification checked HEAD and SHA-256 identities for
2,170 files: safe-bash/safe-fs/safe-js source and build trees, their manifests,
maintained expr top-level TS files, its diagnostics directory, the audit matrix,
and root manifest/lockfile. All identities were stable within each run, and the
aggregate excluding the deliberately switched cases file stayed identical across
all runs. These are explicit scoped identities, not a whole-repository seal.

- Original cases SHA-256: `c00304ce749f1099a148ef67cc25c0b5b8b6910300a6def5631eac1d7e6c852f`
- Candidate cases SHA-256: `19d8d9722463bdf520b44c5195202b3eb791fce90c21036e37f79ec96ab6dc26`

## Red/green and negative controls

Before the source change, a temporary copy imported the real helper through an
observation shim. Every call awaited the actual command and its cleanup before
recording the returned result. The bounded contract expected 17 invocations
(six neighbors plus 11 known-gap cases); the original produced 237, and the
qualification assertion rejected that count as expected. The old test itself
passed, demonstrating why a new execution-count contract was necessary.

After the change, the same observation approach recorded exactly 17 invocations.
Their complete recorded arguments, locale, exit status, stdout bytes, and stderr
equaled the corresponding baseline records. The neighboring test's source block
also remained byte-identical. Instrumented probes were outside the repository
and were not included in performance measurements.

Five independent temporary negative-control copies failed, each once without
retry:

| Control | Real executions before refusal | Required failure |
| --- | ---: | --- |
| Change first retained returned status to 0 | 7 | Exact status assertion, `nullable-audit/12/0` |
| Change first retained returned stdout hex to `780a` | 7 | Exact empty-output assertion, `nullable-audit/12/0` |
| Change first retained returned diagnostic | 7 | Exact diagnostic assertion, `nullable-audit/12/0` |
| Throw after first retained real call/cleanup | 7 | Escaping failure is not swallowed |
| Remove one selected specimen before length assertion | 6 | Selection length refuses 10 before known-gap execution |

Result corruption is applied only after real execution returns; these probes do
not replace worker execution or fake its successful completion. They establish
assertion sensitivity, not new production cleanup-fault injection coverage.

## Exact retained observations

Names are `nullable-audit/12/0` through `nullable-audit/12/10`, in order. Subjects
are `""`, `"a"`, `"aa"`, `"aaa"`, `"b"`, `"ab"`, `"aba"`, `"abab"`, `"aab"`,
`"abb"`, `"ba"`. Every invocation retains `LC_ALL=C` and arguments
`["+", subject, ":", "\\(a*\\)*\\1"]`. Every observed result was:

```json
{
  "exitCode": 2,
  "stdoutHex": "",
  "stderr": "expr: unsupported BRE: backreference to a capture in nullable repetition\n"
}
```

## Measured results

All four actual cohort runs passed **369 tests, zero failures, zero skips**.
Ordered test names were identical except for the intentional known-gap rename.
Removing 220 invocations within one test does not remove 220 Node test cases.

| Sequential run | Cohort wall ms | Node runner ms | Nullable case ms |
| --- | ---: | ---: | ---: |
| A1 original | 5467.902459 | 5435.200625 | 4219.938333 |
| B1 candidate | 1626.497417 | 1587.369042 | 219.271083 |
| B2 candidate | 1566.898708 | 1532.592750 | 234.482875 |
| A2 original | 5755.172209 | 5715.490167 | 4439.286833 |

Mean cohort wall time: **5611.537334 → 1596.698062 ms**, saving **4014.839272 ms
(71.55%)**. Mean nullable-case duration: **4329.612583 → 226.876979 ms**, saving
**4102.735604 ms (94.76%)**. Wall timing includes child startup/exit and captured
output; source hashing and receipt writing are outside the timer. These are local
paired observations, not a promised full-suite or CI improvement.

## Local validation artifacts

Evidence directory: `/tmp/poe-expr-known-gap-20260902.2XsYea/`.

- `original-regex-native.cases.ts`: preserved original bytes.
- `anchor.json`, `A1.json`, `B1.json`, `B2.json`, `A2.json`: arguments, identity
  receipts, exit status, and wall timings; corresponding `.tap` files retain all
  per-case durations and counts.
- `baseline-red-observations.jsonl`, `candidate-green-observations.jsonl`: full
  original and retained observations, not cached inputs to measured tests.
- `candidate-{status,output,diagnostic,escape,selection}.tap` and corresponding
  JSON receipts: expected failing controls and attributed diagnostics.
- `summary.json`: checked membership, unchanged neighbor block, exact retained
  observations, counts, negative-control statuses, and computed timing means.
- `qualify.mjs`, `summarize.mjs`: temporary qualification machinery only; no
  production/shared-helper/runner integration.
- `eslint.log`: scoped ESLint on the modified cases file exited 0 with no output.
  `git diff --check` also passed.

The parent retains responsibility for normal commit/push gates. No full suite or
release is claimed by this bounded qualification.
