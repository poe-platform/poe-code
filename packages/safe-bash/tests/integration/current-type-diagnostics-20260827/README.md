# Current global TypeScript diagnostic audit

## Verdict and frozen candidates

This is a **read-only product/config diagnostic audit**, not a full gate, runtime
acceptance, release approval, or native comparison. No test bodies, services or
private engine were run. Root source/config, author assertions and historical
captures remain unchanged. The original unqualified16520pass/307fail/13skip
cohort is not rebaselined or reduced by these findings.

Two independently archived, complete committed trees were checked:

| Candidate | Cold `npm run typecheck` | `npm run build` | Warm `npm run typecheck` |
| --- | --- | --- | --- |
| `b494675c34dc289f4ad4b10a9201e1211eb0a7d8` | exit2,30diagnostics | exit0,0diagnostics | exit2,11diagnostics |
| `954406871fae381b1c69441b34946a224201d7ad` | exit2,35diagnostics | exit0,0diagnostics | exit2,11diagnostics |

`95440687` was the current committed candidate selected at task start. Later
HEAD/foreign changes are deliberately excluded; this is not a mutable-HEAD
typing claim. Between these two candidates the only product changes are new
`src/commands/env-split.ts` and modified `src/commands/execution.ts`.
Package, lockfile and both root tsconfigs have identical hashes. There are
**zero production-path diagnostics** in either global run and both builds pass.
That does not establish absence of runtime/product defects.

The b49430cold and11warm rows exactly reproduce the authenticated retained
report. Current retains every original row and adds **five cold-only errors in
the new env-S packed public consumer**. Therefore “11foreign diagnostics” is
accurate only as an ownership description of the post-build result. It omits
the new env-S cold build-order problem and does not make those11 disposable.

## Every diagnostic path and code

Paths below are repository-relative. Numbers are compiler diagnostic counts,
not distinct broken APIs or runtime tests. `evidence/audit/diagnostics.json`
contains every full message, line, column and frozen file SHA256 for both trees.

