# Release speed: retain verified artifacts

## Scope

Speed up guarded local lint and GitHub publication without dropping lint inputs,
test membership, native test lifecycles, or release gates. Keep the UTF-8 literal
extension in its own commit; do not start another issue before wrapping up.

## Observed costs

Release run 33911576686 restored the same-run verified build, then npm's prepack
hook rebuilt every workspace during publication. The publish step ran from
19:41:37 to 19:44:15 UTC on September 4, 2026; prepack started at 19:41:47.
The publisher's full checkout took 47 seconds. Local lint repeatedly decoded
the same freshly read directory listings while checking each path component.

## Changes

- Keep fresh directory reads and byte-exact comparisons on every guard call.
  Reuse decoded names only when every returned byte matches an owned snapshot.
  Bound retention to 32 directories, 1 MiB of name bytes, and 32,768 entries.
  Do not cache metadata, file contents, lint results, or boundary decisions.
- Load the installed manifest version through Node's module API so the verified
  CLI reads the version semantic-release assigns at publication time. Preserve
  Node 18 compatibility without JSON-import-attribute or publication-policy changes.
- Disable npm lifecycle scripts only for GitHub's final semantic-release step,
  after all gates and same-run digest verification. Normal local prepack still
  runs the full build; clean installs and installed-consumer scripts remain on.
- Use blob-filtered complete history for the publisher. Retain all commits/tags
  for semantic-release and leave historical Bash test checkouts unchanged.

## Verification

1. Red/green in-memory tests for fresh-read retention, mutations, malformed and
   duplicate names, ownership, eviction, and installed manifest version loading.
2. Run the maintained root build, full uncached tests (including lint stress),
   guarded root lint, workflow lint, package lint, and packed consumer smoke.
3. Measure guarded lint before/after, reporting load and sample limitations.
4. In an isolated installed package, change only the manifest version and verify
   the already-built CLI reflects it. Inspect a CLI screenshot.
5. Commit exact owned files, push main normally, monitor actual root/scoped npm
   publication, and compare publish-step timing and logs. A green skipped
   publisher is not a successful release.

## Measurements

An alternating six-pair in-memory comparison of the actual old/new guards used
1,024 sibling files and performed exactly 20,514 metadata operations per sample.
Median traversal fell from 411.44 ms to 295.70 ms (28.1%). This isolates repeated
directory decoding; it is not a whole-repository lint or CI speedup claim.

Full guarded lint passed the same 9,664 files with all 25 receipts intact in
365.33 seconds before and 280.58 seconds after (23.2% less wall time). Concurrent
activity on the shared host limits the precision of this single comparison.
Final-source lint and release measurements remain separate gates.

A normal root build passed. A clean temporary install of its packed CLI reflected
an isolated manifest change from 0.0.0-dev to 0.0.0-release-speed-check without
rebuilding. Its version/update display was inspected in a terminal screenshot.
All 17 package-publication lint rules passed, unchanged.
