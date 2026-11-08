# Immutable four-red classification evidence

Captured source pin: `3731587fa287333ca59c7a81569b367cec66f61d`.
This directory preserves the 2026-08-26 read-only classification artifacts
byte-for-byte; it does not revise source, expectations or original results.

- `REPORT.md` is the original classification report, including its historical
  no-repository-edits statement. This later evidence-only publication is separate.
- `original-refresh-REPORT.md` and `original-adapter-stress.*` preserve the
  original aggregate report and raw adapter run (66/70, four failures).
- `original-four.*` preserves the exact unchanged four-case replay (0/4).
- `observe.mjs` and `observations.*` preserve 13 behavioral observations,
  not replacement acceptance tests or approval of advisory security modes.
- `manifest-*.json` records the classification's 31 selected inputs;
  `original-refresh-source-manifest-*.json` preserves the original audit's
  complete 225-file scoped source/test manifests, including all 117 source files.
- `original-manifest-*.json` hashes 209 original audit artifacts;
  `original-refresh-tree-ids.json` records the frozen Git trees.
- `SHA256SUMS` is the unchanged original delivery checksum list;
  `PUBLICATION_SHA256SUMS` additionally covers every published artifact except itself.

The 36,669,440-byte frozen tar and copied dependencies are not vendored here.
Its SHA-256 is
`77b5fca312b6fb0ebd72a3177533f21f8414f089d264278ca3d5458cd7119ec1`.
The committed source pin, exact path/blob/content manifests, original tool versions
and commands are retained. Original absolute /tmp paths and timing are evidence,
not portable installation instructions. Do not run the historical `run.mjs`
unmodified: it intentionally names the original locations. Any future portable
runner or candidate rerun belongs in a new, separately hashed directory.

Publication authorizes no test rebaseline, no permission-mode reinterpretation,
no contract change and no backend feature. Mount aliases are **not** declared
solved: native same-file guard `5a6caff` is committed; cross-instance identity
contract work remains pending per the parent instruction.
