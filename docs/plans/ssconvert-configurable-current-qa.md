# Current configurable text export QA

Preserve the existing implementation and edits. Reverify the official archive
SHA-256 under `out/ssconvert-lifecycle` against the requested pin before reading
source. Consult `src/stf-export.c`, `src/stf.c`, and the captured libgsf profile.

Run fresh original fixtures against the isolated `ssconvert-statistics-qa` native
oracle with the explicit captured environment. Compare the current SDK candidate
and virtual command separately for status, stderr, output bytes and destination
effects. Include defaults, empty strings, multiple UTF-8 quote characters, fixed
quoting triggers, option rejection, ordered duplicate sheets and range clipping.
Record new failures with failing in-memory regressions before repair.

Have an independent agent stress quoting, whitespace, sparse ranges, cancellation
and budgets. The root owns exports, virtual integration and Git; neither agent
edits READMEs or pushes/publishes.

Run the maintained ssconvert package test and lint scripts fresh, the explicitly
selected uncached safe-bash workspace build closure, safe-bash runner/typecheck,
and actual ssconvert virtual integration tests. Inspect manually captured CLI
screenshots from an explicit MemoryFileSystem host. Record all failed, incomplete,
unsupported and unavailable matrix cells separately from passes. Do not promote
historical reports to current results. Remove temporary logs and capture hosts
after summarizing their results; retain pre-existing evidence unchanged.
