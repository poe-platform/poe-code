# Bulk decoder and compressed-source user validation

This bounded user QA pass found one product bug: `LazyInput` retained copied
chunks for bulk-only codecs before calling the retained-byte admission hook.
The original regression failed because the producer advanced to its second
chunk after the first chunk should have been rejected. Admission now happens
before each copy; the joined buffer retains its separate admission. Cancellation
is checked before copying each chunk. In-memory regressions also verify reused
producer buffers, producer closure and preservation of the cancellation reason.

An independent agent exercised actual Shell invocation with cooperative pending
compressed input, seven malformed/truncated/checksum/tail gzip inputs, source
immutability, typed permission errors and a reusable one-byte compressed buffer.
These probes validated no additional product bug. The new exact test path is
asserted in maintained test discovery.

Verified uncached checks:

- csvkit workspace tests: 1,347 pass, five encoding TODOs remain unmeasured.
- csvkit workspace lint and selected maintained build closure: pass.
- selected safe-bash maintained build closure, including postbuild: pass.
- focused four-file Shell cohort: 94 pass, no skips or TODOs.
- safe-bash maintained runner/discovery/build tests: 536 pass.
- safe-bash maintained source/test and consumer typecheck: pass after correcting
  two typing errors in the new stress tests; expected negative consumers reject.
- scoped ESLint for the new Shell test and modified discovery assertion: pass.

This is not exhaustive csvkit compatibility qualification or a full repository
unit/lint pass. Bulk-only provider partial-output timing remains unqualified.
The fix deliberately accounts for both retained chunks and the joined allocation,
so finite retention limits can refuse inputs previously admitted incorrectly.
Malformed gzip remains an explicit status-78 diagnostic blocker rather than a
native-message parity pass. Shipped bzip2/xz/zstandard decoding, typed Agate
operations, workbook paths and actual database/interpreter services retain their
documented blockers. No new native observations, visual CLI changes, README
content, staging, commits, push or publication occurred in this pass.
