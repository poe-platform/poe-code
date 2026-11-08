# Prospective ROOT cache-policy acceptance

ROOT accepts a 128MiB reservation for the declared owned dev-npm cache, within
the unchanged512MiB logical work envelope. This is a best-effort trusted native-tool
boundary, not a proved npm preallocation upper bound, atomic snapshot, transient
peak bound or kernel quota. Controlled other writes remain bounded; observed
cache excess stops. Known post-close quiescence requires full strict reconciliation
before acceptance. Cache anchor, immutable paths and all non-ENOENT errors remain
strict. Dev npm is not a product command.

Only existing metadata changes: packet.mutableCachePolicy.rootDecision records
acceptance and the existing PENDING-AUTHORITY.mutableCacheAuthority receives the
already implemented validator string ROOT_ACCEPTS_BEST_EFFORT_MUTABLE_CACHE_R8.
No new schema keys, limits, runtime grant, timestamps or window are introduced.
ReviewCommit and all date slots stay null. Independent delta review and future
ROOT actual GO remain required. Original source/runtime failures are unrescored.

The prior packet and authority bytes are preserved alongside this record. The
eight-control/two-churn historical seal still binds its original packet, not the
new policy metadata. The runtime file hashes and all672 fixture inputs are unchanged.
