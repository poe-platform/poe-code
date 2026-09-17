# Pandoc declarations in packed peer fixtures

The clean committed-revision verifier reproduced missing Pandoc declarations
after authenticated workspace manifests were staged. Its canonical peer binding
previously captured only the filesystem declaration closure.

Capture private Pandoc/PDF declaration outputs through the same bounded peer
artifact reader and hashing path, rejecting redirected declaration directories.
For packed artifacts, require identical declaration bytes in the artifact and
local tooling. Preserve committed source authentication and snapshot inventories.

The clean committed-revision verifier passed after the change. Validate ESLint
and the maintained repository test route before delivery.
