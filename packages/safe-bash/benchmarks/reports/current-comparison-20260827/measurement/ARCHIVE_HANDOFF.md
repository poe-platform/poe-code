# Raw-evidence preservation only

Status: **archive prepared and independently extracted/verified; stopped for reviewer/ROOT coordination; not committed**. No measurement rerun, product import, native oracle, source/package copy, additional score, or runtime/receipt/report-input change occurred. Scripts use Python standard-library modules only and spawn no children.

## Exact artifact

- Archive: `raw-attempt-001.tar.gz`, **25,956,442 bytes** (24.75 MiB), below the 40 MiB / 41,943,040-byte limit. No split is needed.
- Archive SHA-256: `9e2d3c24c709e7b5cd9ca6a7a8022e13f1e97c58ca235587562b5354cdf5932a`.
- Exactly **2,071 regular-file members**, **432,565,451 content bytes**, matching the immutable `RAW_MANIFEST.json` SHA-256 `5c15aa518743449029f975b3e133544ede2f9ff6df9ed734bb8f9a1d575f9ba1`. No directory, symlink, hardlink, traversal, or additional member is included.
- Uncompressed tar framing: 434,176,000 bytes; SHA-256 `7b1482b50d5f4b3e49469c1a0ab703722fa5f29de94c3cfb8a81b4f02c5f886f`.

`ARCHIVE_MANIFEST.json` records compressed identity, format/runtime versions, and every member path/size/hash. `ARCHIVE_VERIFICATION.json` independently records every archived-member and extracted-file SHA-256 against the original manifest, not against the packer's generated manifest. `ARCHIVE_SHA256SUMS` binds the nine new archive/script/evidence files other than itself.

## Deterministic creation and independent verification

`archive-raw.py` creates one USTAR+gzip archive in ASCII path order with regular-file mode 0600, uid/gid/mtime zero, empty owner/group names, no gzip filename, gzip mtime zero, and compression level 9. It opens only manifest-listed raw regular files without following symlinks, checks content hashes while packing, and checks file identity/size/timestamps for mutation. It records Python 3.14.7 / zlib 1.2.12. Byte determinism is scoped to this normalized format and recorded compression implementation; no second archive generation was performed.

`verify-archive.py` uses an independent gzip/manual-USTAR reader, without importing the packer or tarfile. It validates exact canonical headers, names/order, regular-file types, lengths, padding, and end-of-stream; exclusively creates fresh files; hashes every member during extraction; and independently reopens/hashes all extracted regular files. It reads neither the original raw files nor `ARCHIVE_MANIFEST.json`. All 2,071 archived and extracted members match the immutable original manifest. The compressed hash was checked again after verification.

Actual commands (already completed; do not rerun against existing exclusive outputs):

```sh
/opt/homebrew/bin/python3 benchmarks/reports/current-comparison-20260827/measurement/archive-raw.py
/opt/homebrew/bin/python3 benchmarks/reports/current-comparison-20260827/measurement/verify-archive.py
```

For a future isolated verification, the verifier needs only copies of itself, the archive, and the immutable `RAW_MANIFEST.json` together in a fresh reviewer-owned directory; it creates additive receipts there and a fresh extraction directory under `/private/tmp`. It does not need original tmp raw files or product packages.

The first verification stopped before extracting a file because its manual-header expectation incorrectly encoded unused regular-file device fields. Its failure and intent are retained in `ARCHIVE_VERIFY_FAILURE_01.md` and `ARCHIVE_VERIFY_INTENT.json`. The two-line verifier-only correction did not change or regenerate the archive. Corrected verification is recorded separately in `ARCHIVE_VERIFY_INTENT_02.json` and `ARCHIVE_VERIFICATION.json`.

## Preservation and cleanup

- Original raw directory remains unchanged: `/private/tmp/safe-bash-measurement-freeze-XAFOrN/measurement-attempt-001`.
- Successful independent extraction retained at `/private/tmp/safe-bash-measurement-archive-verify-5jedkiop`: exactly 2,071 files / 432,565,451 bytes. First failed-verifier directory `/private/tmp/safe-bash-measurement-archive-verify-3loaf30t` remains empty. Verifier PIDs 6805 and 6600 are gone; no children were spawned or signals sent.
- Every historical file in unchanged `EVIDENCE_SHA256SUMS` still verifies. Historical `HANDOFF.md` remains SHA-256 `15ecee05c6f0fd6d7233230b6a53bc33bc7992c23211b9a2319f0769dc6eb159`; neither it nor its creation-time qualifications was edited. Reviewer's additive qualification supersedes those historical qualifications; this preservation task introduces none.
- Archive suitability is limited to content-preservation verification and the requested size bound. Independent reviewer/ROOT decides acceptance and commit coordination. No commit or staging occurred.
