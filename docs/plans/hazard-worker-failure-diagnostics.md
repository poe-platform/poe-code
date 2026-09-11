# Hazard worker failure diagnostics

## Observed problem

The complete maintained unit run for local PR 719 candidate `6464b23f302430a8b54c314c29b15a29237815d6` failed at the structured resource test's child-process assertion. Node reported `spawnSync ETIMEDOUT`, but the assertion omitted which of the five scenarios failed. The 1,385 ms aggregate test duration does not identify the child or its execution phase. SafeJS, terminal tests, and root posttest were not reached; this candidate has not passed the full gate.

One unchanged focused replay passed all seven resource tests, including all five hazardous scenarios. A bounded diagnostic subsequently ran 25 children with the original one-second timeout and 4,096-byte output bound; all passed. Comparing the existing external-package bundle with a fully bundled worker showed no consistent improvement. These warm, sequential measurements do not establish the cause of the full-run timeout and do not justify a bundling change.

## Change and preservation requirements

Identify the failing scenario when a child-process error occurs and retain the original error as its cause. Preserve all five scenarios, the one-second killable deadline, output bound, exit-status assertion, and output assertion. This is a diagnostic improvement, not a claim to have fixed or explained the timeout.

The maintained historical equivalence checker currently pins the active resource test before reversing earlier explicit migrations. Preserve that exact prior 6,792-byte image as an immutable text fixture and bind the historical startup/depth checks and their negative controls to it. Preserve original hashes, captured evidence, and controls. Explicitly distinguish this one archived image from current-source comparison accounting; the active resource test remains discovered and executed. Independent review recommended this narrowly authorized transition because adding another current-file hash pin would perpetuate the conflict with the package's rule against treating historical implementation bytes as current behavior.

## Verification and delivery

The original failed full run establishes the missing diagnostic. Verify the changed failure path with a controlled child error, then run the focused resource and maintained evidence checks. Review exact differences and run applicable lint and type checks. Bind the resulting candidate in an exact-file conventional commit before the next complete maintained unit run. That full run remains required for PR 719; a passing focused replay cannot replace it. After full tests, run the normal build before current packed-consumer qualification. Remote delivery and release remain pending those gates.

Independent review approved the exact historical-image binding and current diagnostic. Applying the diagnostic before adapting the historical binding reproduced 24 failed checks out of 92. The final focused run passed all 99 resource and historical-evidence tests in 1.853 seconds. A controlled native one-second timeout demonstrated that the old assertion omitted the scenario and that the new error identifies it while retaining the identical original `ETIMEDOUT` error as its cause. The archived image matches the prior committed resource source byte for byte. Maintained test discovery includes the active resource test and excludes the text fixture. Full qualification remains pending; these results do not explain the original timeout.
