# S3 adapter-override safety followup — August 27, 2026

## Actual finding

The analogous S3 issue is **real for preconstruction base-prototype changes**,
not the already-rejected data-overriding subclass. Client-operation binding from
`3cf57d3` remained valid, but adapter enrollment captured `this.method` after the
base prototype had been changed. This blessed genuinely different Mock metadata
stores while both adapters' content methods addressed the same local Memory file.

The exact pre-fix run is `override-before.json`: **6/11 pass**. Two failures
demonstrate source damage; three are positive/external-comparison compatibility
checks. This run includes core `0bee8e7`, not an older core copy implementation.

| Preconstruction override | Comparison | Copy error | Actual effects | Source bytes |
| --- | --- | --- | --- | --- |
| Base `readFile` / `writeFile` | distinct | EIO | readFile, writeFile | `[68,65,77,65,71,69]` |
| Base private `streamRead` / `streamWrite` | distinct | EIO | writeStream | `[68,65,77,65,71,69]` |

The original source was `[0,255,17,128,10]`; the replacement spells DAMAGE. The
streamed case damages the source before consuming input. These are observed byte
losses, not merely surprising comparison answers. Subclass-before and late
instance/prototype data-override controls already returned unknown/ENOTSUP without
content effects and remain protected. Bound stream methods are own instance
properties; the late streamed variants replace those actual bound properties.

## Minimal source correction

- Retain original S3FileSystem prototype descriptors at module initialization,
  rather than trusting methods observed during construction.
- Recheck those original functions, including private stream helpers, alongside
  unchanged instance-bound streams and original transport/bucket/prefix bindings
  whenever the private provider descriptor is consumed.
- Do not require exact base-class membership. A transparent subclass using the
  original operations can still prove qualified identity and copy exact bytes.
- Do not register the base terminal callback over an explicit compareEntry
  override present during construction. Normal external-authority fallback and
  literal/conflict/error validation remain owned by the shared helper. The new
  tests require one external call, EINVAL for same and EIO for an invalid answer,
  with no data writes. This is not a new dynamic hot-swap comparison API.

Only `src/fs/s3/authority.ts` and `src/fs/s3/filesystem.ts` change product behavior.
`getOwnedS3Entry(view)` retains its existing private signature for the wrapper's
descriptor consumer, now with the original-adapter predicate. No contract, public
registry, root export, dependency, command, wrapper or other backend is edited.
Full client-operation binding and the original HEAD/local-GET/PUT adversary remain
intact. No original compatibility input/expectation is changed.

The first fix iteration briefly duplicated the constructor's local `prefix`
declaration; that loader error was corrected to `registeredPrefix` before final
behavioral validation and is not counted as a product regression or passing test.

## Final validation

`override-after.json` records exact commands, raw output, timestamps, tool versions,
before/after source hashes and selected full source snapshots. Both captures start
from HEAD `319299e7d24be17bed990242d605a4fc37d0d305` and explicitly verify ancestry
of `0bee8e7`. During the final run HEAD moved to
`781f272b33288d9ffcd898d5399996a646e3c3fd`, but **all recorded source/test hashes
stayed unchanged**. This is hashed worktree validation, including the current
Memory descriptor consumer, not a claim that bare initial HEAD contains this patch.

| Cohort | Result |
| --- | --- |
| Focused adapter safety/compatibility | 13/13 |
| Unchanged independent original S3 source-loss regression | 1/1 |
| Unchanged independent remote comparison S3 subset | 11/11 |
| All S3 backend tests | 221/221 |
| Independent rename policy, read-only | 86/86 |
| S3 conformance | 50 behavior + 2 provenance, all pass |
| Strict scoped source/backend types | exit 0 |

All test cohorts have zero skips, cancellations and TODOs. The focused13 are
included in backend221; the single original regression is included in the
independent11. Final13 comprises the original11 plus two actual Memory-to-S3
descriptor-consumer byte-preservation cases, buffered and streamed. It checks
local source/sentinel/namespace and provider bytes, zero redirected data effects,
metadata-only request traces, a qualified transparent-subclass positive, and
explicit external comparison semantics.

The independent file is not edited. Its before/after SHA256 is
`039cce5f0fc93b4e2e96a61448ac104e20aa5aaf767db4c33c53263598cb7660` for
`tests/fs/mount/identity-authority-review/implementation/remote-comparison.test.ts`.
Core `src/commands/filesystem.ts` is frozen in both snapshots at SHA256
`393ea36b78c2cc142633c0eb631bf4d316767b3992c0d5f0724135ca4f01403a`.
The unchanged original source-loss test is selected by
`--test-name-pattern=^S3 two custom clients`.

Historical `d25cb3f`, `d0948bb`, `3cf57d3` and all sealed earlier raw observations
remain unchanged. This followup does not rerun or close the original opaque-client
positive gate; qualification decisions and arbitrary-provider limits remain
explicit in `src/fs/s3/COMPARISON.md`. No full-repository build/test/typecheck runs.
Point-in-time proof still does not provide a lease, ABA defense or protection
against a hostile host changing routing after an observation.

## Replay

Use the selected source snapshots plus the recorded source patch and matching
dependency hashes; each captured command includes exact argv and raw output.
`node tests/fs/s3/authority-safety/validate.mjs new-label` writes only new evidence
via apply_patch and rejects reuse of an existing label. `SHA256SUMS` seals this
followup separately; do not overwrite the pre-fix byte-loss evidence with a green
rerun. The external wrapper-consumer handoff is updated separately in
`/tmp/safe-bash-s3-authority-handoff.txt`.
