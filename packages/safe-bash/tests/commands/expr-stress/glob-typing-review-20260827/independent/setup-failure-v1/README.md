# Preserved initial baseline execution failures

`../baseline-v1/` correctly reproduced TS2339/TS2345/TS2769 and emitted the
fixture despite these existing diagnostics. Its runtime setup failed before
any fixture case ran: `ERR_MODULE_NOT_FOUND` for emitted `client.js`.

Cause: TypeScript considered imported modules beneath the deliberately
task-owned `node_modules/` temporary directory external and did not emit them
when only fixture/worker/protocol-test entry points were listed. Type checking
still traversed and recorded their source closure. This is a review harness
emission failure, not a production failure or test pass.

The original driver is preserved as `driver.mjs.txt`. An attempted correction
had a malformed apply_patch envelope and was rejected without changing the
driver; the grouped shell still ran `baseline-v2/` using the original driver,
so that repeated setup failure is also retained, not discarded or called a pass.

Correction: retain the exact single-fixture typecheck; explicitly name the
already selected non-fixture TypeScript closure as runtime-support emission
roots. No new corpus or source edits. Re-run into `baseline-v3/`, never overwrite
either earlier capture.
