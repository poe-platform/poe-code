# Additional-v2 native observations (not passes)

Protocol commit 3346e3dd320c63ba0429431a1658b92d145c9efb. Exactly 16 calls: 16 status 0,
0 status 1; no signal, cap, spawn error or residual child group. Original 28
remain immutable separate observations (23 status 0 / 5 status 1).

First spawn 2026-08-28T02:35:56.299Z; final child close 2026-08-28T02:35:56.548Z.
Host {"platform":"darwin","arch":"arm64","release":"25.4.0","node":"v22.22.2"}; child environment TZ=UTC, actual parent
America/Chicago local date August 27, UTC date August 28.

Checkpoint timing failure: attempted apply_patch omitted Begin Patch; shell
continued to native capture. The requested /tmp checkpoint was therefore written
AFTER calls, not before. Protocol commit preceded calls correctly. No rerun or
backdated checkpoint repairs this procedural miss. Preserve for root review.

Source/cache/binary and original evidence listed paths passed before/after hashes;
not an append-proof tree check. Archive xan.tar.gz separately authenticated
SHA256 fded89ddb5941a848a31e40c966c792754ea38dea6b2771fce02879ef197f6c0
immediately before execution; no replacement/build/download.

Raw retained scratch: /var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/xan-final-profile-v2-20260828-DDAHHp.
The once marker /tmp/xan-final-profile-v2-20260828.once prevents recapture.

| Row | stdout hex | status | stderr hex |
|---|---|---:|---|
| 01-start-zero | `610a310a320a` | 0 | `` |
| 02-equal | `610a310a320a` | 0 | `` |
| 03-end-zero | `610a300a310a320a` | 0 | `` |
| 04-tail-zero-stdin | `610a320a` | 0 | `` |
| 05-tail-zero-file | `610a` | 0 | `` |
| 06-cr-headers | `610a620a` | 0 | `` |
| 07-cr-count | `320a` | 0 | `` |
| 08-cr-select | `612c620a780d792c7a0a752c760d0a` | 0 | `` |
| 09-cr-slice | `612c620a22780d79222c7a0a752c760a` | 0 | `` |
| 10-embedded-headers | `6122620a630a` | 0 | `` |
| 11-embedded-count | `310a` | 0 | `` |
| 12-unterminated-slice | `612c620a312c22780a79220a` | 0 | `` |
| 13-bom-reorder | `efbbbf7a2c780a` | 0 | `` |
| 14-bom-only-headers | `3c737464696e3e0a` | 0 | `` |
| 15-cross-delimiter | `22782c79222c613b620a2c0a22750d0a76222c22712222222272220a` | 0 | `` |
| 16-postquote-select | `612c620a312c2278227a0a` | 0 | `` |

No new help/version. Native byte observations are not parser approval, product
acceptance, all-chunk qualification, Linux evidence or superiority evidence.
