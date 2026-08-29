# CBI-001 independent retained-callback validation

## Scope and boundaries

Independent validator, not the author. Work only in the isolated callback-delivery
clone at base `c51139ecafcf5c8a0604788ccde914610d600d62`. Author files are frozen;
their manifest hashes were verified before validation. No production, README,
master-plan, dependency, Git-state, other-clone, or original-audit writes.

Read ancestor/root instructions as the delegated worker. Before original audit
payload reads, bootstrap `inventory.json.archiveReadPolicy.excludedPaths`: exactly
38 exclusions plus the entire security directory. Only explicitly allowlisted
ordinary callback review reports, sources, results, and checkpoints may be read.
No archive-wide/family search, security probes, LLMs, or guest real I/O.

## Execution plan

1. Inspect native TypeScript replay/reissue anchors and public callback contract.
2. Run original native anchors before SafeJS, then independently recapture the
   unchanged four original source/input/public-hook protocols in current format.
   Retain honest archived-format refusals without editing version markers.
3. Repeat first/second/completed resumes in fresh bounded processes, checking
   full values, lexical aliases, call identities, callbacks, nested work, and
   synchronous registry-only replay hooks. Compare current-base behavior through
   an in-memory preimage overlay without modifying frozen production files.
4. Add a dedicated in-memory validation test for four identical retained events,
   different payloads, new registrations, genuine pending reissue prefix
   deduplication and new suffix events, and finite capture/proof controls.
   Pending joined workflows are controls, never substitutes for the original.
5. Run focused/broader tests, types, lint and format; unset TERM for repository
   terminal gates. Capture exact commands, outcomes and immutable candidate
   author/validator bytes, preimages, base identities and SHA-256 manifest.

## Contract qualification

Completed-registration retention is supported here only within the reviewed
source-awaited resumed-run lifecycle. The broader contract remains implicit;
this does not establish arbitrary post-run delivery, legacy snapshot migration,
or all-external exactly-once guarantees. Other replay/core changes require fresh
integrated publisher validation. No release or overall-goal completion is claimed.

## Results

**CBI-001 scoped validation: READY. Repository/release certification: BLOCKED.**
The candidate is suitable for this issue's integration review, not publication.
All evidence is under `out/safejs-remediation/cbi-001-validation/`.

### Source inspection

`interp/host-bridge.ts` initializes `nextReissuedInvocation` only on the path
that actually calls the restored native operation. Completed replay and
external reconciliation return earlier. Historical callbacks reconstruct their
closures through the scheduled replay entries, independently of that cursor.
The adapter consumes a historical result only when the reissue cursor exists;
otherwise it waits for live execution and records/invokes a new callback.
Callback-ID and argument comparison remain intact for genuine reissues.

This agrees with `packages/safejs/CHECKPOINT_REPLAY.md` sections on synchronous
local restoration, callback history, and external reconciliation. The completed
registration's retention beyond its own return remains an implicit contract,
qualified exactly as above.

### Original workflow evidence

The driver body SHA-256 is
`8cee592ac1d0308c310c7ecb50822e1c8e12d8cf4d9f36c73d7933d9f60e7400`,
identical to the archived review and frozen author driver. All four source bodies
and input configurations are unchanged. Native controls ran first, followed by
current source TypeScript; no dist imports or substitute joined workflow.

Forty GREEN executions: four native, four uninterrupted, eight automatic
captures, and 24 fresh-process resumes (four workflows, first/second/completed,
two independent repeats each). Every full return value matches the native
anchor. The 24 resumes also match exact issued/replayed operation order, preserve
historical call IDs and digests, retain two callback records, never reissue the
completed registration, and invoke the rebound OLD adapter outside replay hooks.
First-boundary resumes execute the missing nested second step(s).

| Original case     | Native/full GREEN state                                                                                               | Exact-base first-boundary RED, twice                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Identical counter | total 4, count 2, first 2, second 4                                                                                   | Successful stale total 2, count 1, first 2, second 2                   |
| Distinct counter  | total 5, count 2, first 2, second 5                                                                                   | Callback-argument reconciliation refusal against consumed registration |
| Retained map      | total 39, values `[6,17,3,13]`, first `{values:[6,17],total:23}`, second `{values:[3,13],total:39}`, active 0, peak 2 | Same callback-argument refusal                                         |
| No-input counter  | total 4, count 2, first 2, second 4; zero input-journal entries                                                       | Same successful stale total 2/count 1                                  |

