# STR-02: global String.match no-match result

## Scope and baseline

- Author clone: `/Users/kjopek/Workspace/poe-code-safejs-string-no-match`, on `main`.
- Origin resolved from the publish clone: `git@github.com:poe-platform/poe-code.git`.
- Clone and successful `git pull --ff-only` precede investigation and edits.
- Base: `b7dfa47180e8e160bd40ca675b35073b9f422e5e`; clean initial status.
- Change only the global `String.match` empty-result conversion, with fast in-memory
  regressions. Do not change other string methods, regex cursors, or metadata.
- No commits, pushes, nested agents, other-clone writes, real LLM calls, guest I/O,
  README additions, CLI changes, or new security work.

## Audit boundary

- Bootstrap the 38 exclusions from the original `inventory-verification.json`
  `archiveReadPolicy.excludedPaths`, plus the entire audit `security/` directory,
  before reading any original payload.
- Explicit allowlist: `strings/REPORT.md` and reductions
  `r06-no-global-match.safejs`, `r01-match-metadata.safejs`,
  `r03-replacement-captures.safejs`, `r04-replacement-context.safejs`,
  `r05-global-lastindex.safejs`, `r07-zero-width-split.safejs`.
- No recursive audit scans, excluded reads/hashes/execution, or original writes.
  Copy allowlisted inputs unchanged into ignored evidence for bounded comparisons.

## Implementation and validation

1. Record base, source preimage, absent new files, policy, and input hashes under
   ignored `out/safejs-remediation/str-02/`.
2. Install with `SKIP_SYNC_SKILLS=1 npm ci`. Add tests before implementation:
   the complete original STR-02 source, native `null`, guest branch behavior,
   supported flag combinations, empty input, non-global and successful controls,
   zero-width matches, and unchanged no-match `matchAll`/`search`/replacement/split.
3. Capture RED on the unchanged implementation. Apply the minimal production fix
   and capture GREEN on identical tests.
4. Run broader string/regex tests, full SafeJS tests with `env -u TERM`, needed
   dependency build, configured package types, lint, formatting, and diff checks.
5. Compare the unchanged original reduction with native execution. Record other
   allowlisted probes as residual observations, not regressions to fix here.
6. Freeze candidate source/tests/plan, baseline preimages, validation evidence,
   and SHA-256 manifest for a later independent validator.

## Readiness boundary

STR-03, STR-04, STR-05, match metadata (STR-01), and all other audit findings remain
pending. A STR-02 pass does not mean the whole audit or strings workflow passes.
No CLI screenshot is needed for this nonvisual runtime change.

## Author validation results

| Check                                             | Result                                                     |
| ------------------------------------------------- | ---------------------------------------------------------- |
| RED, original production source                   | 22 tests: 9 fail, 13 pass                                  |
| GREEN, identical test bytes                       | 22 tests: 22 pass, 0 fail                                  |
| Broader string/regex tests                        | 5 files, 99 tests pass                                     |
| Full SafeJS suite, `env -u TERM`                  | 146 files, 4,028 pass, 39 skipped, 0 fail                  |
| Dependency/package builds, baseline and candidate | 67/67 tasks successful each                                |
| Configured package types                          | `tsc -p packages/safejs/tsconfig.json --noEmit`: exit 0    |
| Configured root build types                       | `npm run lint:types`: exit 0                               |
| SafeJS package ESLint                             | Exit 0, no warnings or errors                              |
| Three candidate files, Prettier                   | Pass                                                       |
| `git diff --check`                                | Pass                                                       |
| Complete unchanged original STR-02 source         | Native parity through source runtime and built public core |

The original STR-02 result is exactly `{ isNull: true, value: null }`. The other
five allowlisted reductions still differ from native and have unchanged baseline
return values: metadata, both replacement probes, cursor, and captured split.
They remain pending; this is not a whole-workflow PASS.

The 39 skipped tests belong to the existing test262, filesystem-conformance, and
parser-fuzz suites; no test skips were added. Test setup rejects unmocked fetch
and LLM calls, and snapshot mode is explicitly playback/error for the full suite.
All newly added tests run in memory, with no guest modules or I/O. The 22-test
GREEN assertion duration is approximately 52 ms.

Evidence includes byte-equality of the embedded original source, identical
RED/GREEN test hashes, full JSON test reports, baseline/candidate original probe
results, source preimages, and candidate copies. Only the source file, new test
file, and this plan belong to the candidate. Clone-local `.git/info/exclude`
ignores the evidence directory and four build-generated terminal font files;
no shared ignore configuration is changed.

Ready for independent validation, not independently validated. No commits or
pushes were made, and the branch/base remain unchanged.

## Ordered integration proof — August 29, 2026

This section records a new integration, not a rewrite of the historical author
results above. All old clones and captures remain read-only.

- New clone: `/Users/kjopek/Workspace/poe-code-safejs-string-no-match-integrated`.
- Publisher origin: `git@github.com:poe-platform/poe-code.git`; `main` was cloned
  and successfully pulled before investigation or edits.
