# Relative deadline construction v7

Preserve47924ab0: floating-recomposition HOLD, raw T01-M3/3, zero fully
verified/33 unfulfilled. No timeout/product-failure reinterpretation.

The sole semantic harness correction constructs each phase window once in
root-relative binary64 milliseconds. There is no integer quantization or
new rounding step. Valid relative coordinates lie within the existing
7200000ms root cap; malformed/negative/nonfinite/overflow inputs are rejected.
The exact started/deadline values are sent to the outer and retained through
END; no absolute-add/subtract recomposition feeds admission or final checks.
The existing root monotonic hrtime origin remains authoritative across
processes. The coordinator samples its existing aligned budget clock once
to obtain the start offset. An absolute conversion is used only for the
existing local supervisor timer/admit interface, never to reconstruct the
serialized deadline. Outer validation compares the identical relative
operands to30s/120s and the phase/root remaining cap, without tolerance.

Existing30s BODY,120s VERIFY,120min overall and360s final reserve remain.
Separate body/admin start/end/disposition capture and outer watchdogs remain.
No product timing/hard-preemption guarantee follows from this repair.

check-phases.mjs has38 finite DATA/SYNTHETIC controls:24 original logic
controls plus14 exact captured-excess/fractional-origin/clamp/zero/overflow/
malformed/late controls. Original24 receipts remain immutable; this is a new
versioned helper check, not candidate or actual-watchdog evidence. Bound60s,
one Node controller/no children,1MiB capture/8MiB work, exclusive0600 capture.
Capture precedes aggregate assertion; failure is not a pass and no retry.

After committed source/metadata, controls PASS and fresh stored-input/tool
authentication: one new33-call run,9 types +24 loaded including3S01 reversions;
no214 or27 qualified calls replay. Raw priorT01-M remains unqualified. Same
fca6f81d/282/full910cc0 candidate,168 starts/peak4/256MiB combined capture/
1GiB working/120min including cleanup. No product/native/private/network.
Unknown retirement/integrity/capture/safety stop; safe ordinary failures
aggregate. S02/H09 and native allocation/RSS limitations remain.
