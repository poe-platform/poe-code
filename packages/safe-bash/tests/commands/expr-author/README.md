# expr author evidence

Author-owned code is in `../expr` and `../../../src/commands/expr`. Independent
holdouts are not read by the author and are not imported by the author corpus.

`capture.ts --capture` is explicit opt-in. It validates the GNU 9.7 binary/hash
and C.UTF-8 character prerequisite, reruns the controlled author corpus, and
writes a bounded summary plus detailed results into a unique OS temp directory.
Native timeout: 2 seconds per case; stdout/stderr cap: 16 KiB; controlled argv:
at most 128 arguments and 4 KiB aggregate. No external data drives native probes.
Canonical tests never write captured evidence. The capture reports the live
candidate's actual module hashes and owned Git status; it does not pin historical
source bytes as the current implementation.

Immutable candidate/evidence records, when present, identify a particular
coherent source/test checkpoint. Later implementation must get a NEW candidate
record; never rewrite an earlier marker. A nonregex checkpoint is explicitly
partial, with regex evaluation and standalone packed-consumer proof pending.

The native reference is the existing locally built GNU coreutils 9.7 expr on
Darwin. Native GNU/Linux and Apple expr are not qualified by this cohort.
`C.utf8` is not treated as the local oracle's C.UTF-8 alias: an author probe found
it falls back to byte behavior. The virtual scalar alias is documented separately.
