# Native staging repair — August 27, 2026

Candidate remains `8670ebe8f0d39966c2de2638780437398e5f8490`. This is an external
gate-harness repair, not a candidate, product, oracle or test-expectation change.

## Preserved failed launch

Actual attempt v3 ran 14:33:02.435–14:33:27.928 UTC. Committed-archive admission
verified all24,879 entries; then native staging failed before any compiler or
suite phase. Both the prerequisite helper and mandatory publisher copied the
same pinned GNU tar1.35 executable. The first copy retained mode0555, so the
second copy failed EACCES. There is no product pass/fail score for this attempt.
Private Git/index and copied engine inputs remained unchanged; scratch was
removed. Final tracked-source verification was not reached on this early error;
the preserved receipt proves initial admission, not a post-failure census.

## Minimal repair and controls

Source `f6e07510` removes only the redundant early copy in `prerequisites.mjs`.
The existing authority/version check remains; unchanged mandatory `stageNative`
publishes and authenticates the native asset. No chmod of the external oracle,
global strict-live guard change, weakened hash check or missing-tool waiver.

The focused actual preparation regression passes9/9 author controls: sole
publisher, original0555 mode, exact staged bytes/mode, changed-origin refusal,
preserved target after refusal, lost-executable refusal, early-publisher mutant,
the actual old EACCES sequence, and all archived tracked bytes/modes unchanged.
Native49 authenticate. Private state and copied source stay unchanged; owned
scratch is removed. No product execution or compiler run occurs in this probe.

Its first preparation attempt failed before controls because its `/var` scratch
alias disagreed with Node's canonical `/private/var` module location. The probe
now canonicalizes its own scratch path, as the gate already did. Both attempts
are retained; the failed probe is not counted as a product failure or success.

Independent admission acceptance58130545 covers the preceding6699804a admission
implementation, not this subsequent one-line staging correction. The correction
has these author controls; no independent whole-run verdict is invented.

`CAPTURE.json` authenticates every uncompressed original. Each `.gz.b64` file is
base64-encoded gzip; decode, gunzip and compare the listed SHA256 and byte count.
Attempt v4 uses a new exclusive capture directory and the identical candidate;
its result is separate, never substituted for the preserved v3 failure.
