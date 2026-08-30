# Source-only stored-identity correction

The original product metadata batch stopped at a request that incorrectly used
derived composition c83f352f057c64917f219eb938f54aa42cdab829 as a stored Git object.
Its exit128/stderr, two successfully captured Unit2 blobs, and the subsequent
SOURCE-05 refused arithmetic lookup remain unchanged. No product executed and
no product outcome follows from either preparation failure.

The frozen design BINDING.json supplies arithmetic.ts's actual stored authority:
revision 67eab12e315054907ef4ef435c6bbca2f59e0c36, blob
223101946d13ac9b44f4a898f58fd16004ba86b9, 9922 bytes, SHA256
5e2d784b8fd333972e6e413f4c3478163462a3c1abf8cc5ff7173963420440bd.
Read that exact blob with `git cat-file blob`, then check size, SHA256 and Git
blob identity. No HEAD/default lookup and no retry of the derived-object request.
No author handoff was fetched after the original batch stopped; do not claim it.

SOURCE-05 had already read runtime.ts twice before its missing-authority guard:
charge those 395210 bytes separately, despite its lack of a successful result
record. The later budget summary must also charge this corrected 9922-byte source
read. These are preparation/source-read charges, not semantic executions.