All expected object/input/promise aliases are true. Counter GREEN traces are
`["registered","input:1","callback:1","done:1","callback:2","done:2"]`;
the no-input case omits `"input:1"`. The map trace is
`["registered","input:3","callback:first","done:first","callback:second","done:second"]`.
RED silent-loss traces omit the final callback/done pair. Full original expected
objects, actual outputs, errors, stdout/stderr, journals, lifecycle records,
configs, and exact command/protocol arguments are retained in `native-controls.json`,
`current-captures.json`, `original-green.json`, and `original-base-red-exact.json`.

The exact-base RED matrix has 24 executions: four silent losses, four refusals,
and 16 passing after-second/completed controls. RED uses an in-memory loader
overlay of the exact Git preimage; no frozen author file is modified.
One initial loader setup failed before guest execution due to a data-URL import
using an absolute path instead of a file URL. Also, initial evidence copying
added a terminal newline to the preimage. Both are recorded, not hidden. The
newline was removed with a patch, exact base bytes verified, and the complete
24-case RED plus final formatted unit RED rerun. Earlier provisional RED records
are superseded, not counted as additional distinct coverage.

### Snapshot version qualification

Four untouched archived first-boundary checkpoints refuse before host execution:
`Invalid snapshot at $.executionSemantics: incompatible execution semantics`.
Their envelope `version` is **1**, as is the current envelope. The incompatible
marker is **`jobs-v1` versus current `jobs-v6`**, not a changed numeric envelope
version. No marker edit, migration, or archived-checkpoint defect reproduction is
claimed. The original defect is independently reproduced using newly captured
current-format checkpoints and unchanged original source/input/public protocol.

### Independent tests and gates

New dedicated test: `packages/safejs/src/run.cbi-001-validation.test.ts`.
All snapshots/backends/registries are in memory; tests write no filesystem data
and invoke no LLMs or guest real I/O. The 29 tests include exact original source
hashes/native anchors, original old-registration delivery, finite first-to-second
recapture and completed recovery, four identical events with lexical **count 4**,
different payloads, new registration, and pending reissue histories at callback
1/2/3. Those reissues return `[1,2,3,4]` without duplicate source execution while
allowing their new suffix. Changed historical arguments preserve reconciliation
and public call ID. Missing/joined proofs and identical resumer events are
separate regression controls, not original-witness substitutes.

- Final exact-base unit RED: **10 failed, 19 passed / 29**.
- Frozen fix: **29/29** dedicated tests pass.
- Combined selected SafeJS regressions: **729/729, 23 files**, including the 29.
- TERM-unset design/terminal gate: **1,705/1,705, 82 files**; no source fix.
- SafeJS source typecheck and strict validator-test typecheck pass.
- Focused and repository ESLint pass with zero warnings; scoped Prettier and
  `git diff --check` pass. No visual CLI changes; screenshots are not applicable.

Exact gate commands, elapsed bounds, statuses and full stdout/stderr are in each
named gate JSON and the final manifest. Principal commands:

```sh
./node_modules/.bin/vitest run packages/safejs/src/run.cbi-001-validation.test.ts --reporter=verbose --testTimeout=1500
./node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --esModuleInterop --target ES2022 --module NodeNext --moduleResolution NodeNext --types node,vitest/globals packages/safejs/src/run.cbi-001-validation.test.ts
env -u TERM ./node_modules/.bin/vitest run packages/toolcraft-design --reporter=verbose
env -u TERM npm run lint:eslint -- --max-warnings=0
env -u TERM npm run lint:types
env -u TERM ./node_modules/.bin/vitest run --exclude 'packages/safejs/**' --exclude 'packages/mcp-oauth-server/src/security.test.ts' --reporter=default --maxWorkers=4
```

### Repository blockers and handoff

The broad non-SafeJS repository gate deliberately excludes unselected SafeJS
and the named security suite; it is not a claim that every repository test ran.
Its first two-worker run hit the 180-second process cap. A bounded four-worker
repeat completed in 106.21 seconds: **17,374 passed, nine failed, two skipped;
785 files passed, four failed, two skipped**. Failures are in:

