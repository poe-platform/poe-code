# Independent STR05 ordered integration validation

Date: August 29, 2026. Role: independent validator, not author or publisher.

## Decision

**READY for the scoped STR05 ordered combination**, with the Git-index operational
qualification below. All selected functional, native, build, compiler, lint, and
full root gates pass. This is not publication authorization: root must explicitly
approve. No future main-branch merge or full gate is certified by this review.

Reviewed clone:
`/Users/kjopek/Workspace/poe-code-safejs-split-captures-integrated`.
Frozen base: `3180c4c3a1f3d125d1b2916357438e9167694fa6`.
Author manifest: `out/safejs-remediation/str-05-integration/manifest.json`.
Verified SHA-256:
`94044c224d27805b21267af1b6643de21dad2ff9e6f490ea5856b6547c3f5ba9`.

Only this new report is added to publishable working files. No production code,
existing test, previous report, README, other clone, or original archive was
modified. There was no nested delegation, intentional Git mutation command,
commit, branch, push, security research, guest I/O, or live LLM call.

## Exact ordered scope

All **148** author artifacts, five author publishables, and four copied approved
input manifests were independently hash-verified. Approved inputs are:

- STR04: `b417b5e79962ee3f6fbcfcf85e23e6efbd4d50adf94411db113db24005654e5f`.
- Metadata order: `fdc814b784fe91260513833d081f61af3297dbf616ae1b994926089d2f7052e3`.
- STR02 ordered: `e7e9b68fa086dcd0a9428e75c91ff4cf3b2c356f9a2b80af7d13c262e0a29583`.
- STR05 standalone: `a87ddee6928bc8074bec855c5e26402cff6120a289bafcc328edb3ab557791a6`.

All six STR04 delivery paths already match the frozen Git base. They are upstream
references, not another prerequisite to reapply. Metadata's six files and STR02's
six files are separate ordered prerequisite deliveries. Every recorded stage
preimage was checked against the preceding logical state, starting with Git blob
bytes. All **21 distinct combined paths** match their expected final bytes.

Read-only `git merge-file --diff3 -p` independently reconstructed STR05 from its
approved ancestor, approved standalone candidate, and post-STR02 source. It exited
zero with no conflicts and produced the exact current `string.ts`. The relevant
SHA-256 values are:

- STR05's historical standalone ancestor:
  `f836cb3508b1c9602f2d558cb68fdae9615d43d1b8da9504a62585cbd1b0981b`.
- Current frozen-base `string.ts`, already containing STR04:
  `95d643bfce0a5dbb56b0187a2e21ca5efca8ce2977f3de1331e5831f452dae67`.
- STR05 application preimage, **after metadata and STR02**:
  `2696168fb53f438095045126d27813ef2750be20d5a0172f0c7cb1928621d4f7`.
- Reviewed STR05 postimage:
  `c9424ef6ca0161241527ddb02490a5505c229d0596fe3fdb602a7a2faae0cdd3`.

AST comparison confirms **only `callSplit` changes**. Every other top-level
statement is byte-identical to the post-STR02 source, preserving STR03 replacement
tokens, STR04 cursor behavior, and STR02's null guard. Metadata order is unchanged.
The fix skips spurious zero-width matches at the copied-through position or input
end and retains the appropriate final suffix. It does not replace legitimate own
`undefined` captures with empty strings, holes, or null. This is not a new capture
coercion fix or a whole-old-file overwrite.

The author's original STR05 plan remains an exact prefix with its integration
appendix. The old independent report and both STR05 test files are unchanged.
All six prerequisite test files and the historical seven-qualification file are
also byte-identical. No assertion, native oracle, source, skip, or unsupported-flag
boundary was weakened. Historical report statements remain historical evidence,
not silently edited to describe the new combination.

## Audit boundary and originals

Before reading or hashing any original payload, the allowed inventory metadata
bootstrapped exactly **38 excluded paths**, plus the entire archive `security/`
directory. The concrete payload allowlist contains only these captured functional
sources under the archive's `strings/` tree:

