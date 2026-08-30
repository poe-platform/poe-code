# Authorized final shared-input + column replay

**Fresh scoped replay is sealed for `0123c83d3aae72a15621acbb29a165b97b2c6ab6`.
This is not public integration approval.** Root public integration remains HOLD
pending its separate Arch v2 review and integration decision. Alias original
groups belong to the parallel verifier and were not duplicated here.

## Immutable binding

The root-announced candidate was recorded and checked before any candidate import.
`BINDING.json` records the receipt, wrapper and fixture hashes, ancestor checks,
and dirty live context. Live source is not an execution input. Required identities:

| Binding | Git identity |
| --- | --- |
| Candidate | `0123c83d3aae72a15621acbb29a165b97b2c6ab6` |
| Final-input ancestor | `f8819e9d6b6d535b0626e0aa004bb10a7bc36785` |
| Padding ancestor | `a809635432f18a235b8fb622a05367bedc54b315` |
| Alias ancestor | `04644bc2c15d67155f5f4b170a66fc9bef3f6e3d` |
| `src/shell/input.ts` blob | `3eec71b72f87dd48ddac572d6e7feb9097d32be4` |
| `src/commands/column` tree | `8b32998383d1372a8624ac41d2e747551e5b6d4c` |
| `src/commands/grep-aliases` tree | `5e8ac069bfa6ead7a337130457cd6519f2066e2c` |

Mismatch is fatal. The whole archive contains **27,687 authenticated Git blobs**;
all blob bytes match the announced commit. It is not a live overlay, worktree,
partial source selection, or synthetic cherry-pick. Twelve unrelated archived
native symlink-fixture blobs are materialized as regular link-text files, with
original Git modes recorded. They are not dereferenced or executed. All other
archive files are read-only regular files; the original tar is also authenticated.
This preserves whole Git blob content, not those unused native symlink semantics.

## Fresh counts — not an additive union

| Cohort | This execution |
| --- | --- |
| Unchanged revised current-contract probe, built source | **12/12 pass** |
| Same unchanged probe, freshly packed and moved | **12/12 pass** |
| Original functional recipe identities other than S38 | **39/39 pass** |
| Literal original 40-recipe legacy cohort | **39 pass, 1 fail / 40** |
| Original recipe-associated variants | **83 pass, 1 fail / 84** |
| Original supplemental variants | **4/4 pass** |
| All original executed legacy variants | **87 pass, 1 fail / 88** |
| Unchanged original hidden-return reproduction | **exit 1 / HOLD** |
| Unchanged owned context/cancellation regressions | **6/6 pass**, no skip/cancel/TODO |
| Production build, scoped strict types, moved consumer types | **exit 0 each** |
| Four unchanged fixture detector mutations | **4/4 detected**, each exit 1 |
| Deadline/output/leaked-process runner controls | **3/3 detected**, each wrapper exit 1 |

These cohorts overlap and must not be added. No case was unexecuted. Historical
**37/40** remains unchanged; this does not turn either historical or current legacy
S38 into a pass. N01/N03 satisfy their original expected bytes after the deliberate
padding evolution. The old native goldens were compared freshly as their captured
profile, without running native binaries or making a new native-acceptance claim.

The sole legacy failure is literally
`S38/known-root-hidden-external-stdin-return-boundary`. That historical label is
preserved as data, not endorsed as a present source-bug diagnosis. Its unregistered
raw-return post-disposal barrier is stronger than the declared policy. The original
script still observes return once, exec/dispose settled before its controlled
release, exec rejection `Error: Shell is disposed`, and **exit 1 / HOLD**.

The revised cases instead distinguish normal raw-return waiting/error propagation,
policy-permitted interruption of unregistered opaque return, and explicit
registered ownership. Registration precedes acquisition; the same idempotent
cleanup shares completion across finally/runtime/external-return calls. Registered
exec and concurrent dispose wait for retirement; the negative unregistered owner
does not. Exact error/caller identity, output/VFS bytes, and late rejection
observation are unchanged assertions. Both positive corpora finish with zero
unhandled events under `--unhandled-rejections=strict`.

## Fixtures and execution equipment unchanged where promised

The prior `ee933d5d` probe, loader, consumer, and hardcoded-3af runner are unchanged.
The new `run.mjs` derives its orchestration from that runner but binds only this
announced candidate, narrows scoped tests to the requested six regressions, and
uses a separate fixture directory and fresh output. No old result was imported.

Pinned probe SHA-256:
`ca527d7a6e57d497f1c8118e64e3c416133b3b5eb558ca9f766a1dbaf64bbb08`.
Loader SHA-256:
`4ad42af4f5329a6bccffd8e695d1e35b7dfcde52e1e1f089d8d0e2777ff4fc94`.
Consumer SHA-256:
`b2b44e440153be72a34aff617b27f02b4c52b508295ce6a81904322ba82ef35d`.
All match immutable ee933d5d bytes, archived candidate copies, and retained live
originals before/after. Original recipe/golden/expectation/stress/safety/hidden and
six-regression inputs also match ee933d5d; no fixture/assertion was edited.