- `tests/integration/mcp-typed-outputs-workflow.test.ts`: one stdio process exit.
- `packages/tiny-mcp-client/src/transports.test.ts`: one real-process stdio smoke.
- `packages/toolcraft/src/mcp-proxy-integration.test.ts`: six failures, including
  a 5-second test timeout and upstream process exits.
- `packages/terminal-pilot/src/testing/testing.test.ts`: one CLI process exit.

Repository `lint:types` exits 2 with 181 diagnostics, starting with unresolved
workspace package declarations, including `@poe-code/poe-agent` and `toolcraft`.
These broader checks are **not green**. They were reported promptly; no unrelated
source repair or source-level timeout workaround is attempted. Their cause and
integration repair belong to the coordinator/author; no pre-existing-failure
claim is used to dismiss them. The old five Ctrl-D report is not reproduced:
the independent TERM-unset terminal gate is green.

The content-addressed, read-only candidate includes exactly three frozen author
files plus this validation plan and the independent test. Its manifest records
base commit, Git blobs, exact preimage/postimage bytes and SHA-256s, including
explicit absence for new files. Author file and evidence artifact hashes remain
unchanged. No branch, staging, commit, push, or other Git mutation occurs.
Fresh integrated validation is mandatory after any other replay/core fixes;
this scoped READY decision neither closes the overall goal nor authorizes release.

## Post-build continuation: August 29, 2026

**READY for CBI-001 and the exercised repository gate. The nine repository
failures and 181 root type diagnostics are resolved. No author repair is needed.**
This supersedes the earlier repository BLOCKED verdict, not its retained failure
evidence. All original lifecycle, snapshot-version, and integration qualifications
remain in force; this is not release authorization or overall-goal completion.

### Build prerequisite and controlled comparison

Ran the requested full `env -u TERM npm run build`: exit 0, **67/67 workspace
tasks successful**, followed by root schema generation, TypeScript compilation,
bin-wrapper generation and bundling. The workspace task phase took 30.301 seconds;
the full command took approximately 38 seconds. All three frozen author files,
the independent test, dependency manifests, Git HEAD and index remain unchanged.
No production source, test expectations, skips, timeout settings, or terminal
behavior were repaired or weakened.

The earlier candidate without complete build outputs and the same candidate
after the full build form the controlled before/after comparison. The four
previously failing files use built subprocess entry points: the tiny-stdio test
server, Toolcraft's dist exports, and terminal-pilot's dist CLI. Root TypeScript
also requires built workspace declarations. Supplying those outputs is sufficient
to resolve every reported failure and diagnostic in this clone. There are no
remaining errors requiring a fresh base-source overlay or an author patch.

The build also generated four untracked JetBrains Mono font files under
`packages/terminal-pilot/assets/`. They are build outputs inside this clone,
left intact and excluded from the immutable source candidate. Previously
retained failures, logs, manifests and read-only candidate bytes are preserved.

### Actual post-build gates

- The four formerly failing targets pass **225/225 tests**, including all nine
  previously failing named tests. The run completes in 4.54 seconds, including
  the unchanged formerly timing-out MCP discovery test.
- `env -u TERM npm run lint:types`: exit 0, **zero diagnostics**.
- `env -u TERM npm run typecheck`: exit 0; this configured alias invokes
  `lint:types`, also with zero diagnostics.
- Complete prior repository gate: **17,383 passed, zero failed, two skipped**;
  **789 files passed, two skipped**, in 122.48 seconds. This includes the design
  and terminal suites under the proper TERM-unset environment.
- Post-build source-TypeScript SafeJS regressions: **729/729, 23 files**, including
  the 29 independent CBI-001 tests. Duration: 6.75 seconds.
- Repository ESLint: exit 0 with zero warnings. No code or test weakening.

The repository gate preserves exactly the previous safety exclusions:
`packages/safejs/**` and `packages/mcp-oauth-server/src/security.test.ts`.
SafeJS is validated separately through the same explicit 729-test selection.
No new exclusions hide the nine failures; every previously failing target runs
both in the focused pass and in the complete repository pass. This remains a
claim about the exercised gate, not unrestricted adversarial/security coverage.
The two existing skipped cases are the Docker execution-environment integration
case and the OAuth test-server inspector smoke case; no skips were added.

