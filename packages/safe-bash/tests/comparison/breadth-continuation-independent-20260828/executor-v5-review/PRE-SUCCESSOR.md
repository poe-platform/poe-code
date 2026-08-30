# Independent pre-handoff resolver expectation freeze

2026-08-28. This is a bounded V4 diagnosis and independent synthetic expectation
freeze, **not V5 candidate inspection, preexecution acceptance, admission, a fresh
grant, or a semantic/cohort GO**. The assigned leaf owns only this new directory.
No author, product, prior evidence, root package, index foreign entry, or instruction
file is edited. No delegation, network, XAN, installs, archive extraction, real
engine/comparator/native execution, builds, timing cohorts, or production staging.

## Honest ordering and authority

First explicitly captured clock: `2026-08-28T11:39:24Z`, HEAD
`2a9d59c77c9a4d94fa56d61962c5d6dfd01c189f`. Initial index was empty; the owned
directory did not exist. Foreign modified launcher files and untracked native,
review and V4 runtime artifacts were present and are not ours.

The successor path was absent at an early metadata-only existence check. At
`2026-08-28T11:44:35Z`, `executor-v5/` had appeared as **untracked**. We have not
read its contents, tests, seal or results. Therefore this is **pre-handoff and
pre-independent-execution**, not a claim to have frozen before the author began
or before any successor appeared. The commit recorded with the eventual capture
is the immutable independent source/expectation boundary. No V5 acceptance is
inferred from it. A metadata-only current tracked-path check is recorded too;
absence at one instant cannot establish a continuing absence or first creation.

## Exact V4 diagnosis

All source references in this section use recipe commit
`b993d26cd6777567ab6de45c617f1b073dd0d1de`, with the prefix
`tests/comparison/breadth-continuation-20260828/`, unless specified otherwise.

1. `executor-v4/coordinator.mjs:75` enrolls the launch; line84 runs `worker.mjs`
   with **cwd = runRoot**, not the consumer URL. In this failed run, cwd was
   `/Users/kjopek/Workspace/safe-bash/tests/comparison/breadth-continuation-20260828/executor-v4/runs/admission-v4-01`.
   `executor-v4/supervisor.mjs:31` passes that cwd to spawn.
2. `executor-v3/projection.mjs:93` constructs the view description. Lines96–99
   append a root `consumer.mjs` to target package entries under
   `node_modules/virtual-bash/`, but append **no root consumer package.json**.
   `projection.mjs:123`–129 writes that same layout and renames the moved view;
   `authenticateView` at101–105 faithfully accepts the incomplete description.
   Target-installed and target-moved share the missing-boundary design. This
   source inspection is not a rerun of staging or a moved-engine observation.
3. `executor-v4/worker.mjs:37` authenticates/inspects the view; line42 installs
   strict loader hooks; line44 dynamically imports the absolute consumer URL.
   Worker URL is the entry import's parent; the consumer URL is the subsequent
   bare library import's parent. These are different edges. cwd is neither edge.
4. `consumer.mjs` is exactly 61 bytes:
   `import * as library from 'virtual-bash';\nexport { library };\n`.
   SHA256 `2c8baf95aacda393a4d4f347f49ee5527749a377ce72d6e1dbe0d5a624bcbd2c`.
5. `executor-v3/loader.mjs:30` asks Node's real resolver; line31 requires the
   resolved URL in the explicit file map. The committed FD3 fatal message in
   failure `d40af0d52381a138f2dabb415d343526ad015722` records:

   - specifier: `virtual-bash`
   - actual parent: `file:///Users/kjopek/Workspace/safe-bash/tests/comparison/breadth-continuation-20260828/executor-v4/runs/admission-v4-01/views/target-installed/consumer.mjs`
   - actual forbidden URL: `file:///Users/kjopek/Workspace/safe-bash/dist/index.js`

6. The committed post-audit records the containing root package as `virtual-bash`
   with `exports["."].import = "./dist/index.js"`. Current readonly root metadata
   has the same SHA256 `b8475443860bfb0513a87cf6970ce2953e1858f27911ad3854e55f69ff22aa12`
   and the same values (`package.json:2`, `package.json:14`). A current ancestor
   metadata walk from that exact consumer to repository root found only that
   package scope. The untracked original config and STAGED bytes match hashes
   committed in RESULT; their selected fields independently confirm no root
   wrapper in the declared target file list. No staged product contents were read.

**Observation:** the returned URL and strict rejection are recorded runtime
facts. The consumer alone has a returned-source witness; there is no product
source witness or successful export evaluation. **Diagnosis/inference:** the
nearest enclosing same-name package's self-reference export supersedes installed
dependency lookup. This explains the observed URL, rather than attributing it to
cwd or product behavior. Independent synthetic controls below test that mechanism
with real Node parent URLs; they do not retroactively execute or qualify V4.

The prior review (`91b7a93f60640a9496c65147fb29c8610d29f7f4`, expectations
`b1b1d5d16f4f24e486f3170caed0db6132b5cbd6`) remains **29/29 DATA+SYNTHETIC,
five closed children**, not real admission. Actual V4 admission remains
**UNSAFE_STOP, first of14, 0 qualified, 0 C11, 0 semantics**, grant
`c1b03b641aa51f36e1461973e6d635103e1ef1e5` consumed. Probe4869 and coordinator4809
exit1/close1 without signal and are recorded reaped. The child receipt's literal
`natural:false` is preserved: V4 `supervisor.mjs:63` computes it through
`safety.mjs:37`, which requires **exit0/close0**. Thus it is not evidence of a kill;
the process ended normally but unsuccessfully. Do not silently change that field.