- `examples/01-marked-table.safejs`.
- `examples/06-template-replacement-unicode.safejs`.
- `reductions/r01-match-metadata.safejs`.
- `reductions/r03-replacement-captures.safejs`.
- `reductions/r04-replacement-context.safejs`.
- `reductions/r05-global-lastindex.safejs`.
- `reductions/r06-no-global-match.safejs`.
- `reductions/r07-zero-width-split.safejs`.
- `reductions/r08-unicode-and-anchors.safejs`.
- `reductions/r09-repeated-captures.safejs`.

Only approved copies inside this new clone were read and executed. No fresh
original-archive payload was read; the sole archive read was the permitted
inventory metadata. All ten source hashes also match the independently validated
standalone STR05 manifest. There were no recursive archive scans or recorded
excluded payload reads, hashes, or executions. This records this worker's
operations; it is **not an operating-system-wide access audit**.

Fresh native evaluation preceded runtime comparison and matched the historical
typed V8 values. An independent exact-source wrapper ran every full original
output twice through the actual source package. The prerequisite-only state
retained a genuine 9-pass/1-fail original gate; the STR05 candidate passes all ten.
Every original also matches freshly recomputed native output twice through the
built public core. No source was adapted, and all five r07 fields are checked.

Strict comparisons and V8 serialization preserve typed undefined and array-slot
distinctions; JSON alone is not the oracle. Separate source and built-core probes
each ran twice and verified:

- `"xaZ".split(/a(b)?/)` has a real own undefined slot: `["x", undefined, "Z"]`.
- `"xaZ".split(/a(b*)/)` contains an empty capture, not undefined.
- Interior zero-width capture slots remain valid where native creates them.
- Own undefined differs from a deliberately constructed hole, empty string, and
  null; own-key sets and absent terminal slots are checked explicitly.
- V8 round trips retain both own undefined and the deliberately missing hole.

All guest runs were finite, with empty module maps and explicit budgets for the
independent original/slot probes. The unchanged package tests use their existing
bounded package/direct-method harnesses. No guest file access or LLM is involved.

## Independent RED and GREEN

RED uses a read-only Vite load override of the exact post-STR02 preimage. It does
not alter production files and is not presented as the raw Git-base result. All
**2,704 full test identities** match the author's current runs and are identical
between the independent RED and GREEN selections.

| Gate                                           |   Pass | Fail | Skip | Scope                               |
| ---------------------------------------------- | -----: | ---: | ---: | ----------------------------------- |
| Author STR05 cases, prerequisite-only RED      |     36 |   13 |    0 | Unchanged 49 tests                  |
| Independent STR05 cases, prerequisite-only RED |    627 |  186 |    0 | Unchanged 813 tests                 |
| Combined eight files, prerequisite-only RED    |  2,505 |  199 |    0 | All prior 1,842 remain green        |
| STR05 current                                  |    862 |    0 |    0 | 49 author plus 813 independent      |
| Prior STR04/metadata/STR02 current             |  1,842 |    0 |    0 | 1,439 plus 192 plus 211             |
| Combined focused current                       |  2,704 |    0 |    0 | Eight unchanged package files       |
| Historical qualifications, prerequisite-only   |      6 |    1 |    0 | Strict STR05 failure retained       |
| Historical qualifications, current             |      7 |    0 |    0 | Same seven tests and native oracles |
| Full originals, prerequisite-only              |      9 |    1 |    0 | Full r07 failure retained           |
| Full originals, current                        |     10 |    0 |    0 | Each full output twice              |
| Relevant broader current                       |  4,074 |    0 |    0 | Exact 39-file selection             |
| SafeJS package current                         |  7,472 |    0 |   39 | 172 files                           |
| Configured root current, forced uncached       | 24,857 |    0 |   41 | 964 files                           |

The configured root gate ran through
`turbo run test:unit --concurrency=1 --force --` with verbose and JSON reporters;
it exited zero without a cache hit. Exact arguments and environment are captured.

