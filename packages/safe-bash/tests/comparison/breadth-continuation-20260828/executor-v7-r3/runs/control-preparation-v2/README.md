# Preparation-only correction, before any worker execution

Original f7b9f0d4 production candidate and eight control families are unchanged.
Original DATA preparation failed at createStore without its mandatory budget:
SHARED_EVIDENCE_BUDGET_REQUIRED, zero worker/metadata/control execution. Eight
already-created harmless fixture trees remain untouched under ordering-stubs-01.

This version corrects only test preparation/driver store construction, adding
the existing explicit64MiB evidence budget. Relative imports/root resolution are
rebased for this evidence-path adapter, and fresh output ordering-stubs-v2-01
avoids overwriting partial preparation. No assertion/worker/guard/authority body,
package input, source-binding rule, timeout or capture limit changes. The same
latent missing-budget call in the still-unexecuted driver is fixed together.

amend.mjs documents the exact transformations. This adapter is separately sealed
and committed before harmless fixture preparation and any actual stub worker.
It does not issue authority, alter the production recipe or retry admission.
No other cycle follows the final handoff, per root's priority pivot.
