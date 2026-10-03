# Portable command I/O

Shared virtual-filesystem I/O, argument parsing, byte encoding, diagnostics, and stream helpers for Safe Bash command packages. Commands use the supplied filesystem and cancellation signal.

`PagedStorage` (from `safe-bash-io-engine/storage`) provides a bounded page cache
with retained read/write handles on the supplied filesystem. Spilled files are
created exclusively, detached before data is stored, and retired with their
handles. `IntegerTable` adds a bounded-cache index for sparse 64-bit keys.
