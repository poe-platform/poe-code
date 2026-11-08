# Frozen independent trim acceptance policy

Author must not inspect this directory's vectors or instrumentation before the
next source candidate is frozen. Ownership is verifier-only. No product edits.

This supplements, never replaces, the unchanged independent 30 correctness
holdouts frozen at d4320b0 (baseline evidence 6736221: 22/30), and the separate
author original 20 (baseline 17/20). First candidate is
7a517cecab21d9fbff204df01a6a2ad2712a7673. Its known trim-copy regression is a
blocking failure, not an acceptable performance caveat.

## Expected policy, frozen before further source changes

- Exercise byte tail and head exclusion with geometric modest first-chunk sizes
  and growing one-byte followups, independently using immutable Buffer,
  next-read-reused Buffer and next-read-reused native Uint8Array.
- Product copy bytes must be at most `6 * inputBytes + 2 * count + 256` in each
  workload; product allocated bytes at most `8 * inputBytes + 4 * count + 512`.
  These fixed linear envelopes allow initial ownership and amortized compaction,
  not repeated full-remainder copying. No timing or throughput gate is used.
- At producer-resume checkpoints, the queue's distinct retained backing bytes
  must be at most `4 * count + 64`. A separate oversized-first-chunk family
  verifies that trimming to a small suffix releases the large backing promptly,
  rather than retaining it via a tiny subarray for the life of that suffix.
  Counts are positive. Historical consumed slots are included, not hidden;
  workloads stay below existing queue-slot compaction thresholds. This is a
  bounded small-count witness, not a proof of every count/budget combination.
- Exact bytes/status/diagnostics, no input mutation, finalization, cancellation,
  source errors, sink errors and awaited acceptance remain mandatory. The
  original 30 provide unchanged public Shell/registry coverage; added head
  exclusion controls exercise backpressure and errors directly in a registry.
- Borrowed producer storage changes only after the yielded read resumes or
  finishes; awaited sinks own their acceptance schedule. The basis is executable
  tests/contracts/io.test.ts:41 and :144, helper copy/await behavior, AGENTS and
  the user's legal reuse schedule. Bare ByteSource alone does not specify lease
  duration. No malicious/concurrent host-JavaScript guarantee is asserted.

## Instrumentation boundary

An isolated child patches native Uint8Array construction, slice and set, Buffer
slice, and Array push/slice. Product bytes only are metered; fixture generation,
expected outputs, assertions and sink capture run with metering disabled.
Constructor numeric allocations, copied constructors, copying slices and sets
are counted; zero-copy views are not copy bytes. A weak observation of the
product byte-array queue accounts for distinct backing buffers, including
consumed slots still referenced. This observes queue reachability without GC
or RSS heuristics and without changing product source. Lack of an observable
queue is a harness failure, not a retention pass. Source review must establish
that changed copy sites remain within the instrumented operations; indexed-loop
copies or alternate allocation primitives are not automatically certified.

The tests calibrate instrumentation, restore globals in finally, use no servers
and do not launch native product commands. Existing frozen correctness fixtures
and expected vectors are read-only. New evidence is append-only in this subtree.
Package verification must use actual offline `npm pack --ignore-scripts` with
the original manifest/files, move the archive, extract into an unrelated named
consumer package scope, assert import.meta.resolve and verify loaded hashes
using the existing independent loader. Merely moving dist is not npm-pack proof.

No broad benchmark, all-tests run, provider guarantee or project completion claim.
