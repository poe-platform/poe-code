# B2-r7 permission-compatible trace amendment

The r6 FSYNC failure at 43a1c3dc remains 0/672, one pre-supply trace,
not a product assertion result. No r6 artifact is changed or rescored.

Only the new loader's trace drops fsync. Each JSONL record uses checked complete
writes and an owned close; append reopens the same device/inode and expected size.
Zero, invalid or failed writes and failed closes prevent source return. A failed
writer cannot resume. Primary thrown values, including false/zero/undefined,
remain primary when close also fails. There is no crash/reboot durability claim.

`authenticated-source-prepared` is written BEFORE load returns its module source.
It proves authenticated prepared bytes, not evaluation. Exact mutant failure and
restoration results must accompany their matching source hashes. After known
parent exit AND close, every consumer trace is read as complete JSONL, hashed and
recorded; this is stable-after-retirement evidence, not a cryptographic writer seal.

The Permission Model, finite per-role read/write paths, allow-worker and loader
flags remain unchanged in kind. Only versioned stage/runtime paths differ. The
new trace helper is an explicit static loader/coordinator dependency.

Preparation admits eight synthetic trace controls and two sequential harmless
async-loader consumers. Their literal stdout proves fixture evaluation separately
from prepared-source traces. No product, compiler, install, guest or Regex runs.
Parent exit/close is observed; individual internal-loader exit and native helper
thread counts are not directly measured. Runtime r7 has no dates or authority yet.
