# Independent native preflight and scheduling review

## Bounded result — August 27, 2026

Reviewed committed **4d0507cd3439d5e4dea60ae20d023d3fcb9662f1**, including the
21049bed preflight guards and3ee476a8 public exit78 correction. The selected
preflight helper/policy and public entry bytes are authenticated against those
commits; no mutable-root configuration or product file is edited.

**148/148 independent outer checks pass, zero skips.** This includes the
unchanged26/26 author guard tests, replayed independently on frozen selected
source. Counts below describe nested observations, not additional product passes.

| Observation | Result |
| --- | --- |
| Actual pinned native prerequisite assets |49/49, exact bytes;42 executable and7 source/data |
| Each asset missing or changed |49+49 negative profiles |
| Each mandatory executable loses execute bits |42 negative profiles |
| Both public routes for every negative profile |**280/280 exit78**, zero launcher-import sentinels |
| Real native staging |34 declared targets; bytes authenticated |
| Changed staged bytes / lost execute bits |every applicable staged target refuses final validation |
| Public guard mutants |eager import and dropped-native-issues both detected |
| Actual package evaluator, concurrency2 |six files complete; peak2, repeated twice |
| Restored trailing-option ordering mutant |peak6; same concurrency assertion detects it |
| Forwarded unknown option |exit9, no fixture callback starts |
| Forwarded name filter |only control2 starts and finishes |

The positive miniature repository admits `--preflight-only` without importing
the launcher. Its `--execute` route imports one harmless sentinel module. This
positive control prevents an always-refuse implementation from passing the
negatives. The actual product launcher is **never imported or executed**.

## Public guard evidence

All49 origins come from the unchanged policy, with `TREE_NATIVE_BIN` explicitly
bound to the retained authenticated tree2.2.1 development binary. Neither PATH
substitution nor unavailable-native skipping is used. The tree binary and its
recorded source archive are also checked separately against their sealed
metadata. This verifies existing local bytes, not a new upstream download,
rebuild, supply-chain attestation or native semantic comparison.

The independent public matrix uses an isolated miniature Git repository and
regular-file copies of the real49 assets. Its declared source/canonical inputs
are explicit unit-fixture inputs, not a forged product candidate. One prerequisite
at a time is removed, changed or made nonexecutable **only in that owned copy**.
Each unchanged public entry invocation reports exactly its corresponding native
issue, status78, no output directory and no launcher import. The other48 remain
available, preventing an unrelated refusal from masking the selected failure.

140 negative profiles run both `--preflight-only` and `--execute`:280 refusals.
Missing/changed source-data files are mandatory too; execute-bit requirements
apply only to the42 executables, not to the seven source/data inputs.

The eager-import mutation still returns78 but writes the sentinel: the no-import
assertion detects it. The dropped-native-issues mutation returns0 and imports the
sentinel: that assertion detects it too. These source mutations affect only
temporary fixture copies. The unchanged26 author tests retain their separate
two admission/native-issue mutants and source/dirty/canonical-binding controls.

The complete frozen policy still names **b494675c** and intentionally refuses
the newer4d0507cd candidate as unreviewed.49/49 native availability is **not**
admission of a new whole gate. The known historical policy failures, typing
workflow changes and source drift are not waived or rebased. Root must authorize
a new candidate-specific policy before any future whole execution.

## Scheduling and discovery

The actual committed `package.json` evaluator runs six small generated `.test.ts`
files with the cached development tools copied as regular files. Each callback
records start/end and awaits300ms. `--test-concurrency=2` precedes filenames in
the child arguments. Two independent runs show exactly two active callbacks,
all six unique starts and finishes, and no unclosed activity. The old3ee476a8
evaluator reaches six, demonstrating the ordering defect rather than just
asserting a source-string shape.

The current evaluator also preserves the exact native raw-fixture exclusion:
a deliberately throwing `.test.ts` underneath that existing excluded directory
is not discovered. A name-pattern option selects only the intended callback;
an unknown Node option prevents all callbacks. No product test deadline,
timeout policy, regex probe or test expectation is relaxed. The miniature
timers measure file scheduling only, not performance or internal worker caps.

## Preserved attempts and cleanup

First attempt: **144/148**, preserved verbatim. Three changed-byte mutations
(gtar, system Bash3.2 and GNU strings) and the staged-byte loop failed in the
review harness with EACCES because their owned copied files retained0555 modes.
The original files were never modified. The corrected harness temporarily adds
owner-write permission only to its disposable copies while writing fixture
bytes, restores the original mode before assessment, and restores bytes/modes
afterward. Assertions, required hashes and production source remain unchanged.
Final result:148/148. Original runner bytes are `evidence/first/audit.mjs.data`.

All49 original assets and the two tree artifacts retain their bytes/modes through
both intervals. All frozen selected source inputs retain their hashes. Every
synchronous child settles without timeout or signal; exact owned Git fixtures,
native copies, staging roots, generated tests and copied tool directories are
removed. The26-test replay invokes seven copied GNU tools only with `--version`;
there is no product/native differential workload, service or whole suite.

Node22.22.2, Darwin arm64; Node executable SHA256 is in each report. Scheduling
uses cached tools copied as regular files; this native-only harness does not
claim the full per-tool-file census recorded by the separate typing audit.
Final interval: August27,2026,13:08:20–13:08:56 UTC.

## Reproduce

```sh
node tests/integration/native-preflight-independent-20260827/verify.mjs
node tests/integration/native-preflight-independent-20260827/audit.mjs /tmp/NEW-NATIVE-REVIEW
```

The verifier authenticates stored raw observations and frozen source identities.
The audit reruns only these bounded guard/miniature-scheduling controls and
requires the exact existing native prerequisites. It does not install tools,
write their originals, change root configuration, or authorize a whole gate.