Exact commands:

```sh
env -u TERM npm run build
env -u TERM ./node_modules/.bin/vitest run tests/integration/mcp-typed-outputs-workflow.test.ts packages/tiny-mcp-client/src/transports.test.ts packages/toolcraft/src/mcp-proxy-integration.test.ts packages/terminal-pilot/src/testing/testing.test.ts --reporter=verbose
env -u TERM npm run lint:types
env -u TERM npm run typecheck
env -u TERM npm run test:unit -- --exclude 'packages/safejs/**' --exclude 'packages/mcp-oauth-server/src/security.test.ts' --reporter=default --maxWorkers=4
env -u TERM npm run lint:eslint -- --max-warnings=0
```

The post-build SafeJS command is identical to the prior
`broader-safejs-final.json` command, with its unchanged explicit paths and
2-second per-test timeout. The initial four-file retry uses the configured test
timeouts, not increased limits. Finite outer command caps are 240 seconds for
build/repository gate and 60 seconds for focused tests, types and lint.

### Refreshed immutable capture

Continuation evidence and the new candidate are under
`out/safejs-remediation/cbi-001-validation/post-build/`. The new manifest links
to the previous manifests by SHA-256 and records full commands, stdout/stderr,
process results, before/after findings, base identities and exact file bytes.
Only this appended validation report changes among the five candidate files.
The author production patch, author tests/plan, and independent validation test
are byte-identical to the previous immutable capture. Old captures remain
read-only and are not overwritten. No commits, pushes, branches, staging,
or changes to another clone occur. Fresh integrated validation remains mandatory
after the publisher combines any other replay/core fixes.

## Fresh ordered independent review: August 29, 2026

### Verdict and frozen intake

**READY for this exact NUM → AW → CBI ordered candidate. No author repair is
required.** This new review supersedes isolated-candidate conclusions only for the
current ordered tree. It is not publication authorization or certification of a
future actual-main integration. Every earlier failure, qualification and
post-build continuation in this document is preserved byte-for-byte.

Current workdir: `/Users/kjopek/Workspace/poe-code-safejs-callback-delivery-integrated`.
Base: `afe59a77fa318acf72162a1970306147fdfc5428`.
Refreshed author manifest:
`out/safejs-remediation/cbi-001-integration-format-refresh/manifest.json`, SHA-256
`0ccda6bb73167f366611edb77be287c03af11514ce59e38fe32b530bbc464653`.
The earlier manifest remains
`497a7d0395b2caa132ae9eed1eba9a6c456e9d2bfe618c24d394f056d5c722f8`.

The reviewer verified 146 referenced artifacts across the retained and refreshed
captures and all 23 working layer postimages before execution. The earlier
validation report is preserved separately under the new evidence directory with
SHA-256 `33646c86a907ba04e745ab03fb77b0f6c089236cc55d0d6fc527a90c29087b1e`
and 16,703 bytes. Only this appended report changes among the five CBI files.
Both CBI test files, the production file, the refreshed author plan and all eighteen
NUM/AW prerequisite files remain byte-identical to the frozen inputs.

Evidence for this review is under
`out/safejs-remediation/cbi-001-integration-validation/`.
No new source or unit-test file was needed. The existing fifty CBI tests cover the
requested boundaries and remain unchanged. This appended validation report is
included as a CBI-only **publication file**, not merely an evidence attachment.
The capture retains five CBI publishables, with NUM's eleven and AW's seven files
in separate prerequisite groups.

### Audit boundary and unchanged originals

Before original audit payload reads, bootstrap
`inventory-verification.json.archiveReadPolicy.excludedPaths`, verify all 38
entries and deny the entire security directory. The only newly read original
payloads are these four explicit ordinary-source paths:

- `callback-loss-review/01-identical.js`
- `callback-loss-review/02-distinct.js`
- `callback-loss-review/03-retained-map.js`
- `callback-loss-review/04-no-input-promise.js`

These paths are relative to
`/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27`.
There is no recursive audit/family search, excluded read/hash/execution, security
research, new private adapter, LLM call or guest real IO. Child source reads are
restricted to these same four hash-locked paths; checkpoint reads use only the
reviewer's own newly captured files. The driver body remains exactly
`8cee592ac1d0308c310c7ecb50822e1c8e12d8cf4d9f36c73d7933d9f60e7400`.
Source bodies, input configurations and public host registration/replay hooks
are not adapted to make the tests pass.

