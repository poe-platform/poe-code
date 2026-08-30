# V3 final archival handoff — NOT APPROVED

**NOT APPROVED.** Only v2's static message changes to the established native/
upstream spelling `This operation was aborted`. No caller-reason property is
read. The newly authored reason fixture uses a fresh native default AbortSignal
message, captured before importing the engine, as its independent message/stack
oracle. All original nine and upstream test bytes remain unchanged. Raw identity
and quota semantics are **not resolved**; verifier still requires 10/10 and exits
**1 / `passed: false`**.

Stable executable checkpoint was emitted before documentation/history expansion:
`/tmp/safe-bash-safejs-v3-source-stable.txt`; durable copy:
`evidence/v3/source-stable.txt`. No further executable changes followed testing.

| V3 gate | Baseline | Patched |
| --- | --- | --- |
| Original nine + action-abort | 0 pass / 10 fail | 9 pass / 1 fail |
| Unchanged supplementary invariants | 0 pass / 9 fail | 8 pass / 1 fail |
| Native-oracle reason safety | 0 pass / 18 fail | 18 pass / 0 fail |
| Full slow/fuzz suite, 125 files | 3225 pass / 0 fail / 38 skip | 3225 pass / 0 fail / 38 skip |

Targeted unchanged `src/run.test.ts`, `src/runner/run-harness.test.ts` and
`src/error/shape-audit.test.ts` ran **first**, passing **109/109** in fresh `wt42MU`.
The subsequent guarded full reproduction created fresh `ZicyG4` copies:

```sh
node docs/upstream-patches/safejs/verify.mjs /Users/kjopek/Workspace/poe-code \
  --baseline-copy /tmp/safe-bash-safejs-isolated-gnP0gu/baseline
```

Full denominator remains **3263**, retaining all 38 existing skips (33 filesystem
reference gaps, five test262 exclusions). All small probes have zero skips and
cancellations. The two v2 message-spelling failures and v1 error-shape regression
are absent in v3. The remaining original-ten failure is raw object-reason identity
at `upstream-desired.probe.ts:37`; the supplementary failure is conservative
shared-graph quota inflation (87 versus 49). Neither is waived or canonicalized.

`evidence/v3/` holds exact commands/environments, TAP/logs, full per-file/skip
summaries and raw JSON hashes, target log, oracle/version metadata, import proof,
and private-state records. Guard tests pass **2/2**. Fresh baseline/patched
`tsc --noEmit --project packages/safejs/tsconfig.json` both exit **2** with the same
eight unresolved-workspace-declaration diagnostics; this is not a typecheck pass.

V3 patch SHA256:
`5a12e79d07fc9379c9a6a67897f8aa72767467cc775fac5ea88e55a5bcde95d3`.
Actual loaded `ZicyG4/patched/.../src/run.ts` SHA256:
`c786130717eab346135766190f005fa025b5e290b9d5220ad913f21da304e3c1`.
Interpreter SHA256 remains
`9144707a43315e80cd75ff6dfdf650760d196c2b9fc09f5876b86ff551a3338d`.
Reason fixture SHA256:
`83ec16e7e559d8fcf7a24c72b6e278cf1cbb1a2c733d8fd58c8640a0609a7560`.
Original-nine and invariant hashes remain exactly those recorded below. Only one
engine string differs from v2; the other six patch output hashes are unchanged.

Current private source/revision/status/index/license match during
**2026-08-26T22:40:30.350Z–22:41:31.611Z**, revision
`3db0b0a0ed25278b2c1dee361d438891fa1e34fa`, index
`85699b3d1bdd5d678d1e6adbfb614892ec03ef0b5b3b80413083eef51f8075e8`.
Full current engine hashes are recorded once in `private-current-hashes.json`;
before/after observation digests and exact statuses are separate. This interval
equality does not erase earlier external drift. The pinned-baseline guard is
unchanged: these results do not validate or rebase onto the newer private engine.
Both complete temporary engine manifests match after tests, and actual load
hooks forbid private or preserved-source aliases. This author-validation interval
preceded archival staging/commit. No private writes, runtime dependencies,
vendored engine or accepted-contract changes are part of the artifact.

Prior failed v1/v2 evidence remains unchanged. V2 patch/manifest and former
literal-based reason fixture are archived in `history/v2/`; v1 remains in
`history/v1/`. The following sections are historical, not current v3 results.
The separate review below permits archival only; no full-security or superiority claim.

