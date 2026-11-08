# Independent DU type-workflow evidence

Read [REPORT.md](REPORT.md) for the scoped verdict, exact denominators, reviewer
corrections, and the unchanged Node24 7/8 blocker. This directory owns only new
independent evidence; no author fixture or product file was edited.

## Verify the sealed receipts

```sh
node tests/integration/du-type-workflow-independent-20260827/seal.mjs verify
```

This authenticates the complete sealed file inventory, immutable Git inputs,
original fixtures, package binding, raw compressed command receipts and retained
results. It does not execute the product or inspect moving live product bytes.
`MANIFEST.json` covers every non-scratch regular file except itself; verification
rejects newly added files. Git authenticates the manifest itself.

## Fresh bounded replay

The existing local Node22/24 binaries, npm and development tools are prerequisites;
their exact executed hashes are in `receipts/authentication.json`. No installation
or source fallback is performed. The preserved package tarball can be reused even
after the original author's temporary archive is gone. New outputs must use a
unique directory name:

```sh
node tests/integration/du-type-workflow-independent-20260827/review.mjs prepare replay-unique
node tests/integration/du-type-workflow-independent-20260827/review.mjs run replay-unique
node tests/integration/du-type-workflow-independent-20260827/followup.mjs replay-unique
```

The original review supervisor deliberately remains the version actually run:
its recorded execution exits1 for the disclosed reviewer errors. The separate
follow-up corrects only permission spelling, synthetic reporter-option placement,
and inventory ordering. Do not treat that follow-up as rewriting the first run or
repairing/rescoring the author candidate. Scratch inputs live only in new owned
`.work-*` directories; remove those specific replay scratch directories afterward
to avoid making their temporary `.ts` files available to unrelated test discovery.

Raw process receipts are gzip-compressed JSON with unchanged stdout/stderr,
status, signal, argv and working directory. `fixtures/*.fixture` retains the exact
maintained consumer and both original template contents without adding `.ts` or
`.mts` inputs to canonical discovery. `followup/du-leaf.mjs.fixture` retains the
actual emitted runtime. Preparation attempts are historical reviewer evidence,
not additional product-test denominators.