Native anchors execute first. The complete new forty-case lifecycle run is:

| Phase                                                          | Fresh executions | Result                                                           |
| -------------------------------------------------------------- | ---------------: | ---------------------------------------------------------------- |
| Native originals                                               |                4 | Full values and logs match the unchanged reference               |
| Uninterrupted current TypeScript                               |                4 | Full native values match                                         |
| Automatic first/second captures                                |                8 | Full native values match; fresh checkpoints                      |
| Fresh-process first/second/completed resumes, two repeats each |               24 | Full native values and required replay/identity invariants match |
| Total                                                          |               40 | All pass                                                         |

Twelve checkpoint files are newly captured: first, second and completed for each
source. The twenty-four resumes use these new files, not cached author snapshots.
The driver imports current TypeScript, never dist, and supplies no replacement
input Promise on resume. The original synchronous replay hook only rebinds the
registry; the source-awaited delivery invokes the retained OLD adapter outside
that hook. A pending joined-callback workflow is not substituted for any original.

### Full original values and journal invariants

`original-full-native-values.json` and `fresh-original-lifecycle-40.json`
retain every full expected/actual return object, source/configuration, stdout,
stderr, issued/replayed calls, callback records, lifecycle events and checkpoint.
The comparison does not project away closure state, aliases or trace fields.

| Original          | Complete value obligations, in addition to every recorded field                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Identical counter | total 4, count 2, first 2, second 4; object/input/Promise aliases true                                                        |
| Distinct counter  | total 5, count 2, first 2, second 5; object/input/Promise aliases true                                                        |
| Retained map      | total 39; values [6,17,3,13]; first values [6,17]/total 23; second values [3,13]/total 39; active 0, peak 2; all aliases true |
| No-input counter  | total 4, count 2, first 2, second 4; zero input-journal entries                                                               |

The full counter trace is
`["registered","input:1","callback:1","done:1","callback:2","done:2"]`;
the no-input case omits `"input:1"`. The map trace is
`["registered","input:3","callback:first","done:first","callback:second","done:second"]`.
All of these traces are compared in full. Completed registration is never
reissued, its old callback adapter is rebound, two original callback records are
retained, and first-boundary recovery executes the missing nested second work.

Every resumed historical call keeps its **exact raw public ID and argument digest**
from that fresh checkpoint. Across separately created runs, only the random run-ID
namespace differs. The initial reviewer comparison mistakenly equated a new UUID
with the author's old UUID; the runtime succeeded and the complete discrepancy is
preserved in `fresh-journal-id-oracle-diagnostic.json`.
`interp/host-call.ts:148`, `:166` and `:231` explicitly create/reuse that
namespace and append call ordinals. The corrected cross-run oracle compares all
journal fields and exact ordinals while checking one namespace per run; it does
**not** normalize IDs within a snapshot/resume lineage. Issued/replayed operation
order, lifecycle records, callback arguments, outcomes and journal metadata still
match. No runtime/test file or historical identity requirement was weakened.

Snapshot artifacts contain the public serialization plus one terminal LF for file
storage. The original serialized string and its hash/bytes are separately retained;
no JSON field, marker, callback entry or proof is changed. All fresh envelopes use
numeric version **1** and **jobs-v6**. The four earlier archived **jobs-v1** refusals
remain preserved, qualified historical evidence, not new executions in this review.
No archive marker rewrite, fabricated migration or retroactive compatibility claim
is made. Numeric envelope version 1 is not itself the incompatible marker.

### Actual reissue versus new delivery

The source inspection still supports the narrow correction:

- `interp/host-bridge.ts:373` initializes `nextReissuedInvocation` only immediately
  before the restored native operation is actually invoked. Completed-result replay
  and external reconciliation return before that point.
- `interp/host-bridge.ts:640` consumes saved callback results only when this cursor
  exists. Callback identity and encoded-argument comparison remain mandatory for
  a genuine reissue. Changed historical arguments still require external
  reconciliation under the original public call ID.
- Without an actual-reissue cursor, an adapter waits for live execution, records a
  new callback invocation and executes it. After a genuine reissue exhausts its
  recorded prefix, the new suffix takes that same live path.