## Final independent v3 archival review

The completed independent review finds no new critical artifact-integrity blocker
to archiving this **UNAPPROVED** proposal. It does not approve application, upstream
shipping, a new contract or rebase onto the changed private engine. Durable report:
`evidence/v3/independent-review.txt`; concise verdict: `independent-result.txt`;
machine-readable execution and import proof: `independent-proof.json`.

The reviewer independently ran the unchanged verifier against preserved
`/tmp/safe-bash-safejs-isolated-TQgyeN/baseline`, producing fresh `R0mMav` copies.
The result is **exit 1 / `passed: false`**, not a green approval:

| Independent gate | Baseline | V3 patched |
| --- | --- | --- |
| Exact original nine | 0 pass / 9 fail | 8 pass / 1 fail |
| Durable action-abort | 0 pass / 1 fail | 1 pass / 0 fail |
| Combined required ten | 0 pass / 10 fail | 9 pass / 1 fail |
| Reason safety | 0 pass / 18 fail | 18 pass / 0 fail |
| Unchanged invariants | 0 pass / 9 fail | 8 pass / 1 fail |
| Full slow/fuzz, each 125 files / 3263 tests | 3225 pass / 0 fail / 38 skip | 3225 pass / 0 fail / 38 skip |

All 125 upstream test files remain byte-identical to the pin; the same 38 skipped
case identities are retained in `independent-delta-proof.json`. No timeout or
probe cancellation occurred. Original raw Error identity still fails; conservative
quota double charging remains 87 versus 49. The prior eight identical baseline
and patched declaration/typecheck diagnostics remain failures, not a pass; the
reviewer did not rerun typecheck for the one-string v3 delta.

The independent verifier interval **22:45:14.578Z–22:46:14.172Z on August 26, 2026**
preserved private engine/revision/status/index/license. The wider independent
interval **2026-08-26T22:44:55.389Z–22:47:01.175Z** preserved 238 source files,
all 490 package files (including existing dist), revision, index and license,
**but status changed externally**: `?? docs/plans/bugfix-loop-agent-array-override.md`
appeared before verifier startup. `independent-private-observations.json` preserves
the exact statuses, hashes and interval distinctions. This is not a globally
unchanged-private-repository claim; historical drift and the live-baseline guard
refusal are retained.

The reviewer confirmed all 20 pinned executable/probe/helper/provenance artifacts
unchanged, patch SHA256 `5a12e79d07fc9379c9a6a67897f8aa72767467cc775fac5ea88e55a5bcde95d3`,
fresh actual imports and zero snapshot symlinks. Independent owned guards pass
2/2; four source/target guard checks pass. Root source aliases are canonicalized,
not rejected; nested source/patch-target symlinks are rejected. Current private
default application fails the exact-baseline guard before copying/application.
Guard logs, command records and hashed refusal summary are retained under v3;
no synthetic count-injection test is claimed. Finalization changes prose/evidence
and checksums only, not reviewed scripts, sources, probes or patch bytes.

The exact retained cause graph is not recursively sanitized and must not be
blindly exposed to guests. MIT provenance does not invent publication permission.
V1's 3224/1/38 shape failure and v2's 3223/2/38 message failures remain historical,
distinct from v3's full-suite results. Archival authorization resolves none of
the identity, quota, typecheck, current-engine or broader security limitations.

### Final archival checks

`evidence/v3/archival-files.txt` enumerates the exact 89 owned files authorized
for this commit: 80 artifact/documentation files and nine stress-scope files.
The checksum manifest verifies 89 entries (it excludes itself and also covers
the unchanged original-nine probe). All 20 reviewer-pinned hashes remain stable;
the always-runnable artifact guard tests were rerun and pass 2/2. Expensive,
unchanged engine suites were not rerun during prose-only finalization.

The complete staged scoped `git diff --check` exits **2**, reporting **230 trailing
whitespace warnings in 15 files**, exclusively preserved raw test logs and the
current/historical patch files' context lines. Those evidence/reviewed bytes were
not normalized. The same check over all remaining owned files exits **0**. This
is a recorded formatting limitation, not a clean aggregate diff-check claim or
an executable-integrity failure. No test or patch was changed to silence it.

---

# Historical V2 finite proposal handoff — NOT APPROVED

August 26, 2026. This revision integrates the independently investigated
cause-preserving `run.ts` design into the isolated patch. It does not change the
accepted API contract or any existing acceptance assertion. Original ten still
requires **10/10**; v2 achieves **9/10**, so the verifier returns **exit 1 /
`passed: false`** and continues to collect every remaining suite.

