# safe-bash-zip-engine

Portable shared helpers for Safe Bash. Uses injected filesystem and stream contracts without host filesystem access.

Caller filesystems without retained staging writers buffer archive output within
`maxArchiveBytes` before creating staging. Publication and cleanup receive the
original caller-owned receipt. Filesystems with retained writers keep streamed
staging.

For Python-compatible wheel layouts, readers accept an explicit
`allowUnreferencedData: true` profile. It permits gaps and unused local records
while retaining overlap, entry integrity and resource checks. Indexed readers
keep directory metadata in caller-provided backing storage. Strict contiguous
layout validation remains the default.
