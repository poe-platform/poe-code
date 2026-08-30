# Build closure metadata preparation

Status: SOURCE/METADATA preparation only, 2026-08-29.
Authority: ROOT 25 minutes, <=48 ALL process starts, peak 3, <=64 MiB capture,
<=256 MiB working storage including publication. No build, compiler, configure,
make, generated program, Bash, observer or sandbox activation. No network fetch,
private project/config access, repeated source extraction or patching.

Inputs remain source handoff efcd8b49a63ceb4276ae9d075da59bfb027b3510 and final
inventory 75c692f66095ad85848915f50e9357e506ed9664415f48ce6104cafa7269368e.
The old source, patches, signatures and capture histories stay unchanged.

The self-contained controller establishes capture/startup before admission.
Allowed native operation: previously pinned trusted CLT llvm-otool with `-l`
over explicitly admitted installed executables/libraries, in serial batches.
At most 8 metadata children, 10 seconds each plus 1-second retirement bound,
4 MiB per stream / 32 MiB total. No inspected executable itself is launched.
Controller cap 10 minutes inside this grant, no renewal. All file hashes use
bounded streams; no executable bytes are decoded or retained as plaintext.

Public roots: /Library/Developer/CommandLineTools, /usr/bin, /usr/sbin, /bin,
/sbin, /usr/lib, /usr/share/man, /System/Library and explicitly resolved public
system-cache paths from previous admitted closure. No home/private scan.
The already pinned Node controller is the sole inherited user-path executable.
Owned review files and exact retained source inventory are read only as inputs.

Finite inventories:
- Explicit bootstrap/tool/fence/observer paths in inspect.mjs, <=80 files,
  <=350 MiB/file, streamed rather than copied. Missing paths remain absent.
- Executable loader metadata for those present tools, then at most 16 uniquely
  resolved non-system library files and 4 dependency rounds. System-cache image
  names remain distinct from materialized dylib identities/actual load proof.
- SDK: resolve the single installed MacOSX.sdk link; SDKSettings.json/plist and
  SystemVersion.plist <=1 MiB each. Never equate directory metadata with contents.
- List only the CLT clang resource-version directory (<=8 immediate entries).
  If exactly one version directory exists, seed its standard C builtin headers;
  multiple candidates are reported, not selected using a guessed compiler version.
- Explicit C/POSIX header seeds and literal include-edge expansion only within
  the SDK's usr/include and that selected clang include root: <=512 regular
  files / <=32 MiB aggregate / <=4 MiB each / <=2048 queued paths. Macro includes,
  conditional preprocessing and include_next selection are explicitly unproved.
- Exact SDK library-stub seeds and absolute .tbd dependencies found within them:
  <=128 regular files / <=16 MiB aggregate / <=2 MiB each. No complete SDK claim.
- Installed sandbox-exec/eslogger manual files, if bounded regular files:
  hash and source-line classifications only; no invocation or permission change.

Only literal dependency candidates from trusted metadata are resolved. Each
@rpath candidate is recorded with origin/order/existence; a uniquely present
file is a static candidate, not evidence that dyld actually loaded it. Unknown
roots/ambiguous candidates stop expansion and remain explicit unresolved edges.

Final output is an inactive, separately sealed build-profile proposal and finite
probe matrix. They cannot authorize activation, global permission changes,
observer privileges, provider-v1 changes, source mutation, or new executables.
