# Two additive timeout priority holdouts

Original freeze8843c519c23ad529677d51811f3acd370e53dffb and validation
0e83ced9ef58f95dc49e1ecbd5d18a7995d9f35f remain byte-unchanged:
32 families,70 numeric vectors,14 diagnostics,16 development helper controls.
These are **two separate prospective identity-collision holdouts**, not a rewrite
or rescore of those32 and not a new host-error policy.

## Coverage finding

Authenticated families.mjs SHA
6da3fb0790adeb25977e172ad0563577a39e3f7b7f0a61be3496d7c269a14548:

- F24 uses foreign/distinct and same-shaped reasons, not this invocation's exact
  observed deadline sentinel. F25 covers cross-invocation ownership isolation.
- F27 already requires caller priority, but its unique/falsy/string reason list
  does not explicitly reuse the same observed own-deadline object.
- F26 already requires retirement/cleanup precedence, but does not explicitly
  make the actual scheduler-retirement throw Object.is-identical to that object.

Thus both requested collision vectors are absent explicitly, while their
priority requirements are already accepted. PC01 and PC02 add only those vectors.
No timer budgets, parser behavior, diagnostics, factories or original assertions
change. The accepted Stage2 caller/escaping/cleanup provenance determines outcome;
reason equality alone cannot select124.

## Chronology and execution boundary

Sealed August28,2026 after root's author-resumption message and after the DU29
seven-case checkpoint. **No timeout implementation has been inspected or run by
this reviewer.** Whether author source already existed at sealing is unknown;
pre-source chronology is NOT claimed. This is post-author-release, pre-independent
implementation-inspection and pre-product-execution coverage. No timeout candidate
is invented or bound here; actual source timing must be disclosed at later binding.

PC01 observes the raw actual timeout-handler outcome as well as the actual Shell
caller/outer outcome. A Shell that rejects caller cancellation after incorrectly
receiving wrapper124 must not make this holdout pass.

PC02 requires an **activated actual scheduler-retirement throw**, not a synthetic
child rejection with the same value. Use only the declared scheduler and cleanup
seams. Callback delivery remains asynchronous and at most once, at most one live
handle; no extra live handle, private sentinel access or forced caller abort.
An expired callback might consume the only handle before retirement. If a chosen
schedule consequently never calls the throwing retirement method, record
UNACTIVATED/HOLD, not PASS and not a product failure. Bind a contract-conforming
concrete activation adapter before execution when the candidate arrives; if none
can be established, disclose that coverage limitation rather than inventing a
requirement that consumed handles must be cleared. A manually thrown child error
or manually calling scheduler.clearTimeout outside product retirement is not proof.

All latches/registered cleanup must settle before results; every rejection is
observed. Watchdogs remain failure-only, never timeout semantics. No new native
rows, preemption claim, source code, product execution or helper-control replay.

`seal.mjs` authenticates the original manifests and relevant committed design
references and seals these two data-only holdouts. Its execution is a freeze
integrity check, not a timeout test or proof of either priority behavior.