| Path | Exact line/code locations | Cold/warm | Classification |
| --- | --- | --- | --- |
| `tests/commands/file/text-bound.test.ts` | 67:72,79:72,136:72 TS2749 | 3/3, both | Real current fixture type-annotation error |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__command.ts` | 1:33,2:43 TS2307 | 2/2, both | Flattened sealed source capture |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__filesystem.ts` | 1:33 TS2307 | 1/1, both | Flattened sealed source capture |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__io.ts` | 2:25 TS2307 | 1/1, both | Flattened sealed source capture |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__path.ts` | 2:25 TS2307 | 1/1, both | Flattened sealed source capture |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__plugin.ts` | 1:106,2:40 TS2307;31:17 TS7006 | 3/3, both | Two unresolved imports and one cascade |
| `tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts` | 6:8,7:91 TS2307;23:90,98:43,174:93,268:106 TS7006;40:18,41:18 TS18046 | 8/0, both | Maintained public consumer before build |
| `tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts` | 1:25,2:91 TS2307;25:59 TS7006 | 3/0, both | Maintained public consumer/helper before build |
| `tests/integration/adapter-tools/atomic-webdav-profile/controls.ts` | 6:8,7:91 TS2307;21:94,104:92,120:104,188:100 TS7006;32:18,33:18 TS18046 | 8/0, both | Maintained public consumer before build |
| `tests/shell-stress/env-split-consumer/packed-public-types.ts` | 1:73,2:90 TS2307;14:9,14:95,14:104 TS7006 | absent b494;5/0 current | New env-S public consumer before build |

Totals:

- b494cold:13TS2307 +10TS7006 +4TS18046 +3TS2749 =30.
- current cold:15TS2307 +13TS7006 +4TS18046 +3TS2749 =35.
- both warm:7TS2307 +1TS7006 +3TS2749 =11.
- Category counts:19old cold-only consumer errors;5additional current env-S
  cold-only errors;3current fixture annotation errors;8sealed-data errors.
  No other path/category is unclassified. In particular the previously classified
  native regex-glob payload subtree contributes **zero** diagnostics here.

### Fixture typing, not a missing runtime API

`text-bound.test.ts` imports no TextEncoder type. Under the actual `ES2023`+Node
configuration, `@types/node/util.d.ts` declares global `var TextEncoder` as a
constructor value; `node:util` separately exports the class/type. The three
`this: TextEncoder` callbacks therefore raise TS2749. This fixture entered in
`cd37ce07`; it predates env-S and is not raw data.

In each frozen copy an isolated minimal callback reproduces exactly one TS2749.
Adding only `import type { TextEncoder } from "node:util"` to that probe compiles.
A separate wrong-argument probe still emits exactly one TS2345 for `encode(42)`.
These are real compiler controls, not changes to the original fixture. Do not
add a DOM lib, `any`, suppression, or exclude this maintained `.test.ts`.

### Sealed historical data, not malformed current contracts

Six `.ts` files in the sealed `inputs` leaf are original source snapshots with
flattened names. Their `./filesystem.js`, `./io.js`, `./errors.js` and
`./command.js` imports retain original relative layout assumptions. Five files
produce seven missing-module errors and one implicit-any cascade; the sixth,
`src__contracts__errors.ts`, has no diagnostic.

All six byte hashes match both the historical provenance and inventory in both
candidates. Copying those **same bytes**, without edits, into their original
sibling names in a separate temporary directory compiles with the unchanged
strict root settings, in both runs. The sealed inputs are not newenv-S code,
native regex payloads, or canonical runtime tests. The existing captures and
their seals must not be silently renamed or rebound to current contracts.

### Public consumers require their actual declaration build

The four consumer files self-reference `virtual-bash`/subpath exports, which
point to `dist`. A genuinely cold archive has no dist. Missing declarations
cause the listed contextual-typing cascades; building this same candidate
removes all19old plus5new consumer diagnostics without altering source.
The three old WebDAV inputs also pass an independent strict scoped compilation
after each build. The new env-S file is present in both current compiler input
lists and has no warm diagnostic; it was not omitted to obtain11.

This is not evidence of a missing public export or an FS implementation bug.
The maintained WebDAV `.ts` programs have existing moved-package harnesses, but
the independent harness fixes an older68059389 product snapshot; that historical
proof alone is not current-candidate coverage. The env-S runner explicitly
strict-compiles its moved `packed-public-types.ts` at
`tests/shell-stress/env-split-consumer/packed-core.mjs:130`. Neither fact licenses
omission from current checking. This audit compiles, but does **not** run these
consumers or claim new packed/runtime acceptance.

`README.md:427` lists typecheck before build, while package-root use and the
dedicated consumer gate expressly document build first. Root must make the
source-only versus built-public-consumer boundary explicit and executable.
The current `.mts` release census does not itself classify these `.ts` files.

## The99 historical hash-guard failures

`evidence/audit/hash-guards.json` authenticates all99 rows against retained raw
TAP and compares the guard's entire checked set to **Git blobs before any test**.
No native identity checks or test bodies were rerun.

- **89** `tests/shell-stress/diagnostic-profiles/compatibility.test.ts` failures
  are one failed before-hook. The fixture map contains88cases plus one native
  lifecycle/identity test:72original differential,5syntax and11current gaps.
  **This is a current-product behavioral suite**, not89obsolete historical
  artifacts. Its bodies run the current `runVirtualScript`, compare the live
  pinned native oracle with the sealed observations, and then compare current
  product bytes/status/effects to those observations. None of those bodies is a
  pass or a demonstrated current behavioral regression here. Of14guarded test
  inputs,12still match. Two test-driver hashes were intentionally changed by
  `4fa20ac6`, which switched their reference imports/names to the frozen GNU5.3
  profile: `tests/shell-stress/differential.test.ts` and
  `tests/shell-stress/current-gaps/compatibility.test.ts`. Their pre-4fa hashes
  exactly match the old binder; their post-4fa hashes match both candidate Git
  blobs. The before-hook reports the first mismatch and hides the second.
  The guard's purpose is authenticating historical fixture/helper provenance,
  not freezing current shell implementation. The two changed sibling drivers
  are not the case arrays or helper used by this suite. Its actual fixture/helper
  hashes and frozen native assertions must remain protected when reconciling
  these stale provenance checks; removing89tests would lose current coverage.
- **10** `tests/shell/invocation-cleanup-public.test.ts` failures likewise precede
  all test bodies. Five of its six live source pins still match. The one mismatch,
  `src/shell/shell.ts`, was changed by `1b133a86` for scoped plugin setup/admission.
  The expected hash matches its parent and the archived4c16d9c5 runtime; the
  actual hash matches1b133a86 and both candidate Git blobs. The test would still
  archive4c16d9c5 even after a live-pin-only edit, so updating that one hash alone
  would misrepresent current coverage and break its snapshot pin too.
  **These10 are explicitly frozen-runtime public cleanup proofs**: real `grep`
  and `rg`, each in `normal`, `early-pipe`, `caller-abort`, `same-shell-sibling`
  and `other-shell-sibling` mode. The bodies demand zero live workers and no
  unhandled rejection at public settlement. The probe checks emitted module
  hashes from that archived runtime. These useful assertions are not evidence
  of current cleanup failure when the live before-pin fails; nor would a pass
  against4c16 certify the later candidate. A current-bound counterpart and an
  honest historical replay boundary require explicit owner reconciliation.

**All99 are old source/helper binders already unsatisfied in the committed
inputs; zero require an execution-time tracked-artifact mutation explanation.**
All reported actual hashes equal the committed pre-run hashes. They are still
failed canonical rows, not successful safety/compatibility assertions.

Separately, the original phase-level immutability failure names the direct-curl
tracked replay JSON. Its retained report is quoted in the audit only to separate
causes. Arch owns that writer repair; this investigation did not inspect or
reproduce its writer. No claim is made that the original full run was immutable.
Root subsequently supplied writer fix5f7fe5d7, independent385c6af8 and causal
proof60ddeb07. The read-only report at
`tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review/REPORT.md`
agrees with this separately derived0/99attribution; those later commits do not
change either frozen type cohort or retrospectively qualify b494.

## Minimal ownership requests

1. **File-fixture owner, routed by root:** type-only repair of the three callback
   annotations in `tests/commands/file/text-bound.test.ts`; retain all assertions
   and canonical discovery. The positive/negative compiler probes identify the
   minimal Node-native type import, not a production change.
2. **Curie root consumer/config owner, with Sagan for the env-S fixture:** explicit
   current build-first strict routing for the exact three WebDAV `.ts` inputs
   and new `packed-public-types.ts`, retaining compiler input manifests and
   negative public-type controls. If cold checking separates these inputs, the
   dedicated current-bound built check must be mandatory; a historical packed
   report or blanket `.ts`/test exclusion is insufficient. No new dependency or
   public-source export repair is indicated by these diagnostics.
3. **Tree evidence owner plus Curie config owner:** classify exactly the six
   sealed flattened captures as historical data, preserve original bytes/seals,
   and keep current contracts fully checked. A small preserved-layout strict
   historical check is demonstrably possible. Any filename/seal migration needs
   separate reviewed evidence; do not simply omit artifact trees wholesale.
4. **Sagan/historical shell fixture owners, root coordinated:** reconcile the
   two old binders without conflating their purposes: preserve89current behavior
   tests with frozen-native provenance, and explicitly distinguish10pinned-runtime
   cleanup proofs from current-runtime coverage.
   Keep original hashes/results and native expectations; retain meaningful
   tamper controls. Do not manufacture green by replacing pins while still
   executing an older source snapshot. No shell production fix is requested
   on the basis of these99 before-hook failures.

No implementation/config patch is included or authorized by this report.

## Reproduction, binding and limits

Node22.22.2, TypeScript5.9.3, @types/node22.20.1, Darwin arm64. Each complete Git
archive is extracted independently; dist is absent for the first check. All
tracked regular bytes and literal symlink targets are checked against Git blob
IDs and SHA256 before and after; no target traversal or source fallback occurs.
The12tracked native-fixture symlinks are data, not test executions. Existing
development tools are copied into regular files with no install/network/private
access. Build manifests contain704files at b494 and708at954; all are newly
emitted within that candidate's own copy. No dirty/shared dist is reused.

| Binding | b494 | current954 |
| --- | --- | --- |
| Full archive SHA256 | `a86aa83232e4693ca91410042520bcad9f97197486adedf8a46a263aee93a78c` | `36f44c263e54cd0b1471c49f4aeae4a94eada7a476b5e72c0b4953a58d75b4d7` |
| Tracked input files | 20264 | 21382 |
| Cold/warm compiler input files | 1666/1735 | 1669/1738 |

Evidence keeps raw stdout/stderr/status, all diagnostics, full compressed
tracked/tool/build manifests, generated probe hashes and exact cleanup records.
Both candidates complete with unchanged tracked inputs; all owned child work
settled synchronously and exact scratch directories were removed. Timing is
incidental, not a performance result. Compiler failures/skips are not passes.

The first two **investigator harness failures** are preserved in `evidence/b494`
and `evidence/b494-v2`, before any compiler execution. The first mishandled a
tab-containing Git filename. The second preserved a source-pointing tool symlink
despite the copy option and briefly overwrote the existing local tsc launcher.
That tooling write was reported immediately and restored to independently
authenticated cached-package bytes; see `evidence/b494-v2/ATTEMPT.md`. No product,
config or fixture changed. Unrelated concurrent tools may have observed the
brief damaged launcher; no assurance to the contrary is claimed. Successful
cohorts use explicit exclusive regular-file tool copying and verify the original
launcher unchanged. Neither failed setup is a candidate typing result.

Replay into a new, never-existing attempt directory:

```sh
node tests/integration/current-type-diagnostics-20260827/verify-evidence.mjs
node tests/integration/current-type-diagnostics-20260827/reproduce.mjs b494 v4
node tests/integration/current-type-diagnostics-20260827/reproduce.mjs current v2
```

`audit.mjs` originally creates its exclusive `evidence/audit` outputs; it is a
bounded Git/TAP diagnostic extractor, not a whole-gate runner. Subsequent readers
should run the nonwriting evidence verifier. No golden, source, runtime, FS,
package or configuration change is part of this owned evidence checkpoint.
New replay outputs require their own reviewed seal; they do not automatically
alter the original manifest or accepted classifications.
