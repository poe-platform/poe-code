# r8 prospective accounting policy — ROOT decision still required

The 0b13a5b8 cohort remains 224 PASS /448 UNRUN, two completed type roles/eight
diagnostics, then administrative npm SIGTERM after cache ENOENT. No rescore.

Only ENOENT from lstat/readdir of previously enumerated descendants of the exact
owned runtime/cache directory is recorded as SNAPSHOT_RACE, and only while the
installer is active. Missing cache anchor, immutable package/source/fixtures,
other errors and falsy reasons still fail. The anchor is checked before admission.
Rows remain non-atomic samples, never a filesystem quota or transient-peak proof.

PROPOSAL: debit a fixed 128MiB reservation from the existing 512MiB aggregate
logical envelope before installer admission. Charge this whole reservation, not
zero or sampled cache bytes, throughout active cache writing. Any observed cache
above it fails. Recorded snapshot race counts remain explicit. Only after known
child exit+close and owned-descriptor retirement does strict full reconciliation
run, with no ENOENT exception. Release reservation only on successful reconciliation;
failed/unknown settlement retains the reservation and prevents dependent work.

**No source-derived upper bound for all npm cache/log/temp writes has been proved.**
128MiB is a proposed accounting reservation, NOT proof that npm cannot transiently
exceed it between observations; no hard preallocation, OS/RSS quota or peak claim.
ROOT must accept this best-effort trusted native-tool boundary or require a stronger
mechanism before actual execution. New grant field `mutableCacheAuthority` must
equal `ROOT_ACCEPTS_BEST_EFFORT_MUTABLE_CACHE_R8`; pending template leaves it null.
This proposed explicit guard is not an assertion that ROOT already accepted it.

All regular role caps remain unchanged:64 known OS/peak3,41 children,34 functional
loader admissions,1800 anchored seconds including180 publication,96MiB capture,
512MiB work. No new grant/window or runtime authority exists.

Publication dedup is separate: an existing owned destination is accepted only
when a persisted source-path/device/inode/size/hash receipt matches and destination
bytes/hash/size match. Record verified-existing-copy; never overwrite or ignore
conflicting data/receipt. Partial first-publication failures remain failures.

Presealed checks: eight bounded control groups and two fixed harmless Node
create/delete churn fixtures. Churn is not npm or product execution and does not
establish an npm cache bound. Live races may or may not occur; deterministic
synthetic ENOENT controls establish the exception scope. Owner integration and
full 672 successor remain SOURCE-only until separate actual authorization.