Existing padding-review `runner.mjs` supplies process-group leak detection and
bounded stdout/stderr/deadlines. Only its two hardcoded temporary/cache prefixes
are rebound into this invocation's isolated directory; `bounded.mjs.txt` preserves
the exact executed binding. Original runner SHA-256 is
`32ca0e1ad0425b6084cfd1bd3c4eb8f3c8d06cafee545a6df8ea7bbc0688cf2a`.
`TSX_DISABLE_CACHE=1` avoids implicit cache writes; npm uses an explicit owned cache.
This is equipment reuse, not a new assertion framework or product mutation.

The unchanged fixture mutants catch missing registration, wrong output, and wrong
error identity. The real late-unhandled sentinel uses its original `throw` mode
with listener and exits 1; its event is intentionally retained, never included in
the zero-unhandled positive results. The three runner negatives deliberately cause
deadline, output-cap, and surviving-process-group detection. In the leak control
the child itself exits 0, but the **wrapper rejects it** and retires the surviving
group. All three groups are absent after retirement. No positive depends on forced
cleanup; every non-runner-negative child has no timeout/cap/leak/signal/spawn error.

## Source, pack and import authentication

| Content | SHA-256 |
| --- | --- |
| Whole candidate Git archive | `64fac38e43ce89009e03d24b8b3dffb8425dd98a313bea4d4133d6db8030cccf` |
| Fresh offline pack | `62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6` |
| Input TypeScript | `4214a448a1a076acb297c3ba6a02d72482d488cf8b6df4549498148a012e5c32` |
| Actually loaded input JavaScript | `f8b984b6fc338ff3d1ca60e10283ab100d8e62a697f4b7f8e691819c28ea7c4a` |
| Column subtree path/SHA-256 map, including README | `8c7c44d175c1935699eaa216ce5ffe6ec6103b7d97dbbb95ffacc48c8786d543` |
| Full built inventory before **and** after | `acab0a47b52efd9b554176aa4fc89a2dd98691189f36511e4e6c1caa00f61daa` |
| Moved package/consumer inventory | `379d3615d0e23d9995418f9cea75eb5f93d0784aababe96ced168f20893827d0` |

The column digest is SHA-256 of `JSON.stringify(Object.fromEntries(...))`, using
Git-ordered `SOURCE.json` entries under `src/commands/column/`, mapped to each file's
SHA-256. Per-file input/source/config/test hashes and original Git modes are retained
in `SOURCE.json`. Full directory membership, file type, mode, length and content
are compared before/after; **new entries are detected**, not just changes to old
paths. Archive, pack, development dependencies and fixture bytes are rechecked.

Every source/moved/mutant invocation has **181 actual module-load receipts**.
The unchanged loader admits only its exact probe and the bound candidate `dist`.
The fresh package is unpacked, physically moved, then run using **public root
`virtual-bash` Shell plus the INTERNAL packed column file URL**. All packaged
compiled bytes bind to this build; declaration-resolution trace binds both root
and internal column declarations. There is no public `./commands/column` export
and no public-subpath acceptance claim. Runtime dependencies remain empty.

Locked installed development packages are copied as regular files and inventoried
before/after: TypeScript 5.9.3, tsx 4.23.12, esbuild/platform 0.28.2, @types/node
22.20.1, undici-types 6.21.0, fsevents 2.3.3. Installed versions/integrity declarations
match the immutable lock; no install or fresh registry/signature verification is
claimed. npm packing is offline/ignore-scripts, not an OS-level network sandbox.

## Limits, chronology and closure

Capture window: **2026-08-27 16:27:17.015–16:28:09.779 UTC**, Darwin arm64,
Node **22.22.2**. The wrapper/receipt are authenticated before imports; their
evidence commit follows execution. One execution attempt completed; there were
no unexpected initial harness or source failures to correct. Expected legacy,
fixture-mutation, and runner-negative failures remain raw failures.

The source-correctness evidence d9a58cdc and its pending Arch v2 fixture review
are separate root inputs, not extra passing rows in this replay. Neither the old
3af capture nor another verifier's matching pack hash supplies these results:
fresh commands/build/package/probes and their raw receipts are retained here.
No author148, independent padding corpus, alias original groups, whole gate,
comparison benchmark, or private repository work was performed.

The announced archive still contains `preserved-source.test.ts` and its two
historical pin checks. The later live rename is not overlaid. This module cohort
does not run the default whole gate or rewrite discovery/configuration.

All 19 bounded child commands close, with process-group checks retained. Gates
are explicitly released/awaited; intentional runner terminations are separate.
`CLOSURE.json` records a final addition-detecting inventory/archive/pack audit and
removal of the exact owned temporary snapshot. Historical evidence, sources,
canonical tests, root files, other owners' changes and staging remain untouched.

Reproduction is explicit: `node tests/commands/column-stress/final-shared-replay/run.mjs`
with a unique new output directory under this scope. Static verification is
`node tests/commands/column-stress/final-shared-replay/verify.mjs`; it authenticates
the sealed evidence without rerunning product cohorts. `MANIFEST.json` is bound
by the enclosing evidence commit. No superiority, global-green, 72-hour completion,
or public integration approval is asserted.