## V2 reproduction and scope

```sh
node docs/upstream-patches/safejs/verify.mjs /Users/kjopek/Workspace/poe-code \
  --baseline-copy /tmp/safe-bash-safejs-isolated-gnP0gu/baseline
node --test tests/commands/safejs-stress/artifact-guards.probe.mjs
```

Fresh v2 root: `/tmp/safe-bash-safejs-isolated-pu6gX6`. Before/after current
private captures: **2026-08-26T22:29:45.390Z–22:30:46.281Z**. Durable v2 data is
under `evidence/v2/`; original v1 `evidence/` data is unchanged. Exact v1 patch,
scripts, manifest, checksum file and documentation are archived in `history/v1/`.
Its moved scripts are provenance, not new runnable entry points.

**New external engine drift matters:** a direct attempt against the current
private tree failed the exact baseline guard before any copy/application. Nine
pinned files differ: `CHECKPOINT_REPLAY.md`, `src/interp/async.test.ts`,
`src/interp/async.ts`, `src/interp/cancel.ts`, `src/interp/host-bridge.ts`,
`src/interp/interpreter.ts`, `src/interp/values.ts`, `src/run.replay.stress.test.ts`
and `src/run.ts`. The actual before hashes and drift list are retained in
`evidence/v2/private-drift-before.json`; refusal command/status/log hash are in
`evidence/v2/current-private-guard-refusal.json`.

No baseline hash was repinned or ignored. The explicit `--baseline-copy` option
reads the preserved full v1 baseline and verifies all **259 non-build/cache files
(238 source files)** against the unchanged manifest before producing fresh
regular-file baseline/patched trees. Current private state is monitored
separately; its engine hashes are not misrepresented as the historical baseline.
This finite revision does **not** rebase onto or validate the newer private
engine. A matching preserved snapshot is required; the guard still fails closed
if its bytes differ. No input tree is ever patched.

## Baseline, v1 and v2 results

| Gate | Pinned baseline | V1 (historical) | V2 |
| --- | --- | --- | --- |
| Original nine + durable action-abort | 0 pass / 10 fail | 10 pass / 0 fail | 9 pass / 1 fail |
| Unchanged supplementary invariants | 0 pass / 9 fail | 8 pass / 1 fail | 8 pass / 1 fail |
| New reason-safety tests | 0 pass / 18 fail | Not run | 18 pass / 0 fail |
| Shape audit, included in full suite | 12 pass / 0 fail | 11 pass / 1 fail | 12 pass / 0 fail |
| Full pinned suite, 125 files | 3225 pass / 0 fail / 38 skip | 3224 pass / 1 fail / 38 skip | 3223 pass / 2 fail / 38 skip |

All small probes have zero skips/cancellations. Full denominator stays **3263**,
including 33 filesystem/memfs reference-gap skips and five test262 exclusions.
Both v2 baseline/patched full runs enable `SAFEJS_PARSE_FUZZ=1` and
`SAFEJS_ADVERSARIAL_SLOW=1` using unchanged copied Vitest config/setup/tests and
temporary-only aliases, dependencies, cwd/HOME/TMP/cache. Full suite is collected
despite the earlier patched acceptance failure. `evidence/v2/commands.json`
records all eight commands, environments and statuses; `fullsuite-summary.json`
lists every file, skip and failure with raw JSON hashes. No skipped or failing
test becomes a pass and overlapping suites are not added together.

**Remaining failures, distinguished:**

1. The original `upstream-desired.probe.ts:37` still asserts `error === reason`.
   V2 preserves an object/function reason as `error.cause === reason` instead.
   A frozen reason lacking a span and containing native stack paths cannot both
   retain raw identity without mutation and become a shaped outward error. This
   is a pending upstream-owner contract choice, not permission to relax 10/10.
2. The unchanged full-suite tests `src/run.test.ts` / “blocks imported module
   calls when the signal is already aborted” and
   `src/runner/run-harness.test.ts:819` / “returns an aborted result when the
   signal is aborted before the first step” expect `This operation was aborted`.
   The inspected investigator proposal uses `The operation was aborted.`. Its
   18 new fixtures also assert that fixed literal. These two diagnostic-text
   mismatches are **not** a mathematical consequence of cause preservation; they
   are an additional discovered compatibility issue. Neither upstream tests nor
   the investigator's fixtures were silently edited. Selecting an established
   diagnostic spelling and explicitly versioning the new proposal oracle remains
   a separate decision, not an accepted contract change in this handoff.
