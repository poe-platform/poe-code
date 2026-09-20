# Partition exhaustive HZ decode oracle checks

The full maintained test route reproduced a five-second timeout in the strict
mode-2 HZ decode matrix. The focused matrix passed, confirming that its large
single case was sensitive to runner contention.

Split each policy/mode matrix into 16 leading-byte blocks. Generate each block
checksum using CPython 3.14.7, and verify that every complete matrix retains the
existing independent checksum and all 65,536 records. Keep encoder checks and
runtime behavior unchanged. Validate focused tests and lint, then the full
maintained test route before pushing and monitoring the GitHub release.
