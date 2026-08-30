# Root-approved duplicate-only removal — 2026-08-28

Root explicitly authorizes removal ONLY of116,980,358 manifest-listed duplicate
raw-record bytes, after fresh lossless verification of all437 content/hash/mode/
path bindings and regular-file/no-link census. No recursive cleanup, no other
staging/foreign/unknown files, no product execution. This is authorization for
these individual unlinks, not for the future candidate continuation.

Preparation authenticated the committed archive/index, all437 exact raw files,
the seven-member root directory and six unchanged non-record censuses. Every
target is regular, link count1; exact device/inode/mode/hash/bytes/path are sealed
in DELETE-MANIFEST.json SHA256
`97f0b183d1b2cdc9caa7b54e0f4d8d9306c937c765badf67dc5d64b8987eca58`.
The records directory itself remains. No file was removed during preparation.

The one cleanup execution repeats all verification before unlinks and rechecks
each target immediately before its individual unlink. It journals before/after
each operation with fsync, stops on any uncertainty, and verifies archive/index
and all six other censuses afterward. No retry/force operation.120-second finite
DATA deadline; no candidate/native/private/YQ/XAN execution. The user explicitly
requested these deletions, so no additional destructive-operation approval is
required under the active tool policy.

Approved operation (not an array candidate dispatch):

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/continuation-v1/cleanup-v1/cleanup.mjs remove-approved-duplicates 97f0b183d1b2cdc9caa7b54e0f4d8d9306c937c765badf67dc5d64b8987eca58
```
