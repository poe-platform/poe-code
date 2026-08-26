# Independent overlay rmdir check — 3a9177a

**Finding: unjustified useful-semantics restriction under the existing documented lifetime preconditions; no data-loss bug established in this candidate.** Static lower-only, preexisting upper-only and merged-empty paths all reject ENOTSUP. The reason offered for the blanket refusal assumes an external lower writer that the same README explicitly forbids during the overlay lifetime. No additional applicable identity/lifetime guarantee is missing for the distinct Memory backends exercised here.

## Pin and execution

- Pin `3a9177a7b8ddc1c20142720ffa96ea6f87f65e86`; isolated archive of contracts, Memory and Overlay plus package metadata, without live-source overlays.
- One narrow reproduction, **2026-08-26 23:08:44.726–23:08:45.310 UTC**, Node v22.22.2 / tsx 4.23.12. Exit 0 means all **11 labeled behavioral observations** matched the recorded candidate behavior, NOT acceptance of its restrictions.
- Exact argv/cwd/status in `run.json`; reproducer `probe.mjs`; full before/after namespaces, metadata (excluding read-side atime), bytes, typed errors and mutation traces in `probe.stdout`. `probe.stderr` is empty. No broad suite or readonly tests ran; no delegation, repo source/test edits or commits.
- `manifest-before.json` and `manifest-after.json` match for all 13 archived files, each compared against pinned Git content. Source archive SHA-256: `7624f6b61401e53093510c76744772cde42ace0c193d3cf9eb0633356e2e71ad`.
- Overlay implementation SHA-256: `b68fb33939bbc3422c3f4e42533e1e8075dd4a01c3148847e4eef9ce0f6465db`; approved contract Markdown: `90838dc4c536147dcd331a09387281192a15aab45df980e280df008d1333a52a`.

## Exact observations

Every static fixture uses distinct upper/lower Memory instances, fully seeded before creating the overlay. All subsequent legitimate mutations use the SAME overlay; a lower proxy rejects any attempted lower mutation. Lower bytes/metadata stayed unchanged apart from allowed read-side atime.

| Case | Candidate result | Effects during rmdir |
| --- | --- | --- |
| Static lower-only `/d`, empty | typed ENOTSUP `/d`, syscall rmdir | No mutation; directory remains |
| Static upper-only `/d`, seeded before overlay, lower absent | typed ENOTSUP | No mutation; directory remains |
| Static merged `/d`, both backing directories empty | typed ENOTSUP | No mutation; both remain |
| Upper `/d` created using `overlay.mkdir` | Success | Exactly one upper.rmdir; overlay `/d` becomes ENOENT |
| Logical empty after individually whiteouting a lower child | typed ENOTSUP | No mutation; child stays hidden and backing bytes survive |
| Logical empty after removing/recreating that directory through overlay, making it opaque | Success | Exactly one upper.rmdir; hidden lower child bytes survive |
| Visible lower child | typed ENOTEMPTY | No mutation; whole before/after namespace and bytes preserved |
| Visible upper child | typed ENOTEMPTY | Same preservation |
| Same-instance child write queued BEFORE rmdir | Write succeeds; rmdir ENOTEMPTY | New child bytes preserved; no backing rmdir |
| Same-instance child write queued WHILE rmdir holds queue | rmdir succeeds; later write ENOENT at parent `/d` | Only upper.rmdir; child was never created/deleted |
| External lower write during lower listing, deliberately outside precondition | ENOTEMPTY | External child remains visible and intact |

The two hidden-child preparations use ordinary nonrecursive `rm` calls on the child/directory before the measured operation, then `mkdir` where required. No recursive argument is used as a rmdir workaround. Setup traces are separated from rmdir mutation traces.

The queue-after test pauses the upper rmdir before its actual removal, submits a child write through the same overlay, yields one event-loop turn and proves no backing write has started. Releasing removal produces success followed by the writer's ENOENT. It does not test or assume an external writer is serialized.

