# R3 five-tool closure preparation (no execution admission)

2026-08-28. Scope: only the missing `cut`, `sort`, `tee`, `xargs`, `cat`
fixture roles. No product, old f5, historical manifest, shipping launcher, PATH,
native permission or expected-output change. Source repair43777899 and its
45 synthetic checks remain separate evidence, not new native successes.

`inspect.mjs` reads bounded explicit file bytes and Mach-O load commands using
the installed Apple SDK layout headers as the primary local format source.
It invokes no inspector or utility, loads no executable images, creates no
fixture directories, and emits metadata only. Limits:40 explicit reads,8MiB
per file,24MiB total,8 slices/128 commands each,256KiB emitted JSON. File
descriptors close in finally; source instructions/private files are not inputs.
It refuses changed binary identities and fixtures that differ from f5 blobs.
This is not a general Mach-O validator or complete runtime-image attestation.

The source invokes `/bin/bash -c` with bare helper names; it does not select
GNU coreutils or a utility version. The proposed profile keeps the installed
macOS system utility family. No `--version` ran, and no past successful PATH
resolution is inferred. Host26.4.1/build25E253 metadata plus exact file hashes
identify the proposed version, not a GNU/native semantic qualification.
The path, bytes and metadata are observed provenance; no code-signature,
installer receipt or cryptographic vendor-authenticity check is claimed.

All five parsed binaries reference `/usr/lib/dyld` (readable and hash-bound)
and `/usr/lib/libSystem.B.dylib` (ENOENT). **The five new tool/library pairs
need an explicit OS-metadata decision before admission.** Prior Node/Git/
inspector exceptions are not inherited by a different executable. No library
file hash, dynamic-image closure, new trust exception or admission pass is
asserted. Any unknown/new dependency or executable route stays a refusal.

Only a future independently reviewed successor may add five exact aliases to
its finite controlled route directory. No `/usr/bin`, `/bin`, Homebrew or
ambient PATH directory is added. xargs may invoke the separately bound `cat`
role for the frozen NUL-delimited filenames; no arbitrary child role is
approved. This recipe describes scope, not an implemented argv sandbox.
