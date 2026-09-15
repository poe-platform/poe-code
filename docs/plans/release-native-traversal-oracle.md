# Release native traversal oracle portability

The maintained pre-release npm test run reproduced a Darwin failure in the 140-operation raw-path comparison: stat("/filelink/") returned a file from the native oracle, while the real filesystem returned ENOTDIR. The existing filesystem contract requires every trailing-slash boundary to resolve to a directory, including final symlinks.

The isolated existing regression failed before the change. Preserve that explicit directory requirement for the file-symlink fixture instead of inheriting Darwin's permissive stat behavior; all other native oracle comparisons remain unchanged. This changes test expectations only, without changing production filesystem behavior.

The complete traversal-regression.test.ts suite passes all 20 tests after the correction. Repeat the maintained virtual-bash workspace unit command, lint the changed test, and run the normal repository build before remote delivery. The earlier mixed-state full run is not a passing final gate.
