# Python object I/O qualification admission — issue 781

## Objective

Reject false-success receipts before accepting the requested hosted measurements.
This does not replace actual hosted qualification or change storage defaults.

## Validated defects

- Returned profile fields were overwritten by the requested configuration, hiding
  a Worker that measured a different page, transfer, delay, size or working set.
- Eight arbitrary distinct strings were accepted as storage conformance results.
- Missing phase/request measurements, invalid counters and failed cleanup
  operations could pass admission despite the required evidence being absent.

## Implementation

Validate every requested profile field against its returned value before retaining
the receipt. Require all eight named publication/staging conformance cases, exact
workload denominators, lifecycle counts and required phase/request measurements.
Validate finite nonnegative timings, positive integer request counts and bounded
failure counts; required workload and cleanup operations must report success.
Keep independent byte hashes and actual short-BYOB record/EOF validation intact.

## Validation and delivery

The expanded memory-only regression suite fails 90 of 105 tests against unchanged
main at `9b49feba984089df556edd82fddb6e611a408d33`. Apply the minimal admission fix,
run focused and adjacent hosted-tool tests plus maintained uncached ESLint, then
commit the atomic improvement and push directly to main. Monitor GitHub release
publication and independently verify npm latest and its source revision.

Both preserved actual-Python native receipt sets pass the tightened admission
checks: 32 rows total with independently synthesized exact benchmark bytes.
This replay is not evidence of real hosted execution or hosted cleanup.
Issue 781 remains open until a valid scoped development credential permits the
actual hosted matrix and owned-resource cleanup to pass.
