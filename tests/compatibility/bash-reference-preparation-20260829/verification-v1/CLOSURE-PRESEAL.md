# Trusted metadata-tool dispatch

Use resolved Apple CLT `/Library/Developer/CommandLineTools/usr/bin/llvm-otool`,
138208bytes0755 SHA256
`61ff2c63cf68eeeadf9c4700dadb8271740ff4960f98500f30db82b31521c0de`.
ROOT explicitly authorized trusted loader/library metadata inspection. This is
not a code dump, compiler invocation or gpg/gpgv execution. Bind pre/post tool
and target bytes; the native tool reads Mach-O load metadata only.

Initial batch `-L` on exact pinned gpgv and gpg binaries. Up to two further `-L`
batches on newly declared absolute `/opt/homebrew/` dependencies only (max24
resolved regular files,256MiB/file and512MiB cumulative hash reads per pass).
Do not resolve arbitrary load names or private paths. Record system `/usr/lib/`
or `/System/Library/` dependencies as platform-cache identities, not fabricated
regular-file hashes; record unresolved relative/rpath names separately. Final
fourth and last optional batch `-l` on exact gpgv/gpg to record loader/rpath
commands. No guessed closure or permissive default. Tool/dependency metadata
success does not establish publisher signer authority.

Each child10s,256KiB per stream, strict owned group kill+close observation;
unknown close after1s stops. Output files exist before spawn. Fresh owned
HOME/TMPDIR/empty PATH, LC_ALL=C,LANG=C,TZ=UTC; no other env. Serial peak3.
No ambient options, xcrun delegation, shell, subprocess GPG or network.
SystemVersion and dyld bindings from preparation accompany qualified system
references; if that is insufficient for actual closure admission, report it.
Same ROOT25min/48starts budget; no renewal.
