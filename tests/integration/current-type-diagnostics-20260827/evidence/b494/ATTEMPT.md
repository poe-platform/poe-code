# Preserved initial harness stop

No compiler or test executed in this attempt. The original census split a Git
`ls-tree -rz` entry on every tab and truncated a tracked native-fixture filename
containing a literal tab. `lstatSync` consequently raised ENOENT for the truncated
`.../native-fixtures/controls/tab` path. This is an investigator harness defect,
not a candidate diagnostic or artifact mutation. START.json binds the original
runner hash, and CLEANUP.json records removal of its exact owned scratch.

The second attempt parses only the first metadata/path tab. It preserves the
entire filename, uses the same pinned revision and has a new evidence directory.
No input was renamed, excluded or followed through a symlink.
