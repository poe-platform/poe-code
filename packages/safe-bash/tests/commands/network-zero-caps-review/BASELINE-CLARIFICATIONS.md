# Baseline interpretation, before candidate review

The untouched frozen profile and original baseline receipt remain preserved.
The baseline ran 236 non-skipped checks: 234 passed; two failed because the
independent initial expected stdout for six retries assumed final-body-only.
Actual direct and Shell stdout contain all six initial/retried body chunks.
Source confirms retry truncation applies to named VFS output, not stdout.
This is a holdout oracle defect, not a candidate failure. Runtime expectations
now concatenate every reached non-redirect response body for positive retry
controls, including initial body before retry authorization denial. Zero and
CLI-zero expectations are unchanged. This is disclosed semantic correction,
not unchanged-all-input proof. The frozen profile is not edited.

The requested exit-7 transport fixture uses public CurlError(7, sentinel), whose
identity is preserved internally and whose exact message/exit remain externally
observable. A generic Error would map to 56, not 7; the original FROZEN.md
description saying “generic” was imprecise. We do not assert that completed
CommandResult exposes the original error object. Abort rejection identity is
checked directly on both public execution surfaces.

Independent fixtures intentionally consume an entire seven-byte binary upload
inside injected transport. Counts cover lazy VFS stream creation, chunk reads,
transport bytes, authorization provenance and response disposal. This measures
cooperative completed effects, not uncooperative transport preemption.
