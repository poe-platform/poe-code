# Pre-execution manifest scope correction

The failed f4fc5084 audit remains exit 1 and is not rescored. It stopped before
any runtime import, materialization or synthetic control. The immutable evidence
seal lists 531 captured files and two root-level documents, not 533 files under
the evidence directory. All 533 hashes/modes had already authenticated from Git.

The corrected reviewer enumerates the entire committed runtime-v2 scope and
requires exactly the union of the 12 presealed source files, all 533 evidence
files (including HANDOFF.md and STATIC-CHECKS.json), and EVIDENCE-SEAL.json.
This strengthens the full membership comparison instead of ignoring the two
documents or allowing unlisted entries. The 20 control bodies and predicates
are unchanged. This correction is committed before their first execution.

No author/framework source is modified; no author outcome is inherited. This
new preparation attempt does not rerun or alter the accepted results-v2 audit.
