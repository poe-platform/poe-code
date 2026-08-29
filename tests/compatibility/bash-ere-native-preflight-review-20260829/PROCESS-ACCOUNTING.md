# Known process and resource accounting

Review started2026-08-29T09:38:51.594Z; grant expiry10:03:51.594Z.
Limits48 known starts/peak3,64MiB capture/256MiB working. No Bash/native entry,
Worker, product, engine, compiler, network or private route was admitted.

Known explicit process-role accounting from the bounded tool record:

| Phase | Known starts |
| --- | ---: |
| Initial metadata setup/selection and m01–m03 (preserved initial phase record) | 9 |
| m04 Node metadata owner + Git | 2 |
| Preparation patch tool + DATA preparation Node | 2 |
| Initial preseal shell/status/add/commit | 4 |
| DATA replay owner + two control children | 3 |
| Versioned fixture patch tool + DATA seal writer | 2 |
| Correction add/commit + exec-replaced DATA owner + child | 4 |
| Review commit-list Git | 1 |
| Report patch tool + publication DATA Node | 2 |
| This accounting/handoff patch tool | 1 |
| Final scoped add/commit + exec-replaced status shell | 3 |
| **Total explicit roles, including final publication** | **33** |

Exec replacement is not counted as another OS process. No concurrent helper
dispatches were used; known runtime owner+child peak2, within proposed peak3.
The three control-child PIDs3340/3342/5085 have explicit spawn/exit/close receipts,
null signals, no timeouts and no active descendants by recipe (Node child/Worker
permissions denied). Other metadata helpers/Git/edit/admin roles completed in
the tool record. Final administration is reported by the final scoped commit/status
tool result; it is not retrospectively represented as a child lifecycle receipt.
The existing persistent inspection kernel and unknown tool/platform transitives
are outside this enumerated fresh-start role census: **no universal OS census or
enforced OS quota claim**. This is not the future native40-start accounting.

Data captures are individually bounded (metadata Git12MiB, control streams2MiB,
source blob8MiB; actual files are much smaller). Metadata compressed envelopes
retain raw output; bounded source decode maximum4MiB. One112,989,184-byte Node
binary was hashed in1MiB chunks, never decoded or printed. Source/materialized
capsule is small and immutable; controls write only owned scratch and captures.
No RSS/global allocator counter or platform/transitive capture counter is claimed.
The finite source recipes and final entry/hash checks—not native containment—are
the basis for this bounded review. Temporary control scratch is removed; the
durable source/evidence capsule is intentionally retained for audit.

No observed safety, unknown retirement, deadline or cap failure. Two ordinary
captured helper/fixture errors remain preserved: m03 missing historical pathname
and I04 v1 wrong diagnostic regex. Neither is silently converted into a pass.
