# L04 diagnostic v11

Source timing: post-existing engine/candidate/actual failure. Historical 2eb0536d L02v2/L03 PASS and L04 FAIL detail unknown remain unchanged.

## Source diagnosis
Frozen L04 calls new Promise(() => {}), then console.log('entry-return'). createPromiseGlobals returns an object of all/race/allSettled/any/resolve/reject sandbox closures, not a constructible Promise closure. evaluateNewExpression requires a sandbox closure with construct and otherwise throws TypeError. Public run sets surfaceUnhandledThrows and rethrows its catch error. This suggests a constructor-profile mismatch, NOT recovered historical failure detail. Worker previously collapsed both result.ok=false and rejection to guestFailure without retaining detail.

## Instrumentation
New Worker-only node:util observer refuses Proxy before reflection; reads only name/message/code own descriptors, never accessor/prototype/stack/cause. Fixed 64KiB reservation occurs before Worker acquisition and stays charged while reports remain owned. Each field <=256 UTF8 bytes; fixed report <=8192; no copy/encoding before fixed credit. Original thrown value is returned unchanged by the publication helper; serialized text is not identity evidence. Observer/send faults do not change original terminal or parent control priority. Parent observation fault is supplemental, not a new control reason.

No changes to guest program, public engine95 emissions, compiler, private source, or product. Engine attempt does not prove guest entry. Only a real bridge operation proves entry; a new constructor error plus source location is narrower evidence, not all-jobs proof.

## Activation
Harmless Node controls first, exact PRESEAL argv/env, outer exclusive raw captures before admission/spawn, 30s TERM then2s KILL, wait close, no retry. After20/20, atomic ROOT grant with exact selected instance WRQ04-L04-diagnostic-v11 and body hashes; owner entry runWorkerQualification(grant SHA) from this directory/future-owner.mjs. Fresh actual-v11-01 only, no prior root reuse. Reauthenticate entire composition and owner dependency closure before load. Existing owner acquires raw capture before child admission, enrolls close/error before fallible publication, waits actual close and retains all artifacts. Owner timeout180s/TERM2sKILL remains source-only unless exercised.

Control failure, admission/capture/integrity failure, unknown Worker exit/parent cleanup: stop, no retry. Diagnostic semantic expected stdout/status remain unchanged; a failed L04 expectation is recorded, not changed to a pass. All existing seven tail slots remain UNRUN.