- Base: `afe59a77fa318acf72162a1970306147fdfc5428`.
- First prerequisite: all six approved STR04 files, manifest SHA-256
  `b417b5e79962ee3f6fbcfcf85e23e6efbd4d50adf94411db113db24005654e5f`.
- Second prerequisite: all six approved metadata-only files, manifest SHA-256
  `fdc814b784fe91260513833d081f61af3297dbf616ae1b994926089d2f7052e3`.
- STR02 input: the five validated files, manifest SHA-256
  `91870e73fb885bef3067544ca238d6d915730cdbce56df374040baca7c54f45c`.
- Separate prerequisite manifests, base preimages, post-prerequisite preimages,
  and the STR02-only delta are captured under ignored
  `out/safejs-remediation/str-02-integration/`. These are logical ordered states,
  not commits. The two prerequisites must never be included in a STR02 commit.

All approved file and ancestor hashes were checked before application. The two
prerequisite merges were clean and produced byte-identical approved files.
The original 22 author tests and 189 independent tests were installed unchanged
before applying STR02. On the exact prerequisite-only production state they
reproduced 54 failures and 157 passes: 9/13 author and 45/144 independent.
STR02 therefore was not incidentally fixed by the prerequisites. The 1,439 STR04
and 192 metadata tests passed on this prerequisite-only state.

The three-way STR02 merge against its recorded ancestor reported one overlapping
hunk: STR04 replaces the collector's `regex` argument with its cursor-aware
`matcher`. The resolution preserves that whole current hunk and adds only
`if (methodName === "match" && matches.length === 0) return null;` after the
collector call. No old whole-file replacement was used. STR03 replacement-token
logic, STR04 cursor behavior, metadata order, and all unrelated main changes are
retained. There is no STR05 fix in this delta.

The remaining gates are the combined 1,842 original assertions, unchanged native
no-match workflow, broader prior controls, full SafeJS suite, full root build,
configured source/root/new-test types, lint, all 16 publishable files' formatting,
and exact assertion/report preservation. Only this author plan may gain appended
integration evidence; validator tests and reports retain their approved bytes.

The 38 archived exclusions and entire audit `security/` directory were denied
before original payload access. The only original payload allowlisted here is
`strings/reductions/r06-no-global-match.safejs`; its full unchanged bytes are
copied for bounded native/runtime checks. No recursive audit scan, excluded
read/hash/execution, original write, real LLM call, guest I/O, security work,
README edit, branch, commit, push, or publication authorization is involved.

This is author integration evidence. Godel's independent merged review remains
required; historical approvals do not certify this new combined candidate.

### Completed integration gates

- Ordered GREEN: 1,842 passed, none failed or skipped. This includes unchanged
  author STR02 22, independent STR02 189, STR04 1,439, and metadata 192 assertions.
- Broader prior controls: 3,212 passed across 37 files, including all 161 STR03
  replacement tests, prior array/alias/metadata controls, and 36 MC001 controls.
- Full SafeJS: 6,560 passed, 39 existing skips, zero failures, 168 files. This is
  the package suite, not a claim that the repository-wide suite passed.
- Full `env -u TERM npm run build`: 67 workspace tasks passed, root code generation
  and bundle completed. Configured package, root, and explicit new-test types,
  repository ESLint, package lint, all-publishable formatting, and diff checks pass.
- The unchanged original source matches its complete native result
  `{ isNull: true, value: null }` in two source-runtime and two built-core runs.
  Native evaluation precedes SafeJS; no output fields or source bytes are removed.
- All six publishable test files and all validator reports retain their approved
  bytes. Historical assertion names/statuses and this plan's original prefix are
  preserved; only the author integration section is appended.

The seven historical qualification assertions were also copied without changes
and rerun separately. Six pass now: array match metadata access, metadata key
order, both STR03 substitution cases, STR04 cursor state, and the undefined split
capture control. STR05 zero-width split remains the one failure. Its assertion is
not weakened, skipped, or counted in the 1,842 scoped GREEN assertions; no STR05
implementation change is included. Whole strings/audit parity remains false.

One operational deviation is retained in the evidence: the first qualification
configuration used `mergeConfig`, which concatenated the root include patterns
and started a broader repository test run. That run was stopped, not reported as
a pass. The configuration now replaces `test.include`, and the explicit file
filter reruns exactly the seven original qualification assertions. The stopped
run's log is preserved as `qualifications-scope-error.log`. Playback/error mode
was explicit throughout, and the publishable working-tree scope remained exactly
the same 16 files. No unrelated test or production fix was made.

The final immutable handoff separates six STR04 prerequisite files, six
metadata-only prerequisite files, and the five-file STR02 delta against their
recorded post-prerequisite state. The shared string source is represented in
both its prerequisite and final forms, yielding 16 distinct final paths. No git
staging, commit, push, branch creation, or publication approval is part of this
handoff. Independent merged review by Godel is still pending.
