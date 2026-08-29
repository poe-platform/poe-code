# B1-r3: layout-only successor and C18 source adjudication

No actual B1 rerun is authorized. Original 8 PASS / 2 FAIL / 5 UNRUN, runtime exit 1, publication exit 78 and 32 known roles remain unchanged. Missing RESULT stays incomplete/UNKNOWN; this successor does not change publication behavior.

## C18: diagnosis, not an expectation migration

The unchanged fixture is `../v4/workflows.mjs:127–134`, SHA-256 `6d8a19854a6e96986013ed3d94ee15dd774e225259dea922bf4749799c60d89b`.

1. Register a caller-owned `original` node definition, install a non-replacing node plugin, then execute **`true`**, not Node. The expected duplicate-registration rejection comes from `src/commands/node/index.ts:41` during deferred plugin setup (`src/shell/shell.ts:119`). It is not a denied Node capability or caller abort.
2. Line 129 then asserts the registry result is reference-identical to `original`. Selected `src/contracts/command.ts:76` stores a frozen **copy**; `get` returns that stored copy. This is a source-proven incorrect fixture identity expectation. Capture retains only the outer `workflow C18 failed`, not the underlying assertion stack. The observed one shell/fulfilled cleanup/prepares=0 agrees with failure here; do not claim a measured failing program counter.
3. An independently incorrect later expectation at line 130 requires `dispose()` to rethrow the setup failure. Selected `src/shell/shell.ts:321–335` explicitly drains/reject-observes readiness and selects actual disposal/cleanup failures, not the already surfaced setup error. That later assertion was not reached on the source-supported path.
4. Only after these checks does the second shell request **`node -p '8'`**, with stdout/stderr grants and explicit replacement. Its intended success would prepare one provider, print `8\n`, and verify option snapshotting. There is no C18 abort, `AbortController`, or requested forbidden module/capability. This Node request is unobserved/unreached; prepares=0 is not evidence of a Node provider defect.

**Disjoint proposal for ROOT, NOT applied:** save the registered snapshot immediately after registration; assert the same stored snapshot remains after collision, preserving name/handler identity; assert collision exec rejects with the same message, while disposal fulfills absent actual cleanup failure. Preserve the replacement/option-mutation/`node -p '8'` assertions. Add explicit per-substep observations and preserve the original cause presence in a versioned capture, without truthiness classification. No product repair is supported by this evidence.

## Minimal harness repair

The old runner physically renames installed to moved, retaining `harness/load-manifest.json`, then exclusively recreates that same file. The new runner creates **`harness-<layout>`** exclusively for each of the three finite layout names. Thus moved retains `harness-installed` and creates `harness-physically-moved` without overwriting/deleting prior manifest, policy, scripts or traces. Package movement remains the same actual directory rename. Module entries, aliases, worker entry, policy and request are recomputed against the new physical layout as before.

Retained `node-load-guard.mjs:5` and `node-policy.mjs:8` resolve their manifest/policy one directory above `node/`; no helper bytes or permissions need changing. Neither product/package/PUBLIC95 nor workflow expectations change. The inherited historical file map and stage-file bytes remain pinned; additional successor files are explicit. Frozen r2 remains immutable.

## Presealed controller scope

One Node DATA/filesystem-only controller, four groups: L01 physically rename inert package stand-in; L02 retain installed manifest/trace while exclusively creating moved manifest; L03 duplicate layout/file refusals without overwrite; L04 exact relative loader/policy path resolution plus invalid layout/path refusal. No Shell/product imports, real package install, hook registration, Worker, compiler, engine, oracle or network. Cleanup removes only the fresh controller-owned scratch tree. These are not semantic, actual-package or nested-load proofs.

## Future packet status

`PRESEAL.json` binds the new executable files and unchanged inherited inputs; `SEAL-RECEIPT.json` gives exact sizes/hashes. Prospective 15 calls remain C10/C11/C15/C16/C18 × source-built/installed/physically-moved, with original 32 known OS / peak 3, 1800s inclusive, 64MiB capture / 768MiB logical work, at most 15 guest Workers/live 5, no Regex or asynchronous loader threads. No fresh activation window exists. C18 remains unchanged and expected to expose its old fixture problem until ROOT authorizes a separately versioned correction. A fresh publication/final-slot binding must explicitly admit r3; old grants cannot launch this packet.
