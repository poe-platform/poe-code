# L04 diagnostic v11 — separate failure observation

Source/preseal: 702c0a448fcaaabad51294f407e9920c8d577925. Conditional grant: fe7417e6cbca777f0b94ed977a1cb0c0eb91745f. PRESEAL SHA256 d486559c00983d116363bb38b86cffec5e4787568f6186390b811ea36131d64e. ROOT grant SHA256 1ab24ae19f79cc52bafd278a922c489fc38badf429e9523af3ae522ca5bc2d03. New helper hash 1dcb8319e5d216d2f2bbf1793f4ccacfa51c18149b3dee074b9c77900fed339a → node:util is Worker-only, importer-exact.

## Actual outcome
One Worker, one public run attempt, one guestFailure terminal. No bridge-proven guest entry, no FS or output operations. The safe own-DATA observation caught rejection with name TypeError and message **Promise is not a constructor.** Code was absent. Observation fault=false. Expected status0/stdout entry-return\n remains unchanged; actual status1/empty channels remains a semantic FAIL. The diagnostic captured detail successfully; this is not a passing L04 rescore.

Worker acquired, termination requested, actual exit1, parent cleanup closed/settled. Parent PID23501 naturally exited1; owner667ms; no signal. Outer capture774B in2 writes, both descriptors closed, primary absent/secondary0. Worker native capture0. PrivateFailures0/raw=[]; no control reason was serialized as guest error.

## Source versus new proof
Frozen 7000-byte guest SHA256 04e8842ed42ef72e1ed4ea2a851cf785558380e024c4c801444c15acb5bf5833 is unchanged. The Worker harness is instrumented, not unchanged: new own-data observation, supplemental parent transport, retained65536-byte ledger precharge and publication sidecar.

Pinned createPromiseGlobals supplies Promise static methods, not a constructible closure. evaluateNewExpression checks closure/construct and throws the observed message; run uses surfaceUnhandledThrows and rethrows. The new actual rejection confirms the constructor mismatch on this run. It does NOT recover the uncaptured original L04 reason. Starting public run or observing an error is not counted as a bridge-proven guest-entry marker. No pending Promise/job was established by this run.

Previous Worker collapsed both returned not-ok and caught rejection to guestFailure; parent diagnostics saw no raw parent reason, explaining the missing observation channel but not the old failure cause.

## Bindings and limits
126 capsule inputs authenticated before/copy/after; original95 emissions1076164B unchanged, no compile. Actual Worker load report99=93engine+6helpers including the new observer. Parent final LOADS.json remains absent because preserved semantic judgement stops the runner; no fabricated complete parent-load journal. BINDINGS.json pins all copied inputs, actual Worker loads, Node tool and exact importer edge.

20/20 harmless helper controls passed separately, one Node child44ms,803B captured, zero Worker/engine loads. Coverage: own accessors/proxies/revoked proxy/prototype/no-coercion, UTF8/escaping boundaries, precharge/route refusal, observer/send faults including thrown undefined, original reason identity. These are helper controls, not full-worker fault injection.

Source/control preparation:7 owned children,492771ms to actual entry, within10min/12. Actual phase:1 subject Node child plus3 publication-tool children planned/closed before final handoff, peak2 OS processes counting owner (Worker thread separately1). Owner-entry bound is not universal tool-startup bound. Fixed197056-byte SAB,16MiB command ledger, peak2621888B prepublication; existing32/8/8/4MiB V8 generation/code/stack caps. Not RSS/wholeguest/alljobs proof. TERM→2s→KILL unexercised.

Archive:135 files1383330 raw bytes,488073 base64 bytes; roundtrip authenticated SHA256 ddd1c9d37d15a2538efbcb5a404e2a3489a0c5c772fed119d89dfc875b82e0d7. Full raw captures/case judgement/observation/owner census included. Owned actual root retained; no live child or pending parent work; no artifact deletion claim. No network/private/engine-source/product writes.

## Proposed next step — not authorized here
Classify the constructor case unsupported, or separately preseal a new pending-Promise fixture using public Promise.race([]), which source supplies. That alternative's actual pending-job/entry-return behavior is NOT qualified and needs different review/fresh ROOT authority. No engine patch or broad engine-bug finding is established.

Original 2eb0536d L02v2 PASS/L03 PASS/L04 FAIL detail unknown and7Worker/6guest UNRUN stay intact. K1–K4 remain partial. No retry, tail continuation, provider/Node product acceptance, all-jobs or private-ABI claim.
