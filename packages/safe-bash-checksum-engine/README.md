# safe-bash-checksum-engine

Shared portable implementation used by Safe Bash command workspaces. Import `sha256` from `safe-bash-checksum-engine/sha256` for incremental hashing without checksum command registration; `sha256.create()` provides `update`, `digest` and `destroy`.
