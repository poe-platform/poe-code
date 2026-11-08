# Historical pre-integration tree/file dispatch discovery

This directory preserves the **historical `e9daab5` observation**, not a claim
that `tree` or `file` must remain absent in future or current builds. The root
accepted discovery and subsequently assigned active, disjoint tree/file authors.
Live defaults and later integration belong to other owners. No new source
inspection, dispatch, tests, native commands or version probes were performed
to seal these retained artifacts.

## Recorded observation

- Dispatch HEAD: `e9daab5722c682377cc59abec099648e3692c6ec`.
- Window: `2026-08-27T07:57:47.284Z`–`2026-08-27T07:57:47.424Z`.
- Recorded runtime: Node `v22.22.2`, Darwin arm64, installed `tsx`, source-root
  import of `src/index.ts`; not built `dist` or a package-export consumer test.
- Exactly **six `Shell.exec` calls**, entirely through `MemoryFileSystem`.
  No target stubs, replacement handlers, functions, aliases, host execution,
  network or virtual executable fallback supplied the commands.

| Profile | Command | Exit | Output |
| --- | --- | ---: | --- |
| Bare Shell | `tree /fixture` | 127 | Empty stdout; command not found |
| Bare Shell | `file /fixture/example.txt` | 127 | Empty stdout; command not found |
| `agentCommands` | `tree /fixture` | 127 | Empty stdout; command not found |
| `agentCommands` | `file /fixture/example.txt` | 127 | Empty stdout; command not found |
| `agentCommands` | `type tree file` | 1 | Empty stdout; both not found |
| `agentCommands` | `cat /fixture/example.txt` | 0 | `dispatch-control\n`; empty stderr |

`dispatch.json` retains exact text and hexadecimal output bytes, middleware
events, registry/factory inventories, path/export observations, historical
baseline-only inventory excerpts and source hashes. Those path/export absence
observations apply to the recorded checkout only. The positive registered `cat`
control distinguished actual dispatch from an inventory-only assertion.

The load hook recorded **157 actually loaded source files**, each with identical
before/after SHA256. The in-run hash comparison covered a superset of 167 source
TypeScript files plus package metadata, lockfile and the old inventory, with no
changed inputs. These are **on-disk source hashes, not hashes of transformed
JavaScript executed through `tsx`**. This was a concurrent, unfrozen worktree;
the raw contexts preserve unrelated dirty/untracked state rather than claiming
the whole repository was clean or frozen.

During the original handoff, other workers advanced HEAD to
`90c1a3cb04a6a01e456544cbac747b327a8dfb1d`. The original final check at
`2026-08-27T07:59:13.887Z` found all 160 recorded loaded-source/package/inventory
inputs unchanged. This is a second historical observation, not a fresh check
against the checkout in which this evidence is committed.

The earlier 54-name inventory was optional-inclusive: 50 default unmeasured
names plus four optional names, including a diagnostic-only `node` stub. Its
tree/file rows had no operational proof. This six-call discovery established
absence for these two names at the recorded source identity; it did not refresh
the entire inventory, run just-bash, establish parity or prove superiority.

## Manual probe, not a permanent absence regression

`discover.mjs` is the original **explicit manual pre-integration probe** and is
preserved byte-for-byte. It is not an automatic or canonical regression test.
Its absence assertions are expected to become obsolete as the assigned
implementations and integrations land. Do not add it to default tests, release
gates or ongoing CI, and do not remove implemented commands to make it pass.

The historical invocation was:

```sh
node --import tsx tests/commands/filesystem-inspection-stress/dispatch/discover.mjs
```

This command was **not rerun during sealing**. The script imports the checkout
where it is executed; it does not restore or freeze `e9daab5`. Any separately
authorized future execution needs its own source identity, outputs and
interpretation. Preserve this original cohort instead of overwriting it.

## Assigned API direction and retained constraints

Following discovery acceptance, the assigned API direction is:

- Tree family: `treeCommands`, `createTreeCommands`, `createTreeCommand`, in
  `src/commands/tree/**`, with author tests in `tests/commands/tree/**`.
