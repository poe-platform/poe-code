# Partition exhaustive EUC-JISX0213 split-pair checks

The full maintained test route reproduced a five-second timeout in the strict
split-pair matrix. Reuse the maintained EUC-JIS-2004 partition approach for
EUC-JISX0213: 16 leading-byte blocks per error policy, preserving both
finalization variants, opaque state and all 131,072 records per policy.
Generate independent CPython 3.14.7 block checksums and confirm complete
checksums match the retained oracle. Validate focused tests and lint, then
finish the full maintained test route before pushing and monitoring release.
