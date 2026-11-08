# Current scope addendum — August 27, 2026

**NO-PROMOTION.** Reviewer/thread: Codex Independent Leaf Verifier,
`01a043dd-cfc3-7f93-8f3b-70e2d7b1d2a4`. This document records authoritative
ROOT coordination context, not new independent verification or test results.

ROOT reports that the live curl zero-host-cap enhancement was separately and
independently accepted at `bb7f5972` / `32debb6a`: only maxRedirects/maxRetries
now permit zero as a safe-integer value; defaults remain10/5. Accordingly, the
live API/design issue is resolved separately. Historical “remains unresolved”
wording in my replay handoff must **not** be read as asserting that the current
live API issue remains unresolved. I have not inspected or independently
reverified that live change for this addendum.

Actual replay evidence `9f44add1e59ea65af85ece4d2b4eac9af5d02df8`, its reports,
seals, signatures and raw captures remain unchanged. Its S1 source213 manifest
is still `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`:
the old validator and the authorized host-cap0→1 alternate scenario, not the
separately accepted live validator. This replay makes no zero-host-cap support
claim for S1. No overlay or rescore occurred. An S1 plus zero-cap-only overlay
would require future explicit ROOT authorization and has not occurred.

ROOT also reports the separately independently reviewed env8 canonical migration
`5ba1a0f3` / `ec4e264d`, with original evidence preserved. That handoff is not
duplicated here, contributes no results to my replay, and implies no Linux-kernel
claim. No source/private/product inspection, probe, replay or test rerun was
performed for this documentation-only clarification; no promotion is authorized.