3. Shared visible property/capture accounting remains conservatively inflated
   **87 versus 49**; the original invariant stays failing. No mutable-alias
   canonicalization, quota weakening or budget redesign was introduced.

Baseline and v2 package typechecks were rerun in the fresh integration copy
`ki1vEA`; both exit **2** with identical eight missing-workspace-declaration/
consequent implicit-any diagnostics. No install/build was attempted and no
passing typecheck is claimed. `evidence/v2/typecheck.log` retains the output.
The two durable artifact guard tests pass; their v2 log is preserved.

## Inspected design and oracle provenance

The detailed investigator report is preserved as
`evidence/v2/design-investigation.txt`. Its candidate was read, not executed as
an alias. The integration applied only its minimal `run.ts` correction to a
fresh guarded v1 copy through `apply_patch`, then regenerated the seven-file
baseline-to-v2 artifact. The other six v1 file hashes are unchanged.

The **18 reason fixtures were inspected**, then retained byte-for-byte in owned
`tests/commands/safejs-stress/reason-contract.probe.mjs`, using the existing
`SAFEJS_LOCAL_ROOT` URL rather than a hardcoded investigator directory. Counts:
eight primitive values, six default/custom/frozen object/function cases, two
own/inherited accessor/coercion cases, one setup/getter case, and one entry-span
case covering empty, leading-newline and invalid source. Their fixed-message
assertion is proposal-specific, not proof of compatibility with the established
message spelling. The source audit independently checked `createSubsetErrorValue`,
`attachWrappedErrorCause`, `materializeWrappedErrorCause` and `createSourceSpan`:
only the fresh wrapper is inspected/mutated, and equal entry coordinates handle
the leading newline without scanning to an unrelated endpoint. The investigator
had previously caught and corrected that endpoint issue without weakening tests.

Object/function reasons become an engine-owned AbortError with a generic message,
clean outward stack and entry-anchor span; the untouched original is a
non-enumerable exact cause. Primitive reasons remain exact raw rejections. A
fresh internal Budget constructs only the small error through the existing
`chargeBudget: false` pathway; caller budgets/options, quotas and live-signal
execution are unchanged. No getter/coercion/prototype walk of the reason or
thenable assimilation is added. The recursive caller-controlled **cause graph is
not sanitized** and must not be blindly serialized/exposed to guests. Trusted
native AbortSignal and string inputs remain prerequisites; this is not a new
guarantee about arbitrary signal getters, monkeypatched intrinsics or immediate
abort dump-controller attachment.

## V2 hashes, imports and private proof

- V1 patch: `5a47508be5571601ccce1158c40e309ac406fd16db6f4f3b34747a9f7fe0ea09`.
- V2 patch: `c5419b5edc91a8883d72cb5fe08d08bf47c48fde21bee2fe1f926f836c243f2d`.
- V2 `run.ts`: `4c7bebb540df03cfa66b367ab1f59284c300fb57aa1a3b8500f58d7811c00cc6`.
- Original nine, unchanged: `7f8ebc44fdb3cc313439ec1f3a88c7df3dd3d894b8557daec6c0367fcb7611ab`.
- Invariants, unchanged: `8eeb6f698cdae6a45bf0c7cff62a74d5390ef4ee4f1284b5f910d9dc36604545`.
- Investigator/durable 18 fixture bytes: `bb782e0fe86410dee5f125f1a4e670514eec48d0ccbb3607e2cc95d96254790b`.

The complete seven-file before/after hashes are in `patch-manifest.json`;
repository artifact hashes are in `ARTIFACTS.sha256`. Actual Node load hooks in
`evidence/v2/patched-acceptance.log` load `pu6gX6/patched/packages/safejs/src/run.ts`
and its `src/interp/interpreter.ts`, not private, investigator or preserved-source
aliases. Interpreter hash remains
`9144707a43315e80cd75ff6dfdf650760d196c2b9fc09f5876b86ff551a3338d`.
The verifier rechecks both complete temporary source manifests after testing.

