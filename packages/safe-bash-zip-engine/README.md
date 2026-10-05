# safe-bash-zip-engine

Portable shared helpers for Safe Bash. Uses injected filesystem and stream contracts without host filesystem access.

Caller filesystems without retained staging writers buffer archive output within
`maxArchiveBytes` before creating staging. Publication and cleanup receive the
original caller-owned receipt. Filesystems with retained writers keep streamed
staging.
