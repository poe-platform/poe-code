# Additive retry native freeze before source edits

`retry-freeze.json` records 18 targeted native rows, 18 transfer invocations and
one version query. All expected exit statuses were observed; some are deliberate
HTTP, quota or output failures. Product executions were zero and the network
digest stayed `46a75e15c8e63054dac33d79be354eaf9a12bb3be96390c5f610519a065cfdc3`.
`retry-pins.json` pins the artifact and every added capture/fixture source.

The first additive capture `retry-native.json` is retained as failed preparation:
its two observations exposed that the reused original `assertNative` incorrectly
assumed status zero always means empty stderr. Native `--fail` reports each
failed attempt even if a retry later succeeds. The new capture keeps raw stderr
and asserts only expected status and no signal during collection. Product
comparison must check native diagnostic codes/counts and HTTP status meaning,
not require native and virtual human-readable sentences to be identical.
No product source had been edited for either capture.

The added driver copies the original audited argv-safe native runner, changing
only the fixture catalog import and the versioned lab import. It retains clean
environment, proxy/config suppression, loopback-only HTTP, bounded processes and
bytes, per-row temporary directories under this owned subtree and final cleanup.
Original 60-row expectations and their frozen lab/runner remain unchanged.

These rows cover stdout and explicit `-o -`, `--fail`, `--fail-with-body`, included
headers (including fail), header dumps to stdout/file, body-file resets with
headers and fail modes, exhaustion, final write-out statistics, first-response
quota failure and missing output parent. Existing frozen GET/POST cases retain
exact accepted duplicate POST effects; no remote rollback is claimed.

Primary official references consulted August 26, 2026:
`https://curl.se/docs/manpage.html` (`--retry`, `--retry-all-errors`, fail modes),
and `https://raw.githubusercontent.com/curl/curl/curl-8_7_1/src/tool_operate.c`
(output-file truncate/seek before retry sleep). The live manual describes newer
options; installed `/usr/bin/curl` 8.7.1 is the byte oracle. This is not a new-flag
implementation or universal native curl compatibility claim.
