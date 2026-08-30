# Primary format research — 2026-08-28

This is technical source inspection, not execution of Git, a native version claim,
or acceptance of the M1A/M1B products. No Git implementation source is copied into
the proposed reader or fixture builder. Short factual rules are paraphrased.

| Source | Pinned location / inspected sections | Relevance |
| --- | --- | --- |
| Git gitformat-pack | https://git-scm.com/docs/gitformat-pack ; manual revision2.54.0; Checksums, pack layout, size/delta encoding, idxv2 | SHA1 versus CRC domains; packed header size is delta PROGRAM size; type inheritance and framing |
| Same official manual, tagged source | https://raw.githubusercontent.com/git/git/v2.54.0/Documentation/gitformat-pack.adoc | Stable tag reference for format review, not an installed Git version |
| Git packfile.c, v2.54.0 | https://raw.githubusercontent.com/git/git/v2.54.0/packfile.c ; load_idx, get_delta_base, unpack headers | Checked index layout; OFS recurrence; local REF base lookup; no need to copy mmap/LRU implementation |
| Git patch-delta.c, v2.54.0 | https://raw.githubusercontent.com/git/git/v2.54.0/patch-delta.c ; patch_delta | Copy parameter bits preserve byte positions; implicit65536; opcode0 and overrun rejection |
| Git pack-write.c, v2.54.0 | https://raw.githubusercontent.com/git/git/v2.54.0/pack-write.c ; need_large_offset, index writer | Index fanout/CRC/offset order. Writer can put an in-bounds small offset in large table under explicit options; do not reject all small indirect values as invalid format. |
| Git repository layout | https://git-scm.com/docs/gitrepository-layout ; objects/pack, objects/info, alternates, format extensions | Object store/auxiliary paths; independent complete pack enumeration permits proposed inert acceleration bypass, not routing bypass |
| Node22 zlib API | https://nodejs.org/download/release/v22.14.0/docs/api/zlib.html ; ZlibBase.bytesWritten, stream/close, convenience options | bytesWritten is documented as engine input count, not by itself a universal proof of full stream consumption. Actual Node22 packed-member trailing/abort tests required. |

The current M1A codec has author trailing-member tests, but that does not establish
the future packed-frame implementation's consumption correctness. Do not use
newer-node-only rejectGarbageAfterEnd or private _handle/_writeState APIs. Design
expects one closed zlib member per independently bounded entry span and verified
actual consumed count. The data checker below uses synchronous library inflation
only on tiny admitted fixture DATA; it is not a production streaming proof.

No primary source requires the project's eager-all-pack qualification, fixed
resource maxima, sidecar allowlist or no-eviction choice. Those are clearly marked
project decisions. Pack version3 is a format reader target, not an assertion that
the installed native Git generated it. Installed Git oracle/version execution:0.