- `CHECKPOINT_REPLAY.md` distinguishes replayed callback results from resumer adapter
  calls, which are new invocations after catch-up. The completed-registration
  lifetime claim remains limited to these source-awaited resumed-run protocols,
  not arbitrary calls after run completion or all-external exactly-once delivery.

The unchanged independent controls assert:

| Control                                                  | Required actual result                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four identical events on the OLD registration            | lexical count 4, total 10 after multiplier changes, alias true, results [1,2,3,4]; three new calls use the rebound OLD adapter                       |
| Different payloads on the OLD registration               | lexical count 4, total 28, alias true, results [1,2,3,4]                                                                                             |
| Identical payloads on a NEW registration                 | lexical count 4, total 10, alias true, results [1,2,3,4]; new adapter differs from rebound OLD adapter                                               |
| Actual pending-native reissue, checkpoint callback 1/2/3 | count 4 and seen [1,2,2,2,3,2,4,2]; both host runs receive [1,2,3,4]; only missing nested steps execute, and final callback history has four records |
| Changed historical reissue payload                       | HostCallResumabilityError, external-reconciliation, unchanged original public call ID                                                                |
| Missing/joined recovery proof and resumer calls          | Missing disposition is rejected; joined proof controls treat adapter calls as new events                                                             |

Finite first → second → completed recapture controls also pass. Joined/pending
proof cases remain separate controls, never replacements for the completed
registration retained-delivery witness. All exact critical test IDs and statuses
are in `independent-red-green-and-contracts.json`.

### Independent ordered RED and GREEN

An in-memory Vite loader overlays only the exact post-AW host-bridge preimage,
verifying SHA-256 and 34,490 bytes. NUM and AW remain present. No production swap,
checkout, source repair, version edit or fake proof is used.

| Unchanged file                   | Post-AW RED pass | Post-AW RED fail | CBI GREEN pass |
| -------------------------------- | ---------------: | ---------------: | -------------: |
| `run.retained-callback.test.ts`  |               11 |               10 |             21 |
| `run.cbi-001-validation.test.ts` |               19 |               10 |             29 |
| Total                            |               30 |               20 |             50 |

Complete original failing IDs and assertion output are preserved. The fifty-test
GREEN gate passes again after the fresh full build. Original lifecycle GREEN is
independently executed as the forty-process matrix above. The author's earlier
prerequisite-stage forty-attempt RED evidence remains immutable; it is not
relabeled as a new forty-attempt RED run by this reviewer.

### Prerequisite and ordering preservation

All eighteen prerequisite postimages remain exact. The CBI forward and inverse
read-only three-way calculations reproduce its postimage and the exact post-AW
preimage without conflicts or semantic repair. The other 297 tracked SafeJS files
match their base Git blobs. Dependency manifests and the Git index remain unchanged.

CBI does not edit AW's `interp/exceptions.ts` or `interp/interpreter.ts`.
AW's source-value/coercion flow therefore remains frozen and its complete 195-test
gate passes, including original native values, alias/metadata comparisons and
finite restore controls. Those in-memory AW test cases are freshly executed; the
older separate AW forty-case capture artifact is not claimed as rerun. NUM's selected
arity controls, ARRAY metadata/call ordering and COLL live-cursor controls also
pass. No new assumption about raw Error representation or native descriptors is
introduced.

**CBI changes exactly one production path:**
`packages/safejs/src/interp/host-bridge.ts`.

| Required state                    | Artifact / identity                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Exact post-AW preimage path       | `out/safejs-remediation/cbi-001-integration/cbi-delta/preimages/packages/safejs/src/interp/host-bridge.ts`      |
| Identical refreshed preimage copy | `out/safejs-remediation/cbi-001-integration-format-refresh/preimages/packages/safejs/src/interp/host-bridge.ts` |
| Post-AW preimage SHA-256 / bytes  | `8bc1c6cb653fa70d281732d7bb893a02cfd0e6a87f6eff093d448b9d56678420` / 34,490                                     |
| CBI postimage SHA-256 / bytes     | `2b714ea51918134296ae62eb27cf0810e7299e4080d89061740df642a884c611` / 34,512                                     |

