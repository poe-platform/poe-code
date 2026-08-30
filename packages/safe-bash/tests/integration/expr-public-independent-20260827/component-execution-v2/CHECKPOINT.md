# Interrupted reader repair: draft only

The three pre-existing draft files are sealed unchanged with exact SHA256s in
CHECKPOINT.json. This is reproducible preparation state, not a qualified reader
or an approved recipe. No controls, build, package test, type test, P01 or expr104
was launched in this checkpoint. Inspection found no execution output directory.
The prior session interruption is reported by root, not inferred as product failure.

Reproduce the checkpoint authentication with `shasum -a 256 .gitignore
control-producer.mjs stream-reader.mjs` from this directory; do not run the drafts.
Original freezes, prior abort evidence and the separate writer failure remain
unchanged. Resume requires root coordination after the authorized HTML review.
