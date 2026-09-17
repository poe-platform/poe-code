# Partition exhaustive EUC-KR strict encoding checks

The full maintained test route reproduced a five-second timeout in strict
Unicode plane 9. Split each plane into 16 blocks of 4,096 points and retain
independent CPython 3.14.7 checksums for each block. Confirm that all 17 plane
checksums, the complete Unicode checksum, and all 1,114,112 records match the
existing oracle. Validate focused tests and lint, then the maintained full test
route before pushing and monitoring publication.
