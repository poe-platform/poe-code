# Finite validation handoff

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
