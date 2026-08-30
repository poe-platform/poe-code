# Bounded native guard checkpoint — 5a6caff

## Independent result

The direct `RealFileSystem.copyFile` guard is independently accepted for this
**12-case native subset only**, at the explicitly requested committed revision
`5a6caffcacaf07aee61ce6e219dbd015436d036e`. No cross-instance mount, nested wrapper,
shared-identity-contract, general filesystem, or product-wide acceptance follows.

| Isolated cohort | Pass / total | Fail | Exit |
| --- | --- | --- | --- |
| Pinned native source | 12 / 12 | 0 | 0 |
| Same-file guard removed | 9 / 12 | 3 | 1 |
| Exact native source restored | 12 / 12 | 0 | 0 |
| Pinned native scoped TypeScript `--noEmit` | no diagnostics | 0 | 0 |
| Guard-removed scoped TypeScript `--noEmit` | no diagnostics | 0 | 0 |

Each cohort ran once. There were no skips, TODOs, cancellations, timeouts, or
test expectation changes between cohorts. These are 12 distinct cases with
mutation/restoration reruns, not 36 distinct coverage claims. The author's tests
were inspected but were not imported or substituted for these independent tests.

The frozen capture ran on **August 26, 2026, 22:57:01.219–22:57:02.970 UTC**, using
Node 22.22.2, TypeScript 5.9.3, tsx 4.23.12 and Darwin arm64. The complete record
is `evidence/native-5a6caff.json`: commands, raw TAP strings, exit statuses,
original/mutant/restored observations, exact mutation patches, tool versions,
archive hash, and per-file Git blobs and SHA-256 hashes.

## Native proof and precedence

The independent tests call the real public `RealFileSystem.copyFile` directly.
Fixtures are real, privately created directories beneath an owned temporary
archive. The payload includes both NUL and `0xff`; snapshots retain exact base64
bytes and SHA-256, namespace entries, link text, device/inode/link counts, mode,
mtime, ctime and birthtime. Read-induced atime changes are deliberately excluded.

The three nonexclusive aliases are same pathname, hardlink, and symlink. Each
rejects with a typed `FsError`, `code: EINVAL`, `syscall: copyFile`, exact virtual
source `/source`, and destination `/source` or `/target`. Source and target bytes,
links, namespace and non-atime metadata remain identical. The nonexclusive
symlink resolves to `/source` before the target identity observation; the
hardlink remains `/target`. Both observations use bigint device/inode values.

Precedence checks establish:

- The three existing exclusive aliases reject `EEXIST`, not `EINVAL`.
- A missing source rejects `ENOENT` before inspecting an existing exclusive
  destination; the trace contains no target-path inspection.
- An exclusive dangling destination rejects `EEXIST` without reading its link
  target, rather than following it and returning `ENOENT`.
- An unrelated existing exclusive destination rejects `EEXIST` without effects.

Three positive controls perform a genuine overwrite, default creation, and
exclusive creation. Every control preserves source bytes/metadata and publishes
the complete source payload. The native trace shows source bigint `stat`
completion, target bigint `lstat` completion (or `ENOENT` for creation), then
exactly one native `copyFile` call and successful return. Overwrite uses flag 0;
both creation cases use `COPYFILE_EXCL` in this pinned implementation. This
observes the author's behavior without claiming a new race/overwrite policy.

## Destructive call ordering

Test-only instrumentation wraps the actual Node `fs/promises` functions and
uses `syncBuiltinESMExports` so the product's imported namespace sees the wrappers.
Every wrapper delegates to its original native function; originals are restored
in `finally`. The product method, its identity comparison and its error mapping
are not stubbed, replaced or bypassed.

Calls/returns/errors are recorded for native stat/path resolution and potentially
destructive methods, including native `copyFile`, writable/truncating `open`,
writes, truncate, rename, removal, link creation and metadata mutation. All nine
rejection cases assert **zero potentially destructive native calls**. In
particular, alias rejection precedes entry into native `copyFile`, not merely an
eventual native error or matching output bytes. Successful controls prove that
the trace really sees native copy entry/return rather than silently missing it.

This is **native API-boundary tracing**, not kernel syscall tracing. Native
`copyFile` can perform internal opens not individually exposed to these wrappers;
rejecting before entering it prevents those effects on the tested path. No
claim is made that metadata preflight is atomic against hostile path swaps.

## Guard-removal mutation: killed

Only this exact line was removed, using `apply_patch` in the owned archive:

```ts
if (target && origin.isFile() && origin.dev === target.dev && origin.ino === target.ino) throw new FsError("EINVAL");
```

The removal changes no imports, native flags, exclusive-precedence checks,
source/target stat calls, tests, or error expectations. The harness verifies the
whole changed file equals the original minus precisely that line. The mutant
still typechecks and all nine non-target controls pass.

Exactly the independent nonexclusive same-path, hardlink and symlink cases fail:
the calls unexpectedly **succeed** instead of rejecting `EINVAL`, and each trace
records native `copyFile` entry followed by successful return. On this Darwin
host, the native primitive leaves their bytes and namespace unchanged. This
mutation therefore proves missing rejection/preflight, **not mutant data loss**.
It must not be confused with the historical cross-mount stream truncations.

Restoring the exact guard restores the original source SHA-256 and all 12 cases
pass again. Final verification confirms every archived input is back to its
original hash. No live product file was edited for instrumentation or mutation.

## Source identity and preserved baseline

- Pinned native blob: `fb0a745ec82ea2d0013b613671eae26f8a48f63a`.
- Pinned/restored native SHA-256:
  `e66269d176522093f110a4bb90592dec38b9b80c277d2475fa20075f779d24cf`.
- Guard-removed native SHA-256:
  `358d80cbad5136e668b4d343faaa989bc968fe6f1640f416d2596cba07c4fa2e`.
- Pinned filesystem-contract SHA-256:
  `7c63db5052a28014ac185f86e6b97d2c3ef00ce61b80638baa850a6933f57457`.

All six preexisting files in this review subtree, including both historical
evidence files and the 19-case mount/wrapper tests, were hash-checked before and
after and remain unchanged. Their historical result remains **10/19 pass with
nine destructive alias failures**, alongside the original **1/4 pass with three
failures**, at the previously recorded pins. Those suites were **not rerun** by
this bounded native checkpoint and are not included in its 12-case denominator.
The mount identity seam remains pending with Curie; this native result does not
close that work. Captured live source/configuration hashes also remained equal
before and after the run. Owned temporary archives/fixtures were cleaned only by
their creating harnesses.

## Reproduce

From the repository root, freeze the same explicit pin and generate a new
evidence artifact without replacing any existing report:

```sh
node tests/fs/mount-identity-review/native-capture.mjs unique-native-label
```

The runner checks source/test hashes, runs fixed/mutant/restored native cohorts,
performs both scoped noEmit checks, adds evidence with `apply_patch`, and exits
zero only if the fixed/restored suites pass and exactly the three alias cases
kill the guard-removal mutant. It refuses to overwrite an existing evidence
label. All archive modifications remain beneath this owned subtree; no source
or contract ownership transfer is implied.
