# Independent unchanged adjacent regression replay

This runner copies the original eight author-selected existing suites and five
helpers/data files from their explicitly committed original revisions, not the
author's rewritten fixtures or current checkout. Their13 byte bindings are
independently checked against Git before sealing. Product source is the frozen
265 input composition with accepted CD + candidate LET runtime only. No native
Bash or private SafeJS executes. RealFileSystem cases use their own temp dirs.

The test driver uses copied, prehashed tsx/esbuild and compiler tooling, no
installation or source symlink. Node22.22.2/hash, exact source file paths/hashes,
all test paths, actual command and raw TAP are recorded. Serial concurrency1;
180s outer bound; natural reaping and exact167/167/no skips required. These
source-test results do not substitute for separately guarded installed/moved
package acceptance or imply a whole-product gate.