Current private before/after source hashes, revision, dirty status, **index hash**
and root license match for the fresh v2 run: revision
`a7ec0f14c58db154896a68fbacc7c6d9e636b6a3`, index
`998c133f8bc8985ea254cadca2b2437142bd947a53cd9b1609f64efcef003c1f`.
Exact observations, including a later read, are in
`evidence/v2/private-observations.json`; the pinned source root/manifest is a
separate `source-before-copy.json`. This interval equality does not erase the
new nine-file private drift or earlier v1 external revision/index/status history.
All private Git reads used `GIT_OPTIONAL_LOCKS=0`. License/provenance is unchanged;
the observed root MIT notice remains exactly in `LICENSE.upstream`.

**Separate final v2 review is pending.** The historical independent FAIL belongs
to v1; the focused design investigation did not run the wider suite. This finite
author handoff includes the newly discovered two message assertions. No commits,
staging, private edits, dependencies, engine vendoring, host evaluator, worktree,
or delegation. No superiority or full-security claim.

---

# Historical v1 finite validation handoff

**Result: FAIL / NOT APPROVED.** Artifact application is reproducible and the
requested ten acceptances pass on patched copies, but one unchanged full-suite
test regresses. The candidate must not be applied upstream as an approved fix.

## Final author reproduction

Command, run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node docs/upstream-patches/safejs/verify.mjs /Users/kjopek/Workspace/poe-code
```

Exit **1**; fresh root `/tmp/safe-bash-safejs-isolated-gnP0gu`. Baseline capture
started at **2026-08-26T22:12:13.103Z** and final private capture was
**2026-08-26T22:13:56.827Z**. The final script includes exact baseline TAP
denominator/status assertions and treats revision/status drift as aggregate
failure. Its seven-file patch is identical to the independently reviewed patch.
The review predates these two verifier hardenings and the final documentation;
do not describe the final verifier revision as independently approved.

| Check | Baseline | Patched |
| --- | --- | --- |
| Unchanged original nine + durable action-abort | 0/10 pass; 10 fail; 0 skip | 10/10 pass; 0 fail; 0 skip |
| Additional wrapper/lifecycle probes | 0/9 pass; 9 fail; 0 skip | 8/9 pass; 1 fail; 0 skip |
| Full unchanged slow/fuzz-enabled suite | 3225 pass; 0 fail; 38 skip | 3224 pass; 1 fail; 38 skip |

Full suite: **125 files, 3263 tests** in both trees. The 38 unchanged skips are
33 filesystem/memfs reference gaps and five explicit unsupported test262
features. `evidence/fullsuite-summary.json` enumerates every discovered file,
per-file counts, every skipped name and the failing assertion. No unavailable
oracle or unsupported feature is relabeled as passing. `evidence/commands.json`
retains exact Node executable, arguments, cwd, isolated environment and status
for all six validation commands. Full raw Vitest JSON remains in the temporary
root, with its SHA256 recorded in the durable summary; readable logs are included.

The ten-test differential is not a known-bug characterization: the desired
expectations are unchanged. The original probe hash remains
`7f8ebc44fdb3cc313439ec1f3a88c7df3dd3d894b8557daec6c0367fcb7611ab`.
The action child fails on baseline with `outward abort observed` followed by an
unhandled original `host action late rejection`; patched reaches the successful
completion marker and exits 0. Its process/output/time limits protect the parent.

## Blockers and limits

1. **Upstream error-shape regression:**
   `src/error/shape-audit.test.ts:106`, cancellation error audit. The new raw
   preabort entry check preserves exact reason identity but returns the native
   default AbortError stack containing host `/node_modules/` paths. The audit
   first fails at line 192; its required source span is also absent. This is a
   regression relative to the unchanged baseline, not an allowed dialect or
   known-bug exception. No safe reconciliation of exact reason identity,
   normalized source-bound errors and arbitrary/frozen caller reasons was
   established in this finite task. Caller error objects and upstream tests were
   not modified to hide the conflict.
2. **Conservative quota inflation:** shared visible property plus live original
   capture charges 87 rather than 49 in the supplementary diagnostic. Preserving
   original retained metadata prevents omission of later capture growth; globally
   deduplicating mutable wrapper/original aliases could instead undercount.
   Equality remains failing rather than weakening quotas or expanding this task
   into a budget redesign.
3. **Typecheck prerequisite:** baseline and patched `tsc --noEmit --project
   packages/safejs/tsconfig.json` both emit the same eight diagnostics for
   unresolved unbuilt `@poe-code/frontmatter` and `@poe-code/agent-spawn`
   declarations and consequent implicit-any parameters. Private workspace links
   and dist were intentionally excluded. No build/install was attempted and no
   passing typecheck is claimed; exact output is `evidence/typecheck.log`.
4. **Finite scope:** no synchronous-work preemption, universal nested branded
   capability cancellation, complete shell/security proof, or superiority claim.
   The copy/apply guard assumes the recorded trusted artifact and `apply_patch`
   executable, not a hostile same-user process racing changes inside its private
   temporary directory. No new dependencies or private writes occurred.

## Source and import proof

Patch SHA256:
`5a47508be5571601ccce1158c40e309ac406fd16db6f4f3b34747a9f7fe0ea09`.
`patch-manifest.json` records all seven exact input/output hashes;
`baseline-hashes.json` records **259 non-build/cache package files**, including
**238 source files**. Generated `dist`, `.turbo`, `.cache`, `.git` and dependency
directories are excluded from that source inventory, not silently counted as
source. The independent review additionally hashed 490 package files including
preexisting generated content; its denominator is not this source-only one.

After tests, author validation rehashed both temporary engine trees: baseline
still exactly matches `baseline-hashes.json`; patched differs only by the seven
pinned output hashes. There are no symlink engine files or paths back to private
source. Actual Node module-load hooks in `evidence/patched-acceptance.log` show:

```text
/private/tmp/safe-bash-safejs-isolated-gnP0gu/patched/packages/safejs/src/run.ts
437516219bd7e6150b35b76d4f4db3a5027496d75d1534142032a4fe466ff4f2
/private/tmp/safe-bash-safejs-isolated-gnP0gu/patched/packages/safejs/src/interp/interpreter.ts
9144707a43315e80cd75ff6dfdf650760d196c2b9fc09f5876b86ff551a3338d
```

The load hook rejects imports from the private repository or another SafeJS
engine. Upstream Vitest uses its unchanged copied root configuration, whose
workspace-source aliases refer to copied packages; copied dependencies omit
symlinks. Runtime cwd, HOME, TMPDIR/TMP/TEMP and XDG cache paths are temporary.
Node is 22.22.2; safe-bash tsx is 4.23.12; copied Vitest is 3.2.6, Vite 6.4.3,
TypeScript 5.9.3 and private tsx 4.22.4. Installed private tsx is inventoried,
not used for the Node acceptance probes. No private config, build or cache output
was created.

## Private-state proof and external drift

`evidence/private-observations.json` preserves exact timestamps, revision and
dirty status before/after source and tooling copying, final verification and a
subsequent read. Every captured engine map matches the full pinned per-file
manifest; root LICENSE hash is stable. The license notice is retained verbatim
in `LICENSE.upstream`, with its provenance explained in README.

The **final author validation interval alone** has equal before/after source
hashes, revision, status and license: revision
`b9113a172089e716b5eda7bbd117e630df211597`; dirty status:

```text
 M package-lock.json
 M package.json
 M packages/poe-agent/package.json
