# Binding preparation HOLD: fixed window mismatch

August 29, 2026. SOURCE/DATA only; no native execution or approval request.

## Exact blocker

The accepted executable's `materialized/admission.mjs:31` requires both:

```text
deadlineEpochMs - issuedEpochMs === 2700000
now + 600000 <= deadlineEpochMs
```

The new instruction requests issuance now, latest start at issuance plus 20 minutes, and expiry at issuance plus 30 minutes. That is a 1,800,000-millisecond interval and does not satisfy the sealed 2,700,000-millisecond equality. This is an authenticated source-level contradiction, not a runtime refusal observation. No validator or other accepted owner member was modified, imported, or executed.

The interval cannot be repaired by resolving a JSON slot. A 30-minute GO would fail `GRANT_CONTENT`; silently issuing a 45-minute GO would exceed the requested interval. Backdating issuance, increasing the deadline, changing the validator, or reusing old authority is not authorized by this binding-only grant.

## Required ROOT decision

Choose one explicitly before binding resumes:

1. Keep the accepted executable unchanged and authorize a fresh 45-minute issuance-to-expiry interval. The validator's full-600-second latest start is issuance plus 35 minutes; an earlier administrative cutoff may be separately specified without claiming the validator enforces it.
2. Authorize a separately versioned 30-minute validator change, new executable seal, and different preexec review. That is a source change, not a slot substitution, and has not been performed here.

No UTC issuance or expiry was fabricated. No runtime receipt, GO, preprovision record, resolved command, or actual temporary root was created. The requested final-slot packet remains INCOMPLETE pending this decision.

## Authenticated evidence

- Accepted author source: `e10e371dc9c70583681add9c1747c85a710b1f59`.
- Executable preseal: `ade56f23358e284df533f7e57e462ba927fb0386899061e90699977746424b6e`.
- Readiness seal: `798c191fdad35bdf6c1592afda1954764da2209ad18984d966e5488c5e80bdd0`.
- Admitted validator SHA-256: `1a164fdf354fe0be4bf95d6df33814501ef88e694b411b85a7c881711f9921a8`.
- Seven selected source files were admitted against NUL-delimited stored commit membership and recomputed Git blob identity before text decoding; details are in `INSPECTED-SOURCE.json`. This is selected-file authentication, not a fresh full executable/tool closure.
- Independent review commit `987886897c2d013fcb31e1f2db0d073439d558db` was retrieved through scoped metadata. Receipt SHA `0460fca591217940e54b8a15e1c4eb19d50288b070f2714ea5ae2cde715c413c` remains the ROOT-supplied identity; its body was not admitted or converted into a runtime receipt during this stopped preparation.
- Only the installed pinned Node tool was freshly stream-hashed here. Full runtime tool/FD/provision admission remains unperformed, not inherited as current proof.

Raw startup and inspection captures were opened before fallible metadata/helper work. The inspection helper passed syntax qualification, exited 0, and its session closed. Terminal display truncation does not truncate the retained `raw/inspection.stdout`. Instruction reads were separate and were not placed in evidence captures. No current Bash version probe, Bash/native program, product, Worker, build, network operation, or harmless child fixture ran.

## Unchanged prospective scope

P19–P24 remain the exact six literals, with P19's `declare` first; zero expected outputs, input fixtures, effects, or external lookups. The proposed actual profile remains 600 seconds inclusive, 29 slots (7 managed plus 4 unobserved source-fork reservations plus 18 administrative), proposed peak 5, 64 KiB per stream, 32 MiB capture, and 128 MiB logical work. Case body 3 seconds, TERM 2 seconds and KILL 1 second are unchanged. Reservations are not observed starts or an OS quota. Initial tool-shell startup remains a trusted host boundary, not part of child clean-environment/raw-capture qualification. The independent preexec NUL-framing result is transcript-only qualification, not a native semantic observation.

All six native probes remain UNRUN. PIPESTATUS startup/type/readonly/local policy and older records remain untouched.

## Preparation accounting and handoff

The bounded administrative sequence uses at most 22 known process-image roles through publication and final commit: two instruction readers, six startup/metadata roles, five inspection/edit/syntax/tool roles, one retained-output reader, four publication-edit roles, one startup-birthtime metadata reader, and three scoped Git publication roles. Exec replacements may share a PID; these are conservatively charged roles, not a complete OS census. Peak is at most two known concurrent roles. All observed sessions before commit are closed; no background child, descriptor, or cleanup task is transferred. The grant ceiling is 22 known OS starts, 8 minutes inclusive, 32 MiB capture, and 128 MiB work; no deadline is reset. The final commit command checks the fixed startup-capture birthtime deadline `1788013266` epoch seconds (birthtime `1788012786` plus 480 seconds) before publication. No runtime clock was started.
