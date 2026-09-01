# Directory-stack boundary fixture runtime

## Problem

The 4096-entry boundary regression spent 66.510 seconds running thousands of
setup commands, repeatedly parsing, copying, and rendering a growing stack.
Those commands did not add coverage beyond the separately tested ordinary
insertion behavior.

## Change

Use a one-shot test mock around the internal builtin dispatcher. Execute the
first insertion normally and assert its state, then seed 4095 empty entries.
Execute insertion 4096 normally through the public shell, assert its success,
read index 4096, and verify insertion 4097 fails before missing OLDPWD handling.
No production behavior, limit, concurrency setting, or timeout changes.

## Evidence

Measured on September 1, 2026 against worktree revision 6d193c117:

- Original focused case: 66.510s; 67.79s process wall time.
- Optimized focused case: 0.089s; 1.54s process wall time.
- Deliberately seeding 4094 instead of 4095 fails the boundary assertion.
- All 87 tests in the file pass; 2.56s process wall time.

The complete CI runtime and publication still require release verification.
