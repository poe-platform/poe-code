# Object-publication descriptors (#747)

## Reproduction

A canonical Memory-backed whole-file filesystem with `open` absent can read
`/input.txt` normally, but `PythonFileSystem.dispatch(open)` rejects ENOTSUP.
The focused reproduction is recorded in `/tmp/poe-747-current-red.log`.

## Supported integration

`withObjectFileDescriptors(filesystem, store, options)` borrows the existing
canonical namespace and an authoritative immutable-version store. The library
implements descriptor bookkeeping, positioned reads, bounded dirty pages,
seek positions, append/truncate behavior, conditional publication, cancellation
and lease retirement. Hosts supply acquisition and conditional publication,
not per-host Python emulation or a whole-workspace mirror.

The store acquires a pinned version with an opaque namespace revision and a
bounded range reader. Conditional publication consumes a bounded-chunk source
and atomically checks the expected namespace binding (or absence for creation),
enforces authorization and quotas, and returns a new pinned version. A content
hash alone is not an ABA-safe namespace revision. Capability booleans cannot
replace these backend operations.

## Semantics and limits

- Read handles retain their acquired immutable versions, not mutable POSIX inodes.
- Updates are descriptor-private until sync/close. Creation and open-truncation
  publish their empty generation before open returns. Concurrent writers conflict
  rather than silently overwriting or merging acknowledged publications.
- Append targets the descriptor's current private end; publication still compares
  its captured namespace revision. Truncate/regrowth must not reveal old tails.
- Payload bytes, dirty-page metadata, logical file size and open descriptors are
  bounded. There is no filesystem traversal or implicit staging directory.
- Cancellation prevents new publication admission, drains admitted body reads,
  and retires late receipts. It cannot undo an already committed remote update.
- The existing namespace adapter retains its own directory/symlink/rename and
  cleanup semantics. This descriptor adapter does not invent atomic tree removal.

## Qualification

- Five reusable public conformance cases cover pinned reads, exclusive-create
  races, competing updates, cancelled creation and descriptor flush.
- Focused unit tests cover a 16 MiB binary with 64 KiB range reads, bounded dirty
  metadata/payload, late cancelled receipts and publication-stream retirement.
- Independent review reproduced and fixed acquisition-signal retention, early
  capacity release, malformed mode coercion, readonly mount profile loss and
  conflicting quota reservations. Fault tests cover acquisition/write/sync/close,
  falsey cancellation, malformed receipts and changing complete object identities.
- Quota wrappers reserve private growth against both concurrent descriptors and
  ordinary namespace mutations; publication/retirement releases reservations.
- Real pinned Pyodide in fresh installed packages executes local scripts/imports,
  pathlib, binary reads, updates, truncate and append on immediate and delayed
  immutable-version stores. Incremental output uses Python flush plus os.fsync,
  because userspace flush alone does not publish a filesystem generation.
- Public API documentation is in safe-fs/src/contracts/object-publication.md.
  The real-runtime test uses Memory's authoritative conditional-write primitive,
  not an unqualified remote service or a flag-based conditional-write emulation.

Remote tree cleanup remains a separate #749 qualification. Host implementations
must supply authoritative primitives; this adapter does not add generic directory
descriptors, invent unlink authority, or silently implement non-atomic publication.

## Delivery

Run selected build/type/lint/regression routes and final installed-package
acceptance, commit the owned change, verify remote main, then verify scoped
publication. A local commit, push, and successful release remain distinct events.
