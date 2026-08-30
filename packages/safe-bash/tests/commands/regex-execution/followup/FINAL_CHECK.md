# Final evidence staging note

The first staged `git diff --check` exited 2 solely for the trailing blank line
emitted by npm in `frozen-build.stdout.txt:4` and `global-types.stdout.txt:4`.
Those raw command outputs and their captured hashes remain unchanged. The
subsequent check is scoped to authored code, JSON and documentation, not raw
stdout/stderr evidence. No source or test expectation change followed the fix
freeze. This note is supplemental to the already-generated audit and is not
included in its earlier evidence-file hash list.

The audit verifies 40 original author files and 659 historical artifacts are
unchanged, plus exact preservation of the prior author-ready marker. Its
marker equality check applies before publication, not after the authorized
replacement. Scripts that claim evidence files exclusively must not be rerun
against existing labels.
