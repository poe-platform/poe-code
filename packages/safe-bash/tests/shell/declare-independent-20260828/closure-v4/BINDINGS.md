# Closure-v4 source/data bindings

Date: 2026-08-28. Review target is exact Git bytes, not moving HEAD or a rebuilt
package. All checks use read-only Git plus ordinary Python standard-library
JSON/regex/SHA-256/file-byte operations; no subject module imports or execution.

## Author seal

- Commit: `f27ee6ea385e6fe6e2c975981fdd34f4755334cf`.
- Directory: `tests/shell/declare-design-20260828/ratified-v3/`.
- Manifest: 9831 bytes, SHA-256
  `7857ab7da95d9933e7065014a55cb7afb615a9757d9581a9840554c4c80f5187`.
- HASHES.json Git blob: `ddb865d73eff94035e895566448a1069e6c24c6a`.
- Normalization: **none** for payloads/manifest; exact bytes, not parsed-JSON
  reserialization or trimmed text. HASHES.json's nonrecursive Git binding is
  retained. All 11 listed payload byte lengths/SHA-256 values match; the exact
  12-file Git inventory has no unlisted payload, and all 12 live files match it.
- DESIGN SHA-256: `e51a0fdfff562aa70579fb2528f27beb05cc55e3f328ec8d1f42cb9bd32a9078`.
- MATRIX SHA-256: `480fadacce3dcfa812a61c462a04241239166e5e96577912bc73d4b513b3e064`.
- AUTHENTICATION SHA-256: `ad9bd4d2f328d4b071c882dd7263407789c4a0046744cbbb5ca7895cb6357fd9`.

## Authority and source

| Binding | Verified identity |
| --- | --- |
| ROOT RATIFIED.md | Commit `7719f39e416a401588c83d355888f6b82202c109`; SHA-256 `542b2a7013d343643cc703205cafe1cb9faba473e00730b81f2727d091a397bd` |
| P1–P4 DECISIONS.md | Commit `3d340bbdddcda6573abfcaae49d5c9268ee531b8`; SHA-256 `64cac3896982586d0748f4e2040d221d880aa45b16877d64e5ab70d53f07984a` |
| Frozen inspected source | `c0adae539c736db0e4023d401562ce958d9ebb00`; actual repository tree `d58b443e477e7b5127ea93dc30f8e8b84f16c783` |
| Source authentication | All 17 shell and five additional public-reference records in AUTHENTICATION.json checked against exact source-commit byte lengths, SHA-256 and Git blobs |
| Referenced evidence | All 13 authority/evidence records checked against their own exact commits/lengths/SHA-256/blobs; both historical author Git packets likewise verified |
| Successor overlay receipt | All seven overlays in `90811f46e54b771ee6d30002fd10cb1b5cdf7bc7` SUCCESSOR-SEAL.json match c0ada source SHA-256/blobs |

Composition `30f88590b66b88dc9694a56c85f1ee690f02218b` and the 862-file,
787736-byte package SHA-256
`e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3` are inherited
handoff/seal receipts only: no reconstruction, archive extraction, package rehash,
foundation acceptance or adoption of another owner's execution results.
The historical native binary/manual pins were not opened or requalified.

## Counts, not passes

Matrix IDs are exactly V01 through V64, in order, matching the manifest;
passes=null, REQUIRED_FUTURE_PROOF_NOT_EXECUTED. The four PREPARED_ONLY scripts
have null semantic expectations and these authenticated exact bytes:

| Script | Bytes | SHA-256 |
| --- | --- | --- |
| V301.txt | 200 | `783a903e5d0d57f9a31a7ab219341b05af6560c45b2e0e60fb3b0c2b46db5265` |
| V302.txt | 269 | `350ebd9910e594b19d899ee44b0c672a12ed49fdd5ce45055bfde8b6c1f0a475` |
| V303.txt | 309 | `07bbde15be520ec0e76723970f342a1d09c5bdd9a7863966099c43aafd29c4e3` |
| V304.txt | 266 | `3db920bdab7dad0c1e36e0d428c30da5e549d662803f502096a4592d8d32766c` |

Total1044; ordered concatenation V301 || V302 || V303 || V304, including each
final LF, no separators: SHA-256
`e1d25b8ca98c4b68256c47596668b872edabc3999687d1be5e4ba8bff787818f`.
Scripts were read as inert data, never launched. END/direct0 is transport only.
Historical M01–M40, eight original script sizes/hashes and total2455 bytes were
independently counted/authenticated, not rerun, widened or rescored.

## Preservation and timing

Criteria recorded at 15:34Z after the 15:30:22Z author commit, before author-body
inspection; this is not pre-author preregistration. Initial repo HEAD/status/index
are recorded in CRITERIA.md; unrelated working changes are outside review inputs.

All 33 preexisting files in the two declaration author/independent directories
match the author commit byte-for-byte (21 old protected files plus12 new author
packet files). Enumerating current files, excluding only this closure-v4 directory,
also checked for additions and missing entries. Sorted inventory SHA-256:
`f97ee61b3ecfb4320d6d4f15509e46a863ca56edcbb6bb7ae66d969a923d3df4`.
Inventory normalization is UTF-8 `path + NUL + decimal byte length + NUL +
lowercase content SHA256 + LF` per sorted repository-relative path. This checks
the two named trees at inspection/final verification, not transient mutations,
unrelated repository contents or a historical all-root census.

Validation is static authentication plus `git diff --check`; no tests/builds,
native/product/helper/private-engine/declaration/gate runs. Commit uses only
CRITERIA.md, REVIEW.md and BINDINGS.md in closure-v4, with hooks/signing disabled.
