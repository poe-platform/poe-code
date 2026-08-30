# Build-aware typecheck repair — 2026-08-27

Independent follow-up31e24055 withheld acceptance at20/21 controls because mixed
candidate/foreign declarations escaped the guard. Author repaira01310c5 and its
separate evidence are in `binding-followup/README.md`; independent closure is
pending. The original observations below remain unchanged historical evidence.

Author source/configuration commit **b9559de5c62fb679c8558fc2444ecb99f1d9eee1**.
This is a narrow workflow/data-classification repair, not product source, native
semantics, provider acceptance or a whole-product rerun. A different reviewer is
required. Production sources, dependency lock, foreign fixtures and staging were
not changed by this work.

## Exact repair

- `captured-types.json` classifies exactly five flattened tree captures causing
  seven TS2307 and one TS7006 diagnostic. Each original byte length/hash is
  authenticated against the unchanged provenance; the original replay driver
  and preseal are also authenticated. Capture HEAD966cfac6 identifies a recorded
  dirty worktree, not an invented clean source snapshot. No capture was renamed,
  edited or exempted from authentication. The sixth, diagnostic-free flattened
  `errors.ts` remains included. Current `src/contracts/**` and neighboring `.ts`
  remain compiler inputs. This is not a blanket artifact/extension exclusion.
- `typecheck:all` builds once before any current consumer compilation. It then
  runs the global source/test check, the existing selected-GNU consumer route,
  three explicit strict source-consumer groups and the existing standalone
  consumer inventory. A failed production build never starts consumers using
  stale declarations. Plain `typecheck` and `typecheck:consumers` require built
  exports and fail clearly with exit78 if missing; they do not claim existing
  `dist` is fresh. Use the combined command after source changes.
- The exact four cold-dependent `.ts` consumers are `atomic-mock.ts`, `controls.ts`
  and independent `hidden.ts` under `tests/integration/adapter-tools/atomic-webdav-profile*`,
  plus `tests/shell-stress/env-split-consumer/packed-public-types.ts`. They remain
  globally checked and get strict `skipLibCheck:false` groups using candidate
  built public declarations. Their explicit source MockDav helpers are retained,
  not presented as moved-package isolation or real-service proof.
- Standalone current consumers use copied `dist` plus package metadata in a
  temporary package with no `src` directory. Strict traces check built resolution
  and reject repository-source fallback. Exact negative diagnostics remain
  required, not accepted merely for a nonzero compiler status. Runtime programs
  are **not** executed or counted as passed by the typing command.
- Two later tracked fixtures from f2906a06 needed explicit existing-inventory
  routes: `env-split-validity/public-types.mts` is declaration-only, matching its
  original run-v2 phase; `invalid-binding.mts` requires the unchanged single
  TS2741 stdin-binding diagnostic. This changes the census177→179, not env-S
  behavior acceptance. Original177 classifications/historical evidence remain.
  `verify-current-consumers.mjs` only gains generic negative-filename normalization;
  its mandatory runtime pre/post checks and canonical `.test.mts` route remain.

## Frozen observations

Final v3: committed base **026e20cf38ddbb695d82de3f30cf7a1a7c88f088** plus exactly
ten owned workflow/configuration overlays whose hashes match b9559de5. It includes
Plato's separate 1a18cb18 file-test callback annotation repair; that is not our
fix. No live dirty foreign fixture was copied. Node22.22.2, TypeScript5.9.3,
@types/node22.20.1, Darwin arm64; all318 copied development-tool files are hashed
regular files. No install, private-checkout access, source-loader consumer,
network service or broad test suite runs here.

| Final frozen phase | Observation |
| --- | --- |
| Cold plain command | exit78, explicit build prerequisite, zero compiler phases |
| Combined command | exit0; exactly one production build; global source/tests0 diagnostics |
| Existing selected-GNU consumer | exit0; retained dedicated route |
| Current `.ts` consumer groups |3/3 strict, four inputs retained in root check |
| Standalone copied-build groups |19/19 strict; zero consumer runtime executions |
| Exact negative groups |1+2+5 expected diagnostics; no extra/missing errors |
| Bounded repair/control checks |15/15, including all negative controls below |
| Existing canonical runtime-coverage controls |24/24; not24 service successes |
| Cleanup |All synchronous children settled; exact owned snapshots removed |

Negative controls reject changed captured bytes, broader exclusions, removal
of current source includes, missing current `.ts`/`.mts` consumers, an unknown
tracked `.mts`, missing built declarations, a deliberate TS2322 in current
`src/contracts/command.ts`, a neighboring TS2322 beside the excluded captures,
and a TS2322 in the current env consumer. The source-error case stops after the
failed build without running consumers. A resolution-string control covers a
directory-URL root's trailing slash; the final guard rejects source fallback.
Original current contracts, capture/provenance and replay bytes are unchanged
after all temporary mutations. Runtime coverage controls are unchanged.

Earlier v1 has14/14 checks; v2 has15/15. Their complete raw outputs remain in
the sealed bundles. V1 preceded normalization of the directory-URL source guard;
v2 preceded the extra three strict `.ts` groups, though the global compiler
already checked those files. Neither is relabeled as the final stronger route.
Each attempt records its own committed base, archive hash and overlay hashes.

## Reproduction and preserved history

```sh
node tests/integration/typecheck-workflow-repair/verify.mjs
node tests/integration/typecheck-workflow-repair/run.mjs /tmp/NEW-EXCLUSIVE-OUTPUT
npm run typecheck:all
```

The verifier authenticates33 raw captures and the frozen source blobs without
running compilers or changing files. The bounded runner archives the current
committed base and overlays only its explicit ten repair inputs; it reports that
identity rather than calling a dirty worktree a commit. It creates a separate
temporary Git index, reads source objects only during index setup, copies cached
tools as regular files and cleans that snapshot. New runs are new evidence,
not a rewrite of the stored observations. Captures include stdout/stderr/status
and full resolution traces compressed as base64 with raw byte/hash manifests.

Keep b494 **16520 pass /307 fail /13 skip unqualified** unchanged. Its30 cold/11
warm and954's35 cold/11 warm diagnostics are historical. The three TS2749 fixes
belong to Plato; this repair addresses exactly eight flattened-data diagnostics
and orders current consumers correctly. No old test failure is subtracted.

The prior execution-coverage repair c3fbda62 was independently accepted in
**7f7764b5**, with separate terminal-LF manifest correction **c4783b71**:
`../qualified-current-release-inventory-independent/repair-review/README.md`.
The exact ten remaining frozen failures and ownership/source routing remain in
`../full-gate-20260827/preflight-repair/HANDOFF.md:77`; exact30/11 diagnostics are
in its `TYPE_DIAGNOSTICS.md`. No foreign expectation or source was fixed here.

The whole-gate preflight remains bound to its previously reviewed candidate and
script policy. This repair changes package typing commands: a successor whole
gate needs explicit candidate/policy review and native staging, not a silent
edit of the old b494 seal. No new whole run is launched or claimed. Root owns
candidate coordination; different review of this workflow remains required.
