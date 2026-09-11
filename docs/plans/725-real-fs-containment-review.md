# #725: RealFileSystem containment and deployment review

## Scope and provenance

Reviewed September 11, 2026 against the current local source. Retrieved the live
body of issue #725, authored by `kamilio`, using:

```sh
gh issue view 725 --repo poe-platform/poe-code --json number,title,body,author,state,comments
```

The issue was open with no comments at retrieval. Its finding explicitly describes
a previously documented trust limitation, not a reproduced untrusted-script
escape. This review addresses only #725; it is not an audit of every open issue,
every filesystem operation, or any production deployment.

No production code, README, operating-system filesystem objects, Git state, or
issue state was changed. Test filesystem objects, hardlinks, and symlinks exist
only in `memfs`. Native filesystem calls made by the adapter are mocked.

## Result

**Confirmed trust limitation; no newly established vulnerability within the
documented supported deployment boundary.** A root containing a pre-existing
external inode alias can expose that inode through ordinary reads and writes.
Path checking followed by pathname-based open is not an atomic confinement
primitive when an external principal can replace ancestors between those steps.

The contract already identifies RealFileSystem as an adapter for trusted POSIX
hosts, not an OS isolation boundary:

- `packages/safe-fs/src/fs/real/index.ts:76`: class documentation and virtual-path
  interpretation.
- `packages/safe-fs/src/fs/real/index.ts:97`: explicit exclusion of pre-existing
  hardlinks, ancestor swaps, concurrent renames, and mount changes.
- `packages/safe-fs/README.md:284`: existing public safety boundary; no README edit
  is proposed here.

This does not establish that actual deployments enforce the prerequisites. The
maintainer/application owner must confirm their roots and surrounding host
environment comply before treating this review as a documentation-only closure.

## Source and untrusted-caller trace

1. `RealFileSystemOptions.root` is supplied by host JavaScript. The constructor
   requires an absolute root; `root()` canonicalizes and checks it. It neither
   creates an OS sandbox nor holds a descriptor-relative confinement authority.
   See `packages/safe-fs/src/fs/real/index.ts:17` and `:141`.
2. `walk()` resolves virtual components and checks symlink targets against that
   root. It returns a pathname; later native operations use the pathname.
   See `packages/safe-fs/src/fs/real/index.ts:175` and `:243`.
3. `readStream` and `writeStream` use `O_NOFOLLOW` on the final open. This is not an
   ancestor-locking operation and does not disallow regular files with multiple
   hardlinks. See `packages/safe-fs/src/fs/real/index.ts:727` and `:773`.
4. `Shell` requires an explicitly supplied `FileSystem`; it does not silently
   grant the guest an arbitrary host root. See
   `packages/safe-bash/src/shell/types.ts:45` and
   `packages/safe-bash/src/shell/shell.ts:106`.
5. The maintained `ln` command resolves operands in the virtual namespace and
   calls `context.fs.link`/`symlink`; RealFileSystem resolves both hardlink paths
   through its root. The command does not convert `/outside/file` into the host
   pathname `/outside/file`. See
   `packages/safe-bash/src/commands/filesystem.ts:381` and
   `packages/safe-fs/src/fs/real/index.ts:443` and `:463`.

No path was established by which an otherwise confined maintained shell script
creates an external hardlink or an externally targeted ancestor symlink from a
clean trusted root. The demonstrated prerequisites are supplied by the simulated
host, outside the adapter API. A custom adapter, command, or host extension with
additional authority must be assessed separately.

## Reproducible evidence

`packages/safe-fs/tests/real-containment-review.test.ts` has seven tests:

| Evidence | Observed result | What it establishes |
| --- | --- | --- |
| `memfs` creates an external-file hardlink under the root | Adapter reports the same inode and link count 2, reads its bytes, and a write changes the external alias | A pre-existing inode alias is not removed by path containment |
| An external absolute symlink already exists | Read/write reject `EACCES` before mocked native open | Normal pre-existing symlink containment checks remain effective |
| Hardlink source `/outside/file` or `../../outside/file` | Both reject `ENOENT`; native link is not called; external link count stays 1 | Guest path syntax does not directly name the external host file |
| Ordinary `/file` to `/alias` hardlink | Native mock receives only rooted operands | Supported internal hardlinks still work |
| A mocked host swaps an ancestor immediately before read open | The adapter reads the external modeled target despite supplying `O_NOFOLLOW` | Check/use separation permits the excluded interleaving |
| The same swap before write open | The external modeled target changes; the original subtree remains untouched | The exclusion applies to writes as well as reads |

The last two tests deliberately inject the host mutation after adapter path
resolution and before the mocked open. They are deterministic behavioral models,
not real-kernel race tests, mount-namespace tests, exploit chains, or proof about
every operation. No actual host hardlink, symlink, file, or concurrent host process
is used.

```sh
npx vitest run packages/safe-fs/tests/real-containment-review.test.ts --reporter=dot
```

Validation on the review date: all seven containment cases passed. Both new
review files passed together (21 tests); adding the existing
`retained-read-directory-real.test.ts` and `real-trailing-separator.test.ts`
produced 102 passing tests across four files. Scoped test typechecking, the
maintained safe-fs source typecheck, and ESLint with zero warnings also passed.

## Supported deployment requirements for maintainer approval

- Provision a root containing only content the application intends to expose.
  Do not populate it with pre-existing hardlinks to data outside that authority.
  Importing attacker-controlled host trees without controlling inode aliases is
  not a confinement guarantee.
- Trust principals capable of mutating the host root, its ancestors, or its
  mounts during use. Permissions and a rooted pathname alone do not turn hostile
  concurrent host mutation into a supported use case.
- When workloads or neighboring processes are hostile, establish an independent
  OS isolation boundary appropriate to the deployment and expose only intended
  data inside it. This review does not implement or certify such a boundary.
- A read-only wrapper limits calls through that wrapper; it neither makes the
  backing host tree immutable nor prevents disclosure through an existing alias.
- Do not relabel these tests as evidence of a race-proof sandbox or a fixed
  sandbox escape. A single link-count check would not solve ancestor/mount races
  and is not proposed as an isolation fix.

## Acceptance disposition

- **Supported boundary determined from current contracts:** trusted host/root;
  hostile external mutation and external inode aliases are outside the guarantee.
- **Behavior validated safely:** seven in-memory tests; no real-host reproduction.
- **Deployment confirmation:** maintainer/application-owner approval is required;
  no assertion is made that every deployed consumer satisfies the boundary.
- **Recommended disposition:** documentation/deployment-boundary resolution,
  not a vulnerability fix. Root may close once it approves and delivers the
  requirements. If hostile host mutation is a supported product requirement,
  keep that requirement open for a separately scoped OS-isolation design.
- **No product change requested:** no reachable defect within the declared
  boundary was established by this review.
