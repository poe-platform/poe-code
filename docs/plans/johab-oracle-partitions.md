# Partition exhaustive Johab split-pair checks

The full maintained test route reproduced a five-second timeout in the strict
split-pair matrix. Apply the existing EUC-JIS-2004 partition approach: 16
leading-byte blocks per error policy, retaining both finalization variants,
opaque state, every independent CPython checksum and all 131,072 records per
policy. Validate focused tests and lint, then the maintained full test route
before pushing and monitoring publication.

The focused run also reproduced timeouts in strict Unicode encoding planes.
Partition each plane into 16 blocks, retaining all 17 complete plane checksums
and the complete Unicode checksum against independent CPython output.