These totals overlap and are not additive. The 813-case suite checks supported
`g`, `i`, `m`, `s` combinations, zero-width and empty-input behavior, capture limits,
literal/omitted separators, UTF-16 code units, cursor preservation, and genuine
own-slot distinctions. The unchanged rejection cases do not add `u`, `y`, `gy`,
`gu`, `d`, or `v` support. Broader selection includes STR03 substitutions,
ARRAY properties, COLL iteration/typing, OBJ aliases, and MC regressions.

Historical standalone originals were six exact/four failing; the approved
prerequisites make nine exact/one failing; STR05 makes all ten exact. The prior
metadata, STR02, STR04, and STR05 failure evidence is retained, not waived. The
unchanged seven-qualification test now passes normally without marking the former
STR05 failure as expected. There is no remaining failure in these selected gates.

## Configured gates and execution controls

Tests use `TERM` unset, snapshot playback, and snapshot-miss errors. Root setup
rejects unmocked fetch and LLM calls. Subprocess HOME, XDG cache/config, npm cache,
and temporary paths are redirected into this clone's ignored runtime directory;
`SKIP_SYNC_SKILLS=1` prevents real-home skill synchronization. No user-home or other
clone writes are performed by this worker.

- `npm run build`: 67/67 workspace tasks successful, all cached, followed by
  successful root code generation, compilation, and bundling.
- Workspace declarations precede root and explicit test compiler checks.
- `tsc -p packages/safejs/tsconfig.json --noEmit`: pass.
- `tsc -p out/safejs-remediation/str-05-ordered-validation/tmp/test-types.tsconfig.json --noEmit`:
  pass. Saved `--showConfig` confirms 11 roots: eight package test files, the COLL
  typing fixture, unchanged qualifications, and the independent original wrapper.
- `npm run lint`: pass, including configured ESLint, root types, and workflow lint.
- `npm run lint:packages`: pass, all 17 rules across 68 packages.
- Prettier check of all 22 distinct combined publishable paths, including all
  prerequisite reports and this report: pass.
- `git diff --check`: pass.

Qualification/original configs replace `test.include` and also use explicit exact
file filters. Each resulting report contains only the intended one-file cohort;
there is no `mergeConfig` include concatenation. The full root test is deliberately
selected and forced uncached, not an accidental expanded qualification run.
The old stopped run is not retrospectively counted as a pass.

An initial metadata lookup for a nonexistent historical-controls result returned
ENOENT without writes. The comparison was then made against the correct
manifest-listed `qualifications-red.json`; both test identities and diagnostics
are preserved. This was not a test failure or a discarded gate result.

## Git-state qualification

Despite `GIT_OPTIONAL_LOCKS=0` and no deliberate Git mutation command, `.git/index`
changed from `74aeda026229d4ff7be97f283a755b7651497ff4bdee5e57e4d5bd1b8232943d`
to `5fdbead3423d7de13b6d8bfff0cb6f27fc1900b29947f0f8206f8d6f52652c6c`.
It was first observed across the configured-lint interval overlapping the root
run; the cause is not established and is not attributed to either command.
All **3,758** staged path/mode/object entries exactly equal HEAD, the staged diff
is empty, and HEAD/config/exclude hashes remain unchanged. No restoration was
attempted. Strict Git metadata immutability is therefore **not certified**.
This qualification must accompany the functional result.

## Freeze and publisher boundary

The final STR05-only publication list consists of the five author delivery files
plus this new report. Separate metadata and STR02 prerequisite deliveries are
reference-only, as are the six already-upstream STR04 paths. Exact post-STR02
application preimages and validation-entry preimages are distinct from historical
ancestor and frozen-base bytes. No logical state is invented as a Git commit.

The immutable candidate is frozen under
`out/safejs-remediation/str-05-ordered-validation/tmp/candidate-3180c4c3-str05-only`.
Only its explicit six publishables are STR05 delivery files; prerequisites,
preimages, provenance, and evidence must not be blanket-published.

Readiness does not grant publication authorization. Root must explicitly approve,
and the publisher must verify actual future-target preimages and run fresh
independent/full gates on that actual combination. This review does not claim
global JavaScript/string parity, untested flag/descriptor support, all audit issues
resolved, or future-main correctness. Later string merges require fresh validation.
