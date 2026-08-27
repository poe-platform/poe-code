# Independent prepatch checkpoint — August 27, 2026

**FROZEN; candidate verification pending.** This leaf touched only its assigned
new independent directory. Original audit files, original 17/20 results and all
original fixture-scaffolding history remain unchanged. Author-owned candidate
unchanged-20 replay is outside this report's denominator.

## Freeze provenance

- Original holdouts: `8410a0c`; original `freeze.json` remains preserved.
- First scaffold evidence: `9d7e5e0`; corrected consumer freeze: `93e8022`.
- Complete second attempt: `ff11513`; final scaffold freeze:
  `d4320b06f26e57d1a16fe758244ed6b6a2c70b6b`.
- Current manifest: `freeze-scaffold-v3.json`, SHA-256
  `bab5b39938c868e68637d3b1d5c28145d3da0a7ee9ff7b6304176b2e5ca246bc`.
- Literal vector file is unchanged across all three freezes. Public package
  scope, exact FsError prefix and command-handled sink-error fixture corrections
  are disclosed in `scaffolding-correction.md`, with every earlier raw result.

## Final prepatch results

| Cohort | Passed | Failed | Total |
| --- | ---: | ---: | ---: |
| Internal attribution | 8 | 2 | 10 |
| Actual moved-package public API | 14 | 6 | 20 |
| Combined independent inventory | 22 | 8 | 30 |

No skips, cancellations or harness failures remain in the **v3** run. Both
processes exit 1 as the frozen byte failures require. The build exits 0.
All 12 native Uint8Array controls pass; Buffer cases are 10/18. Internal failures
are collector and unfinished-record retention. Public failures exercise retained
records, byte queue, exclusion queue, fixed pattern-file collection, pipeline/file
output and attempted output captured before sink rejection. Exact status and
diagnostic assertions remain intact; failure six in v3 is byte corruption, not
the erroneous rejected-promise expectation preserved in v2.

The first attempt is not a 30-case product score: internal 6 passes, 2 ownership
failures and 2 harness expectation failures; public module setup failed before
any of its 20 cases ran. V2 has internal 8/10 and public 14/20, including one
public harness expectation failure. Do not merge those histories into v3.

## Source and package identity

The 217-file prefreeze snapshot covers 212 product files plus actual package,
build/typecheck configuration, executable I/O contract tests and root AGENTS.
Every snapshot entry matches before/after the final baseline build and run.
No source changed from the final freeze; both affected source files are clean:

- `src/commands/internal.ts` SHA-256:
  `28d83d91d5086b39b50494ea1130d34c3b48b22a15dc04c2912ee2503a7536d5`
- `src/commands/streams.ts` SHA-256:
  `8966dd770c11731e5256a1e42aaec4b07ae7f0508a3e89a3efc956d27109098d`

The compiler emits only into ignored owned scratch. The actual package manifest
is copied unchanged, the built package is physically moved, and the public
consumer resolves the existing bare `virtual-bash` root export to that moved
package. The private helper cohort is explicitly not an exported API test.
All 705 package files are unchanged after testing; loader verification records
164 unique loaded package modules, including index and both affected modules.
Detailed hashes and exact commands are in `evidence/prepatch-v3-results.json`.
Strict unhandled rejection mode is enabled. Every launched child returned, and
all Shells dispose through test cleanup. No server or detached child was launched.

## Boundaries and continuation

Bare ByteSource has no prose lease-duration promise. The specific next-read and
awaited-sink schedules follow executable contract controls, not an arbitrary
concurrent-mutation obligation. Every borrowed read verifies no consumer input
mutation; finalizers zero only after control returns to the producer.

No allocation instrumentation or matched performance experiment was run. Harness
wall times are recorded, not treated as performance evidence. The source inspection
locates retention across reads; it does not justify copying every view everywhere.
Candidate copy-site/allocation observations belong in a later report, qualified by
what is actually measured. No full gate, provider certification, superiority or
72-hour duration claim follows from this scoped cohort.

After root confirms source readiness, run:

```
node tests/stress/byte-ownership-20260827/independent/run.mjs candidate
```

That immutable harness binds the candidate's current source separately, rebuilds
and moves its package, checks loaded hashes, and requires source unchanged during
execution. Use a new phase label if that label already has evidence. Do not change
frozen expectations to accommodate the author candidate. The author must not read
these holdout contents before completing the candidate.