## Contract versus new restriction

`src/contracts/filesystem.md:8` requires empty-directory-only removal, preserving nonempty data; `:15` prohibits prior-listing-plus-recursive deletion; the final paragraph explicitly adds no transaction, descriptor-relative identity or global snapshot guarantee. The optional method may report ENOTSUP where safety truly cannot be supplied. That clause alone does not promise every path is supported, but it does not establish inability in these valid static cases.

The existing Overlay prerequisites in `src/fs/overlay/README.md:5` require distinct non-aliasing backends, exclusive upper ownership, and **no external lower modification while the instance is in use**. The instance-local/nonpersistent whiteout limitation is explicit at `:37`; namespace serialization is documented at `:60` and implemented by `run` (`src/fs/overlay/index.ts:138`). Static lower membership plus that queue is the applicable lifetime guarantee. A whiteout of a logically empty lower directory does not delete any backing descendant.

The new `README.md:160` paragraph instead requires opaque/whiteout isolation because an external lower writer might appear. `index.ts:568` first rejects every lower-selected directory; `:569–570` rejects nonisolated upper directories even with an absent lower path. This explains the valid static failures and the distinction between seeded and overlay-created upper directories. The newly documented limitation is a scope reduction, not evidence that the original prerequisite is insufficient.

The author's `tests/fs/overlay/rmdir.test.ts:83` changes lower directly after taking its listing; `:112` also modifies the backing lower through another reference. Those are outside the documented unchanged-lower prerequisite. Correctly noting that readOnly restricts only a handle does not negate the caller's separate lifetime obligation. Such adversarial observations can remain explicitly labeled defensive diagnostics, but cannot be the sole justification for rejecting compliant static workloads.

There is no need to invent a frozen-lower capability or claim that readonly alone proves immutability. Nor does this finding fix generic mount/decorator alias identity: those independent limitations remain. The reproductions require neither links nor opaque backend identity inference.

## Minimum safe source correction for the owner

Keep `rmdir` inside `run(..., false)` with existing root/type/path/parent-permission checks and the final merged-emptiness check. Do not call ordinary rm, staged rename, descendant deletion or garbage cleanup.

1. Remove the blanket lower-selected rejection and the `isolated` prerequisite at `index.ts:568–570` for the already documented compliant Overlay lifetime.
2. If the selected entry is upper, require and call `upper.rmdir(entry.path, options)`; propagate its errors. Never publish a whiteout if the backing primitive rejects. A physically nonempty upper must stay intact, even if some backing state is logically hidden.
3. If selected entry is lower-only, perform **no backend mutation**. After the merged-empty check and immediate abort check under the queue, publish the directory whiteout synchronously. No upper rmdir capability is needed for this branch; preserve the overlay's existing general write-policy prerequisites.
4. Preserve synchronous whiteout/link-metadata publication after a successful upper removal, existing cancellation/error behavior, and the no-cleanup path. Do not introduce a late-abort window that leaves a successful removal's lower counterpart exposed.

Under unchanged lower and exclusive upper ownership, there is no outside namespace writer to invalidate the lower emptiness observation. Same-instance writers are serialized: an earlier child is detected, a later child operation sees the removal. Recreating the directory later must retain opacity so already hidden lower descendants do not reappear.

Add/retain owner tests for all compliant rows above with exact success/ENOTEMPTY expectations and bytes; do not accept ENOTSUP as their replacement success. Keep unsupported upper-rmdir, physical-nonempty, cancellation and no-recursion controls. If the project instead wants mutable external lower providers, root/Curie must explicitly revise that broader coordination contract; do not impose a new missing guarantee silently on current compliant callers.

**Current preservation verified:** all static rejections leave the complete captured namespace unchanged; every successful measured rmdir calls only upper.rmdir, with no rm/rename/lower mutation. The candidate's nonempty and same-instance queue safeguards are useful and should remain. Only the unnecessary static-lower restriction needs correction; no source change was made by this leaf.
