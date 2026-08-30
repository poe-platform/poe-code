# D03 versioned existing-record acquisition

## Result and binding

The ONE fresh acquisition matched historicalPID17408 and the authorized captureTime window. Sourcecommit4f1fe5b2af261815ae68aae9abd55d801fcb3574; preseal SHA256c9eecd88403171a13c6e36e234b971ad1a4bac7cbe588f69c91ccd661f2e15b5 (1397bytes). Sixteen frozen author DATA controls passed before access; they are not native/provider/product passes.

Exactly one candidate/header and one matched-record phase were admitted from the same approved roots. Record: node-2026-08-29-000637.ips,6779bytes, SHA256 **4c9a28200253d2364fa094f6331efd37bb7a4fc02df49ae1a81e32962910c69e**. The bounded header read physically covered the small6779-byte file; the subsequent matched-record read streamed the same6779bytes through SHA256. No raw header/record was copied or published. One report handle closed; none open. No second acquisition/fallback occurred.

## Selected actual fields

| Field | Exact selected value |
|---|---|
| Process / PID / parent | node /17408 /17404 |
| Process path | /Users/USER/*/node — record's privacy-placeholder path |
| Launch | 2026-08-29 00:06:24.4173 -0500 =05:06:24.4173Z |
| Event captureTime | 2026-08-29 00:06:24.8063 -0500 =05:06:24.8063Z |
| Exception | EXC_CRASH / SIGABRT; codes0x0000000000000000,0x0000000000000000 |
| Termination | namespace <0x23>, code2; no selected signal/indicator |
| Selected images | node UUID6437709f-5bc9-3b00-966c-45e1b63f12bb; dyld /usr/lib/dyld UUID9f682dcf-340c-3bfa-bcdd-dd702f30313e |
| Selected dyld/sandbox reasons | none retained by the whitelist; not a claim that every unselected field is empty |

The record identifies the terminating process image as **Node**, not sandbox-exec. It includes a dyld image entry. This is evidence of a Node-image launch, not evidence that Node's JavaScript/readiness code began, a full loaded-image census, a hash binding from the privacy-redacted image path to the pinned binary, or identification of the aborting instruction. The underlying abort cause remains **UNKNOWN**; no specific denied operation or permission change is established.

The record event timestamp is345.3ms after the prior owner's observed finish. Both values are retained, not normalized away; the event is inside the expressly authorized +/-120second window. Filename/tracking timing is not substituted for captureTime.

## Why the old selector rejected

On these newly acquired selected fields, the old expected-path predicate fails: the record reports /Users/USER/*/node, not the hardcoded pinned path. The old +/-1second and parent predicates happen to pass. This source/DATA evaluation explains the old refusal without reopening/rescoring old e8f4c178 or claiming the old acquisition succeeded. The unjustified +/-1second rule is removed regardless.

V2 admits exact integerPID17408 plus structured crash309 captureTime with explicit offset/Z inside the approved window. Image and parent are discovered, not predicted. Every candidate records pass/fail flags; exact values are published only for an exactPID/window match. Missing/ambiguous time, duplicate match, limits or incomplete image identity STOP without fallback.

## Interpretation and next decision

Apple's primary IPS documentation identifies captureTime as event/crash timing, procLaunch as launch timing, and metadata timestamp as tracking time; procPath can contain privacy placeholders: https://developer.apple.com/documentation/xcode/interpreting-the-json-format-of-a-crash-report .

The current Apple XNU primary source lists namespace35 (0x23) as OS_REASON_LIBIGNITION: https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/sys/reason.h . This is **upstream source context, not a running-build-qualified decoding**. No matching-build authoritative meaning of code2 was obtained. It is not a sandbox-denial diagnosis and does not authorize a fence change. No unrelated third-party interpretation is used.

Next useful step is a narrowly authorized source-only review of that namespace/code against the exact OS/build or the selected record's diagnostic field coverage. Do not widen permissions or rerun readiness from the namespace alone. Any additional private-record fields would require new explicit authorization; this acquisition is closed.

## Preservation and resources

Old F01/D01/D02/D03 launches/captures and v1 NO_EXACT_MATCH remain immutable. Native9/40 remain UNRUN. No target/Bash/engine/Worker/diagnostic-program launches, profile changes, unified logs or other private roots. Only whitelisted selected fields and record hash/size are published; no environment, full stack or raw record.

Fresh15min/28ALL-process/peak2/32MiB-capture/128MiB-work grant; registered direct administrative-child observations are not a kernel census or RSS guarantee. Selected events total2068bytes. Publication bindings record lifecycle/capture cutoffs and terminal receipts rather than self-including archive claims.