- File family: `fileCommands`, `createFileCommands`, `createFileCommand`, in
  `src/commands/file/**`, with author tests in `tests/commands/file/**`.

These names describe the author assignment, **not verified root exports or
integration**. Root/default/package integration is owned elsewhere and follows
later. This evidence leaf authored no command plugins or product changes.

The original full API handoff is preserved without edits in
`handoff-original.txt`. Its present-tense words such as “current”, proposed
assignments and stopping instructions are historical text scoped to the
discovery window, not instructions to undo later assignments. The same applies
to `checkpoint-original.txt`. Important recorded author constraints include:

- `readStream` is optional and accepts range/chunk/signal options. Bounded
  prefix consumption must retain bounded owned bytes, use `readBytes`, close
  iterators on early exit and propagate cancellation. Consumer bounds cannot
  promise that a provider never overfetches internally.
- `readFile({ maxBytes })` is a whole-read limit, not a truncating prefix API;
  Memory rejects oversized files with `EFBIG`. No unbounded fallback may be
  substituted when streaming is unavailable. Await `writeBytes`, preserve
  backpressure and observe late cancellation/cleanup rejections.
- `readdir` returns an already-collected array, without paging or a listing
  bound. Family traversal/retention limits do not cap that prior adapter
  allocation. `lstat`, optional `readlink`, followed `stat` and `realpath` have
  distinct roles; lexical paths are not symlink containment or authority.
- Complete identity requires an opaque scope plus valid device/inode values;
  missing identity remains unknown. `compareEntry` concerns followed entries,
  preserves errors and provides no lease, snapshot or ABA protection.
- The public command context exposes no general traversal/input budget.
  Command-family limits are **family-local**, not a single shared shell
  budget. Existing shell output/dispatch accounting remains separate; do not
  import internal runtime budget machinery into a family.
- `FileStat` lacks **blocks and allocated-size fields**. Optional metadata
  stays unknown when absent; mode bits can be advisory and are not privacy
  guarantees. There is no general no-atime inspection guarantee. **No `du`
  implementation or allocated-size guess was made.**

The seal changes no source, defaults, contracts, dependencies, private code,
other authors' files or unowned native artifacts. No vendor code or dependency
files are included here.

## Historical native-oracle availability

Exactly **one native version probe** was made during the original discovery:
`/usr/bin/file --version`, reporting `file-5.41` and magic data at
`/usr/share/file/magic`. No native content-classification oracle was run.

Native `tree` was absent from the inspected PATH and three recorded common
paths **before the author build**. There were zero tree version probes. This
does not assert present availability or absence after author work, nor absence
from every host location. Nothing was downloaded or installed for discovery
or sealing. Upstream documentation/dialect research remained with the authors.

## Artifact map and seal

| File | Provenance |
| --- | --- |
| `discover.mjs` | Original manual source probe, unchanged |
| `dispatch.json` | Byte-for-byte retained raw dispatch JSON |
| `context-before.txt` | Immediate pre-dispatch timestamp, HEAD, dirty/index context |
| `context-after.txt` | Immediate post-dispatch timestamp, HEAD, dirty/index context |
| `context-final-git.txt` | Original final-handoff git context |
| `context-final-hashes.json` | Original final-handoff hash comparison |
| `checkpoint-original.txt` | Original checkpoint, including original final update |
| `handoff-original.txt` | Original full handoff and API/contract constraints |
| `README.md` | Historical interpretation and later assignment qualification |
| `SHA256SUMS` | SHA256 and relative filename for every preceding file |

Raw retained files were copied as data, not regenerated. `SHA256SUMS` excludes
itself; the atomic Git commit binds the manifest, and the final receipt records
its digest and the exact committed file set. Original dispatch SHA256:
`678dae6ebd9e1fcd75c8a4dddff167e578b1a5d4af2ed3df868059ed557af810`.
Original probe SHA256:
`8f02c679bb2aad15576bef41f2b109983eaf328a88f0ea7c609060705867b4d9`.

Sealing checks are limited to owned-file copy/hash/mode integrity and optional
syntax validation. They add no dispatch, behavioral test or oracle result.
