# Quota shell fixture expectations

CI Bash shard 3 reproduced three stale expectations after the quota wrapper began
preserving canonical descriptors. Descriptor errors render ENOSPC with its
standard utility message, and quota-backed memory filesystems now expose open.

Update exact dd/install diagnostics and the output fixture's descriptor capability
expectation. Preserve exact partial output bytes, file mode, quota error identity,
and cleanup assertions. Let the maintained CI shards verify the change; do not
restart the full local test route.
