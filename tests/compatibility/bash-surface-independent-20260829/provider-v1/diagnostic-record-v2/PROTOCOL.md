# Versioned matcher and acquisition protocol

Root fresh grant: one new acquisition; old e8f4c178 STOP is immutable. Only the same two diagnostic roots, same process-name/date/time filename inventory, <=100 names, <=4 headers/8192bytes each, and at most one exact matched record/2097152bytes. No native/engine/target launch, fence change, alternate logs or directories.

Selection is exact integer pid17408 AND structured crash309 captureTime with explicit UTC offset/Z in inclusive2026-08-29T05:04:24.416Z..05:08:24.461Z. The event field is captureTime, not IPS tracking timestamp. procLaunch, parent and image are observations, NOT expected-value admission constraints. Unknown/missing/ambiguous captureTime fails explicitly; no timestamp fallback. Image class NODE/SANDBOX_EXEC/OTHER_IMAGE/MISSING_IMAGE is exposed only after PID/window match. Missing final image identity returns STOP rather than a guessed image.

Every candidate publishes only predicate flags unless PID/window matches. Exact matched time/image/exception/termination and relevant loader/sandbox reasons/images may be selected; no environment/full-stack/raw report/header publication. A matching file is streamed-hashed with64KiB reads under2MiB before selected JSON fields are retained. Report content is parsed, never evaluated. Full file may physically fit within the header allowance; accounting distinguishes physical header bytes from the subsequent matched-record phase.

Sixteen finite DATA vectors are sealed in CONTROLS.json before evaluation. They cover the requested six categories, missing/ambiguous time, no image prediction, unrelated-value suppression, non-gating launch/parent, schema refusal and exact window/fraction boundaries. They are not native or acquisition passes.

Preopen owner selected-event capture before private metadata/read. Failures, limit/capture/integrity/ambiguity/unknown retirement STOP dependent admission. One attempt only; no retry/fallback. Close all report handles and administrative children. Fresh15min/28ALL-process/peak2/32MiB-capture/128MiB-work grant; source-bounded logical accounting, no RSS or kernel census claim.

Primary schema reference: https://developer.apple.com/documentation/xcode/interpreting-the-json-format-of-a-crash-report . Apple distinguishes captureTime (event) from tracking timestamp and procLaunch (launch); this reference does not establish any local record's identity or cause.