This is the overlap metadata for future AR ordering, not an extension into AR
repair or a statement about another candidate's files. Compare this path/hash
with that candidate's manifest. Any overlap requires serial three-way integration
and fresh validation, not blind file replacement. No other clone is inspected or
modified by this review.

### Fresh build, static checks and disclosed selection

All terminal gates use `env -u TERM`; exact command arrays, limits, timestamps,
stdout/stderr and exit statuses are in the named reviewer JSON records.

| Fresh gate                                                        | Result                                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cbi-50-green.json`, `post-build-cbi-50.json`                     | 50/50, no exclusions, both executions                                                                                           |
| `fresh-aw-195.json`                                               | 195 pass, no exclusions                                                                                                         |
| `fresh-num-96.json`                                               | 96 pass; 26 inherited safety exclusions                                                                                         |
| `fresh-array-41.json`                                             | 41 pass, no exclusions                                                                                                          |
| `fresh-coll-136.json`                                             | 136 pass, no exclusions                                                                                                         |
| `fresh-broader-selected.json`, `post-build-broader-selected.json` | 2,142 pass, 83 excluded, 53 files, zero failures, both executions                                                               |
| `full-build-fresh.json`                                           | `env -u TERM TURBO_FORCE=true npm run build`: 67 workspace tasks execute, 0 cached; root codegen/TypeScript/bundle also execute |
| `configured-seven-new-test-types.json`                            | Seven explicit new NUM/AW/CBI roots, configured package options with only noEmit:true overridden; zero diagnostics              |
| `safejs-source-types.json`                                        | `env -u TERM ./node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json`: pass                                           |
| `configured-root-types.json`                                      | `env -u TERM npm run lint:types`: pass                                                                                          |
| `configured-root-eslint.json`                                     | `env -u TERM npm run lint:eslint -- --max-warnings=0`: pass                                                                     |
| `configured-package-lint.json`                                    | `env -u TERM npm run lint:packages`: 17 rules / 68 packages pass                                                                |
| `all-23-publishables-format.json`                                 | Configured Prettier check on all 23 layered publication files, including this appended report: pass                             |
| `cbi-five-publishables-format.json`                               | Configured Prettier check on all five CBI publication files: pass                                                               |
| `final-diff-check.json`                                           | `env -u TERM git diff --check`: pass                                                                                            |

The exact inherited broader selector is unchanged. All 83 excluded IDs are listed
as exclusions in `selected-gate-scope.json`, not counted as passes. The twenty-six
NUM exclusions are likewise explicit. CBI, AW, ARRAY and COLL focused gates are
unfiltered. The selected broader gate is not the full repository suite, and no
security/adversarial certification is inferred. The initial parent report extractor
looked for per-test status `pending`; Vitest uses `skipped` while the aggregate is
`numPendingTests`. That metadata-only error and its correction are preserved in
`excluded-status-reporting-diagnostic.json`; no selector or assertion changed.

Tests run anew rather than replaying prior JSON outcomes. All 67 workspace build
logs explicitly say cache bypass, with zero cache hits, as retained in
`build-cache-accounting.json`. Counts overlap and must not be added as unique
tests. Current lifecycle snapshots are newly captured, not cache-restored author
artifacts. The author's format-only refresh is independently checked against the
configured Prettier output; its plan remains unchanged in this review.

### Final CBI-only publication capture

The new immutable capture is
`out/safejs-remediation/cbi-001-integration-validation/candidate/manifest.json`.
It includes **all five CBI publication files**, including the full old validation
report plus this append. No new validation report/test is left outside the CBI
publication list. No additional report/test file was needed. NUM's eleven and
AW's seven prerequisite files, their exact preimages/postimages and the post-AW
CBI preimage are separate groups. Original and refreshed author manifests, old
report preimage, source identities, failure evidence and all fresh gate records
remain linked by SHA-256 and byte lengths.

No production, README, master-plan, dependency, Git-state or other-clone edits,
commits, pushes or publication occur. Generated terminal font assets are not
publishables. New writes are confined to this report append and its dedicated
evidence directory. The historical report prefix and all other frozen files stay
byte-identical. No arbitrary post-run callback lifetime, legacy migration,
active-host external-capture support or all-external exactly-once guarantee is
claimed. **The publisher must run fresh full gates on the eventual actual-main
ordered tree; this review is not that future certification.**
