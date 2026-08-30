# Pre-commit data classification

The first pre-commit `git diff --cached --check` exited2 on `candidate.patch:8`.
That line is the single-space unified-diff context marker for an empty source
line. It is intentional raw diff data, not whitespace added to product/test
source. The exact patch SHA256 is a user-specified verification input.

The patch bytes were preserved. The subsequent lexical whitespace check applies
to every owned file except this explicitly classified raw patch. The patch is
still checked by its exact SHA256 and by the artifact seal; no test, source,
fixture, oracle, runtime assertion, or expected output is excluded or relaxed.
No product/typecheck rerun occurred, and the first attempt made no commit.
