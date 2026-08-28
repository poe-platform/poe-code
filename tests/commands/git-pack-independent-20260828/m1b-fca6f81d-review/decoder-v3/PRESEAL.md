# Explicit neutral decoder DATA preseal

Status: Preparation; product execution held until DATA passes and successor seal

The immutable predecessor is `be69c4d85f74ea2f3442f5fe03164dc60efdd8a8`:
one harness setup failure, zero product loads, 274 unfulfilled calls, 21 S01
unfulfilled, and 12 authentication-only matches. No result is rescored here.

Only `fixtures.mjs` changes: one explicit neutral-record decoder and one call
site. Frozen data, command arguments, expected outputs and all 274 case calls
remain unchanged. The field names `text` and `base64` are the declared roles;
there is no content sniffing, inherited/default encoding or permissive base64.
Six text and twelve binary neutral rows are independently bound to the original
stored fixture and their expected bytes/hex/SHA256 before decoder execution.

Run `check-data.mjs` once with the exact pinned Node22 executable and no injected
Node options/path. Limits: 240 seconds including output finalization, one DATA
process with zero children, 1 MiB capture and 8 MiB retained working files. It
imports only the admitted new pure fixture module and the admitted private
fixed-byte fixture module, using Node buffer/crypto/zlib; it never imports the
product, an actor, a compiler or a native Git oracle. Ordinary finite DATA
assertions aggregate; identity/capture/deadline failure closes this attempt.

The finite packet covers 30 decoder controls, 18 original neutral byte bindings,
two mutation denials, all 26 frozen pack/index byte bindings, all 160 control/
variant declarations across 104 semantic IDs, the three reused loaded-witness
declarations, five unchanged type templates, and one private fixed-byte fixture.
The 140-ID/274-call membership is checked as DATA, not 274 semantic passes.
Mapped source-only resource variants remain source-only; no H09/S02 claim.

The later executor receives no extra budget: the fixed review remains at most
120 minutes including cleanup, 168 all-nesting owned children, peak four,
256 MiB combined capture and 1 GiB logical working files, case30s/build120s.
DATA/preseal costs are recorded separately and included in the successor
accounting proposal before its single conditional activation.
