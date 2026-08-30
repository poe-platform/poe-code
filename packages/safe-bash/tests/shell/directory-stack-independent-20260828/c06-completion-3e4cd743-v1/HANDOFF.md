# Additive C06 checkpoint — precisely partial

**Six new public subcontrol executions pass; no genuine candidate defect found.
Original C06 is still partial for the genuinely escaping-control/local-selection
portion. No main-review result is rescored, and no next-feature GO is implied.**

## Immutable authority

- Main review: `0fe2274a28f251370e9894cf30bb215f80b600d0`.
- Candidate: `3e4cd743f1d4d2302b6b58a337740b3fde68462a`; author evidence
  `92b60355eb21219375123bcb4664a03f7c634da9`.
- Accepted base: `3e3a2fe381e11540213285e14e2a9a55a72bdbdd`; selected candidate
  tree `099455f232870fa1ea59e1a0ae482e003fd170db`, unchanged two-file stack delta.
- Sealed package:846 files, SHA256
  `15aa8d8dd6e78a9b7d12156ea2adaf93bd5f0037f13443e8928268c9d5215a18`.
- All143 previously existing independent-review files remain byte/mode unchanged.
  Original111/138 plus28 separately corrected results per layout, S13 unsupported
  `/bin/sh` and its separate `/bin/bash` supplement, and all old failures/source
  roles remain immutable. No previous cohort or local-only C06 was rerun.

## New observations only

Preseal `33e356949925b43095c44ea1b6ca89411001baaa` honestly follows source/main
review and precedes these executions. Two matched schedules run once each in
isolated source, genuinely npm-installed full package, and physically moved
consumer layouts: **6 passes,0 assertion failures,0 runtime-blocked runs**.
Each actual public load measures207 product modules with runtime/shell/root
receipts; moved original consumer is absent. Source265 reconstruction and tools
are hash-pinned; no new build or type compilation occurs.

Both schedules execute real child `popd` from full `[/c,/a]`, pause at `stat(/a)`,
cancel locally with `false`, drain the cooperatively owned lookup, and observe
unchanged parent/sibling stack through public `context.invoke("dirs", ...)`.
The live outer handler then explicitly throws the caught `false`:

- **C06-M:** without root abort, exec returns status1 and exact diagnostic
  `shell: line 2: false\n`; the following same-exec observer sees status1 and
  unchanged `[/c,/a]`.
- **C06-R:** actual root abort also carries `false` during registered cleanup;
  exec rejects with that exact reason, waits for cleanup release, and never
  admits the following observer. The return-versus-rejection contrast—not reason
  identity alone—distinguishes root authority from the ordinary mapped rethrow.

## Remaining precise gap

The ordinary rethrow is not an actual escaping control failure. A deterministic
witness for escaping-control versus local selection still needs an authenticated
public pause after a genuine escaping outcome is captured but before selection.
`ACCESSIBILITY-v1.md` explains why the tested dispatch cleanup and public promise
settlement are not that hook; six exact committed spans in
`PROOF-ANCHORS-v1.json` bind capture, finish, mapping, registration, contract and
selection. This is a missing authenticated public schedule, **not proof that all
public witnesses are impossible**. The ordering remains a pinned source proof;
no private getter/model, fabricated limit error, lowered cap, arbitrary wrapper
provenance, or unpresealed instrumentation supplies a runtime pass.

## Custody and stop

Archive `7aa6510e33f7941cfdd0905f431b1ebc2ac8a3fd` preserves all27 raw/config
records and full scratch inventories. Raw observations precede assertions. Seven
precleanup static groups pass; two explicitly inventoried scratch directories
are removed only after archive verification. The final verifier adds an eighth
append-aware seal check:

`node tests/shell/directory-stack-independent-20260828/c06-completion-3e4cd743-v1/verify-v1.mjs EXACT_FINAL_COMMIT`

Full directory/file modes and membership are measured before/after these new
runs only. Registered cleanup and natural direct-child settlement are observed;
no independent descendant census is claimed. Native/service/guest executions,
production repairs and old cohort replays are zero. Stopped at this checkpoint.
