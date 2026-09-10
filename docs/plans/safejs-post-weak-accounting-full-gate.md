# Post-weak-accounting full package gate

## Candidate and invocation

`npm test --workspace=@poe-code/safe-js` started in session 36884 on Node
22.23.2, after local commit b28fe1e19. It includes the maintained pretest and
filesystem type-contract route before the full declared package unit selection.
No exclusions or timeout changes were supplied.

Pre-run SHA-256 fingerprint (74b6a8):
`efd045a8f1ff01223aa1236ca4978516ff6796ff4112b599b029404f40606eed`.
The 1,579 files comprise regular files recursively under SafeJS src/test/scripts,
the package manifest and tsconfig, and the root lockfile. Sort paths and hash
each path, NUL, bytes, NUL. This does not fingerprint external dependencies or
every other workspace.

Keep runtime/test sources unchanged until this run completes. Current uncommitted
Temporal and weak integration is included; successful execution would not prove
that all of it is committed or delivered remotely.

## Observed progress

All 100 filesystem contracts passed: 25 each for NodeNext/Node-only,
NodeNext/DOM, Bundler/Node-only and Bundler/DOM. The unit runner then started
(e90ac6). No terminal unit result has been observed yet.

Session output is retained under postWeakAccountingGateChunks in the tool store;
the live handle is postWeakAccountingGateSession. Poll the actual handle rather
than inferring liveness from this document. After completion, record exact
failures/totals and compare the post-run fingerprint before qualifying results.

## Terminal result

Session 36884 exited 1 (88b29b): 27,272 passed, 18 failed, 41 skipped,
27,331 total tests; 1,172 passed, six failed and two skipped test files, 1,180
total. Duration was 1,411.62 seconds. All 100 preceding filesystem contracts
passed. Post-run fingerprint (8371a0) matches the pre-run 1,579-file hash exactly.
The source freeze can now end.

Failures:

- Two native Promise own-property import assertions (string descriptor and
  user symbol), with the host-metadata policy still unresolved.
- Eight 5,000ms timeouts in regex-cursor.independent.test.ts and one in
  string-split.independent.test.ts. No timeout thresholds were changed.
- misc.test.ts expects structuredClone to preserve a null prototype, contrary
  to the newer native-oracle normalization regression. Validate and reconcile
  this old test expectation, not the conforming runtime behavior.
- Three PlainMonthDay locale cases return a missing month name (` 29`).
- Three PlainYearMonth locale cases fail their native expected-value
  precondition because the host produces `2000 ` without a month name.

The earlier namespace replay timeout did not fail this run; that does not prove
its performance issue repaired. This result is not a green package gate and
does not establish full JavaScript conformance or remote delivery.

## Delivery

The earlier full gate remains failing until a new terminal result is inspected.
Do not replace it with the recent focused counts. Release hold remains active;
no push, publication or issue closure. Unrelated staged Safe Bash changes remain
untouched. The full JavaScript-completeness objective is still open.
