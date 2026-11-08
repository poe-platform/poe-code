# Preparation attempt01 — no product or engine execution

The initial reviewer preparation compared live protected paths against the old
author baseline. It stopped on package.json before scratch creation or private
reads. Actual current live SHA256:
aaea215e419a64b08e4739dee1a6b7bba5f41f9d5e1c93d4d1771f939e904842;
historical candidate baseline:
691426f4934c471d2a76d49675f3fc19f3ddc47c8aa63cc38671d899a09c4535.
Raw failure is preparation-attempt-01.log. This is an incorrect reviewer input
binding, not a product/getopts/private-engine outcome.

Exact correction before any freeze or guest: protectedLive's historical
`assert.equal(hash(fs.readFileSync(path.join(repo, filename))), expected, filename)`
became `assert.equal(hash(git('show', candidate + ':' + filename)), expected, filename)`.
All243 immutable candidate records remain required. A separate current-live
243-path hash-inventory digest is captured and compared before/after; the two
runtime/shell live source paths still match candidate bytes. No live package is
overlaid, changed or used as product. This follows the committed-archive rule;
it does not weaken private/import guards. Attempt logs are preserved.

## Attempt02 — missing npm path, no guest execution

The pinned Node24 binary is present but its sibling npm installation is not.
The install command failed with MODULE_NOT_FOUND before any product load. The
corrected preparation uses the existing public Node22 npm-cli.js (the earlier
review's offline installer), still launched by pinned Node24. This changes only
the install tool locator, not the candidate tarball or runtime. Preparation now
also snapshots private state on its error path. The second attempt's full fresh
private before/after snapshots and enumerated partial scratch hashes are compressed
in preparation-attempt-02-closure.json.gz.base64; no private source bytes are there.
cleanup-preparation-02.mjs checked exact equality including eligible added paths
and removed only that authenticated owned scratch. No loader/product outcome is
claimed for either preparation failure. Attempt03 prepares the same two probes.
