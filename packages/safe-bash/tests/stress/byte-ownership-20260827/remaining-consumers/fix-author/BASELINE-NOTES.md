# Baseline fixture correction (before production edits)

The first author run (`baseline-canonical.tap`) recorded 18 tests: 11 passes,
7 failures. Six failures concern Buffer retention; one was an author fixture
defect, not a product regression: a 3/4-byte curl replay budget rejected argv
before upload. The canonical boundary fixture now uses 255/256 bytes with a
256-byte body so argv admission succeeds and the intended replay budget is
tested. The original fixture, original raw result and hashes are preserved.

The large ragged-body assertion still compares every byte with Buffer.equals;
it now reports the failed attempt rather than expanding 17 KB arrays into a
100,000-line TAP diagnostic. This changes diagnostics, not asserted bytes.

These corrections concern only the newly authored tests. They do not modify,
reclassify or migrate the historical wrong-abort fixture, packed21/24,
directcurl1/2, or any independent verifier fixture.
