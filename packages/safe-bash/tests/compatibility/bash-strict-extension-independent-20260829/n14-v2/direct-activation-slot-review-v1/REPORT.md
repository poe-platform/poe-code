# Resolved authorization slots — DATA-only ACCEPT

2026-08-29. **ACCEPT for resolved-slot consistency and observed freshness only.**
Fresh root actual activation is still required; no command was executed.

Author44e5530ef2dc5dd6a125f71a155a2e99885214ab, evidence
e1940416fcc1dde73f403bf161d93157e2d78f10. All34 sealed files remain identical
to seal6324119804436e77ee90c35676fe6d46d5c6a14b3a63c7528034faef3c062252.

Exact regular-file size/hash admissions matched:

- GO.json:1208 bytes, SHA256
  ed716d95fa4f4f3571b40d2f32174104d3be68ae05c480a8a3ae5cde3bc82d0e;
  live mode0600 and UID501, matching the inspecting process owner.
- INDEPENDENT-ACCEPTANCE.json:972 bytes, SHA256
  2d69073c07de80c7bd64419e7cf0b773167a22d30deae1b722fc64450ac002e3;
  byte-identical to the previously published independent receipt.
- COMMAND.resolved.txt:615 bytes, SHA256
  e03efbc1a97bf89c329ba909263cb9c08348b5b16c4c68f0821f7a82343b57e8.
- AUTHORIZATION-BINDING.json, read from the named committed object and compared
  with its live regular file: SHA256
  3b87b7388efd040752f709cbb1bf25ebfaf8ecd0e136fac71060829a8c92a25a.

Only the declared grant decision, review hash, notBefore and notAfter fields
changed relative to the template. The command is exactly its immutable template
with the sole grant-hash token replaced; no suffix, extra line, relative
executable or additional wrapper was admitted. All111 manifest role pins and
argv/environment digests match COMMAND-PLAN. Their digest domain is UTF-8
JSON.stringify with existing key/array order and no trailing newline.

The role graph remains `exec /usr/bin/env -i ... absolute-node absolute-outer`;
env replaces the launcher, outer imports supervisor in-process, and one child
runs at a time. Steady peak2 leaves at most one explicitly declared additional
control role under actual peak3. The unchanged144-known-role plan includes
administration; this review does not prove a transitive process census.
Packet/work parents are physical, nonsymlink, UID501 directories. Capture/home/
tmp/empty-path were empty at inspection. These are observations, not leases.

## Fixed UTC window

- Issued/notBefore: **2026-08-29T11:17:50.372Z**.
- Latest full30-minute start: **2026-08-29T11:37:50.372Z**.
- Expiry/notAfter: **2026-08-29T12:07:50.372Z**.
- Freshness check: **2026-08-29T11:22:05.585Z**, with2744787ms until expiry and
  944787ms until the latest full-duration start. Manifest cross-check completed
  at11:22:41.756Z. Publication receipt records a further current-time check.

There is no rolling extension. Root must activate before the latest-start
boundary with the exact checked grant hash; actual entry must still revalidate
all admissions and the full30-minute residual. After that boundary this receipt
cannot establish eligibility for the fixed window, even before expiry.

Scope is exactly37 identities ×3 layouts =111 planned calls, four fixtures,
bf079ada/293 source inputs/954 shipping members and the accepted archive/native
publication bindings. Curie's separate39-call campaign is explicitly excluded.
Initial trusted tool-shell startup and functional-direct qualification are
unchanged; no OS containment/group-absence/RSS/full-Bash claims are added.

No runtime/product/helper/Worker/compiler/install/native/network activation,
archive decoding or historical cleanup occurred. Metadata Git used direct-file
outer capture and explicit paths. M08 UNKNOWN, old F01 and prior noncompliant
review records remain unchanged. Only this owned review directory is published.