?? docs/plans/bugfix-shell-quote-parser-security.md
?? packages/terminal-pilot/assets/
```

This does **not** establish globally unchanged private state for the entire
assignment. Initial checkpoint revision `cb9f256...` advanced externally to
`031436f...` before the first successful snapshot; an earlier full reproduction
`TKeNic` observed external advancement to `b9113a1...` plus status changes.
The independent reviewer likewise recorded external index/revision/status
changes. Their exact evidence is retained; no drift was attributed to this
agent or hidden. No command here changed private source, mode, index, workspace,
dependencies, build, or cache. Git reads use `GIT_OPTIONAL_LOCKS=0`.

## Independent review and guard checks

`evidence/independent-review.txt` preserves the completed independent report from
`/tmp/safe-bash-safejs-isolated-security-result.txt`. Reviewer-owned fresh trees
`NM75nj` and `Ez7FxL` reproduced the same ten-test improvement and full-suite
regression. Reviewer conclusion: **FAIL / NOT APPROVED**. Its eight guard checks
passed. Do not add its overlapping supplemental tests to the acceptance total.

The two durable author guard probes also pass:

```sh
node --test tests/commands/safejs-stress/artifact-guards.probe.mjs
```

They cover pinned hash/path count, tampering, traversal/absolute/unapproved paths,
wrong baseline, and symlink ancestor rejection. The artifact manifest lists
hashes of repository-owned files for a precise handoff; it is not a signature.
No staging or commits were performed. Root review/authorization is required
before any commit; upstream application remains blocked by the real regression.
