# ZIP publication for immutable flat stores (#731)

Reproduce the unchanged shell command against a flat path store with implicit
directories, immutable byte objects, opaque identities and ABA-safe versions.
The store has no POSIX inode metadata, permissions, hardlinks or staging paths.

Add an optional conditional byte-source publication primitive to Safe FS and
opaque stat identity/version fields. ZIP must use actual host identities to
exclude aliases and observed versions to detect replacement races. Preserve the
existing staging path for hosts that expose it. Never infer atomic publication
from ordinary writes or replace destinations before a producer completes.

Validate creation/update, basename selection, binary preservation, retained
entries, aliases, competing writers, delete/recreate, producer/upload failure,
cancellation and bounds. Run the same portable acceptance in workerd against
installed public artifacts. Run maintained build, tests and lint for the shared
contract change; inspect a CLI screenshot. Deliver on main and verify GitHub
publication and registry versions before reporting completion.