All three stage postguards and original comparator3843 regular members plus one
instruction metadata member/full-pack authentication passed **PROJECTION ONLY**
in the prior evidence. This leaf reads that receipt, not the archive or instruction
plaintext, and does not reauthenticate archived bytes. Exact original pack is
`6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`, target
`67eab12e315054907ef4ef435c6bbca2f59e0c36`; comparator is pinned3.4.2, not latest.
Original35/44/nine failures,400/402,391/394,13/54 versus47/54 stay unchanged.

## Independent expected matrix

`EXPECTATIONS.json` freezes15 controls: four positives and11 expected negatives.
Each gets one fresh, serial Node child. No candidate helper is imported; the only
loaded library-shaped modules are known synthetic strings in `FIXTURES.json`.
The source seal binds every fixture string's SHA256, size, and intended0644 mode.

| Control | Frozen required result |
| --- | --- |
| bareexports-target | Installed virtual-bash stub via package exports; target sentinel once |
| bareexports-baseline | Installed just-bash stub via package exports; baseline sentinel once |
| cwd-independent-target | Different cwd; exact consumer parent still resolves installed target |
| selfref-trap | Same-name enclosing wrapper exports trap; real resolver returns trap; UNBOUND_MODULE before evaluation |
| missingboundary-resolver | No inner package scope; real resolver returns outer ambient stub; UNBOUND_MODULE before evaluation |
| missingboundary-preflight | BOUNDARY_MISSING before consumer load |
| wrongname-target | Hash-bound but virtual-bash-named wrapper; BOUNDARY_NAME before consumer load |
| wrongname-baseline | Hash-bound but just-bash-named wrapper; BOUNDARY_NAME before consumer load |
| unboundtarget | Correct installed target resolves but is not whitelisted; UNBOUND_MODULE before evaluation |
| movedoriginabsence | Actual synthetic rename, original absent, relocated exact parent resolves installed stub |
| hash-beforeload | Same-size target source tamper; LOAD_HASH; no library sentinel |
| mode-beforeload | Target0644 to0600; LOAD_METADATA; no library sentinel |
| wrapper-hash-beforeload | Same-size wrapper tamper; BOUNDARY_HASH before consumer load |
| wrapper-mode-beforeload | Wrapper0644 to0600; BOUNDARY_METADATA before consumer load |
| entry-parent-denied | Actual worker parent differs from allowed entry parent; ENTRY_PARENT before consumer load |

Only the two explicitly marked diagnostic resolver controls bypass wrapper
preflight, to expose actual Node self-reference rather than merely testing our
preflight function. The loader remains strict even there; traps never evaluate.
All negatives must exit23 with the exact expected reason, not be relabeled
successful imports. All positives must exit0 and emit only their one expected
sentinel. Receipts retain actual specifier/parentURL/resolvedURL, source witnesses,
mode/hash checks, and complete stdout/stderr plus exit/close/PID/group absence.

## Minimal proposed successor checks, not author implementation mandates

- Give each consumer a real enclosing package boundary with a concrete nonempty
  package name distinct from **both** libraries. The independent fixture uses
  exactly `safe-bash-breadth-consumer-fixture`, private true, type module. That
  spelling is not mandatory for Raman: a different concrete name may satisfy the
  same distinctness property if its exact bytes, size, mode and SHA are bound.
- Bind wrapper package metadata before Node resolution, as well as module source
  before evaluation. Package-scope metadata may be consumed by the resolver
  without passing through a module load hook. Merely allowing package.json in a
  source whitelist does not prove its bytes controlled resolution.
- Add the same bound wrapper to target-installed and target-moved view creation
  **and** expected projection/authentication. Preserve original full-pack contents,
  comparator3843 closure/instruction-metadata policy; wrapper is harness-owned,
  not a change to product package exports. Respect existing comparator scope.
- Check the first worker→consumer parent URL separately from consumer→library.
  Require the exact known entry importer and exact consumer target; subsequent
  parents/targets must remain bound. Do not permit arbitrary unbound parents,
  use cwd as a substitute, alias bare import to a direct module path, or fall back
  to the live checkout. The actual parent and resolved path must be witnessed.
- Keep wrong hash/mode and out-of-map resolution failures before evaluation, and
  physically absent moved origin. Preserve strict rejection, not broader allowlists.
- Reseal the narrow helper/projection/operation/authorization dependency closure
  for a future handoff. Old grant and accepted V4 recipe cannot authorize changed
  V5 bytes. This independent document deliberately issues no new grant/interface.

## Frozen execution protocol and limits

After the source/expectations/preseal are committed, the only permitted executable
check here is `run.mjs <EXACT_FREEZE_COMMIT>` with pinned Node22.22.2, strict
unhandled rejections and64MiB old-space (heap, not RSS). It verifies source bytes
against that Git commit before/after and before each child; each child has8s
deadline, at most64KiB retained per stdout/stderr and exact owned-group SIGKILL
on timeout/output cap. One child at a time; no broad process killing. It records
exit/close and PID/group absence, stops on first mismatch, and refuses existing
`capture-01`. First capture is preserved even on harness defects; no automatic
retry, expectation revision, or rebaseline. There is no eval or shell fixture.

Synthetic filesystem trees are exclusively under this owned capture directory,
created from sealed strings, not product/comparator staging or extraction. Only
metadata about historical packs/instructions is read. The baseline source hashes
in BINDINGS are provenance for inspection, not a claim to execute their helpers.
File hashes/mode snapshots are point-in-time checks, not a concurrent-mutation
lease. Node's real resolver is exercised here, but this small synthetic harness
does not certify the author's later implementation, authorization, sandbox,
provider behavior, production package, native parity or superiority.
