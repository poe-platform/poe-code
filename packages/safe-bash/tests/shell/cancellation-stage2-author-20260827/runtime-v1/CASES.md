# Stage 2 runtime author matrix

Status: author intent frozen before the five-file product edit on 2026-08-28.
This is focused author coverage, not Poincare acceptance or a whole gate.

| Author case | Contract seam | Required observation |
| --- | --- | --- |
| A01 | Public/internal option shape | `readonly signal?: AbortSignal \| undefined`; explicit undefined is valid; null, controllers, primitives and mutation fail typing. |
| A02 | Borrowed admission | Omitted, undefined, `{}` and `{ signal: undefined }` retain the parent command signal, add no cancellation controller/listener, and do not close the parent. |
| A03 | Pre-resource admission | Ancestor pre-abort skips the getter; getter is read once; invalid signal and pre-aborted local reject before child scope or handler work. |
| A04 | Owned cleanup barrier | A delivered local reason replaces numeric success only after registered cleanup drains; listeners detach before settlement. |
| A05 | Ranked lineage and isolation | First delivered reason is immutable; root then outer invoke rank settlement; a child never aborts its parent or sibling. |
| A06 | Mapped handler boundary | A caught/rethrown inner cancellation maps to outer status 1 while the live public wrapper returns 0; the authenticated report is discarded. |
| A07 | Conservative provenance | An unrelated escaping rejection equal to an earlier child reason remains unrelated unless the exact recorded promise route proves origin. |
| A08 | Control and forwarding paths | Original pipeline-stage, nested dispatch, direct handler, shebang and `/usr/bin/env` paths retain lineage without a new shell or budget reset. |
| A09 | Root settlement | Caller beats escaping execution, which beats accumulated cleanup failures, which beat numeric results; falsy members stay exact. |
| A10 | Closure | Invoke and public settlement occur after child cleanup and boundary detach; dispose awaits the same root finalization promise. |

Fixed product input is `12e196af8d8b0866339747150b02ca00b9764a09` plus the
accepted helper blob `a0e68c7bfb2d541964194d38ef30a4a590bec1de`. The helper,
independent fixture family and R08 overlay remain read-only.
