# Mount identity remediation: contract-blocked checkpoint

This is **not fix acceptance**. The three committed cross-mount real alias
reproductions still truncate the source. They remain required failures, not
waived behavior. No shared-contract field, provider identity, or global inode
namespace has been fabricated. No S3/WebDAV, contracts, commands, shell, root
exports, or independent review source was edited by this leaf.

## Original evidence, kept separate

- `old-refresh/REPORT.md` is an exact byte copy of
  `/tmp/safe-bash-fs-3731587-refresh-kMXBVH/REPORT.md`, with that cohort's
  checkpoint and original source-hash/blob manifests alongside it.
- `old-final/REPORT.md` is an exact byte copy of
  `/tmp/safe-bash-fs-final-20260826T220433Z-f67gpP/REPORT.md`, with that
  cohort's HEAD and original source-hash/blob manifests alongside it.
- `original/copy-identity.test.ts.txt` is the unchanged committed reproduction
  from `d4f5e53`; SHA-256 is
  `e752e633abc902025670c09305c09e7319b171549350ddec7573b6644d29d115`.
  `original/reproduction.stdout` captures the pre-edit **1/4 pass, 3/4 fail**
  result. All three failures show the 15-byte sentinel replaced with zero bytes.
  The unrelated synthetic dev/ino collision control passes.
- `original/manifest.json` pins the initial HEAD, full filesystem/contracts
  source SHA-256 inventory, captured command/status, and hashes/provenance of
  every original report and reproduction copy. All copied artifact bytes were
  verified against their source hashes.
- `original/overlay-conformance.test.ts.txt` preserves the old committed
  overlay test verbatim (SHA-256
  `bb5514ac67f4b6d72477c07b402d5e5702e25c10042718e2635eb0064b55acc0`).
  Its same-path copy expectation previously allowed success. The live test now
  requires EINVAL, strengthening the requirement to match the explicit user
  instruction. No original reproduction expectation was changed.

The `original/pre-seam-*.stdout` files are retained intermediate development
observations, **not** the original frozen cohort or final validation. The
owned intermediate run also caught an accidentally matched rename guard;
that implementation mistake was corrected without changing rename tests.
These interim outputs must not be presented as passing or final source-pinned
results. The original report/hash files have not been rewritten to green.

## Concrete source progress

Commit `5a6caffcacaf07aee61ce6e219dbd015436d036e` contains only the native
same-file guard and seven native regressions. Native copy now uses exact bigint
device/inode comparison before calling native copyFile, rejects a regular-file
alias with EINVAL, preserves EEXIST for exclusive copies, and exclusively creates
an observed-missing destination. The complete native suite passed **83/83**;
its scoped noEmit check passed.

The pending wrapper changes reject identical resolved backend/local paths
before delegation, use exclusive creation for observed-missing cross-mount
targets, and reject overlay same-path copies before staging. They do not solve
cross-instance or hardlink identity without a truthful shared seam.

Added deterministic tests cover direct and reversed wrapper paths, readonly,
nested mounts, overlay upper/lower, readonly-over-overlay, overlapping native
roots, memory hardlinks, zero-read/zero-mutation traps, unknown identities,
exclusive creation races, and disjoint destinations that genuinely fail after
truncation. The failure controls explicitly preserve source bytes while allowing
the separate destination's documented partial-write effects. Buffering is not
claimed to protect an aliased source. The native metadata assertions compare
identity, size, mode, link count, and modification/change/birth times; host atime
is not a deterministic no-mutation oracle. Wrapper traps independently prove
that data reads and mutating backend calls have not happened on rejection.

## Latest source-pinned results: still RED

`pending-contract/manifest.json` records exact commands, entrypoints, Node
version, exit statuses, output hashes, and all filesystem/contracts source
hashes before and after the runs. Source hashes remained stable throughout.

| Gate | Result |
| --- | --- |
| Unchanged original committed reproduction | 1 pass, 3 fail / 4 |
| Complete owned memory/real/mount/readonly/overlay tests | 533 pass, 41 fail / 574 |
| Unchanged shared conformance | 202 pass / 202 |
| Strict scoped TypeScript `--noEmit` | exit 0 |
| Partial source-mutation probe | 2/2 mutations detected |

All test runs have zero cancellations, skips and TODOs. The 41 owned failures
are the original three plus 36 new mount identity guards and two new overlay
hardlink guards. Shared conformance success does not cover or erase them.

`tests/fs/mount/mutation-identity.probe.ts` changes isolated copies, never the
product tree. Removing the native same-file guard is detected by semantic
assertions; removing observed-missing exclusive creation is likewise detected
in both buffered and streaming races. The probe checks unchanged production
source hashes/content after cleanup. **No cross-instance guard-removal kill
is claimed:** that production guard still needs the contract seam.

## Required contract-owner action

The exact request and progress are in
`/tmp/safe-bash-mount-identity-contract-needed.txt`. The historical Curie agent
ID could not be contacted (`agent not found`). The inspected shared interface
has no identity seam; local realpath and unscoped dev/ino cannot distinguish
overlapping backend instances from unrelated synthetic collisions.

Proposed minimal signature, awaiting Curie approval/implementation:

```ts
readonly identityScope?: object | symbol;
```

This is proposed for FileStat, not a field already added by this leaf. Complete
identity requires scope plus safe-integer dev/ino. Equal triples identify the
same live entry; unequal scopes must guarantee disjoint storage universes,
not merely distinct adapter/client objects. Native instances need one shared
process-wide scope without leaking host roots; separate private memory stores
can have separate opaque scopes. Wrappers must preserve the selected backing
entry's scope. Arbitrary provider clients must negotiate a truthful shared
scope for overlapping storage, or omit identity as unknown.

Once approved, the remaining owned work is to publish native/memory scopes,
preserve the field in all three wrappers, reject known aliases before I/O or
publication, and reject existing cross-mount targets with unknown identity
before effects while retaining supported disjoint copies. Missing targets use
exclusive creation. The parent owns any S3/WebDAV participation. No new backend
feature breadth is needed.

Point-in-time identity does not provide a lease or atomic namespace validation.
Concurrent external replacement of an existing destination between inspection
and write, arbitrary providers' conditional-write guarantees, and native
ancestor/pathname races still require truthful limitations; stat metadata or
buffering alone cannot eliminate those races. No transactional copy, universal
provider behavior, full-shell completion, superiority, or 72-hour work claim
is made by this checkpoint.
