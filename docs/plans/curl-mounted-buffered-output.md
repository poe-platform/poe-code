# Curl output on buffered mounts

Issue: #548

## Required behavior

`curl -o` must preserve exact output bytes when a buffered filesystem is mounted, including mixed streaming/buffered compositions. Read-only, permission, I/O and cancellation failures must remain failures. Never replay a response source that a failed writer may already have consumed.

## Implementation

- Respect an explicit `streamingWrite: false` before choosing the writer.
- For unknown/mixed capability, try the existing stream method with an observation-only source wrapper.
- Fall back to the existing bounded writeFile/appendFile path only for a typed unsupported-operation error before any iterator acquisition.
- Preserve signals, backpressure, binary chunks, truncation, download limits and real write errors. Do not change filesystem contracts or introduce provider-specific branches.

## Verification

1. Reproduce direct success and mounted failure with in-memory, injected HTTP responses through actual Shell.
2. Cover empty/binary output, mixed destinations, opted-out methods, refusal before/after iterator acquisition, permissions/read-only errors, cancellation and bounded consumption.
3. Register the new test in the guarded integration inventory and run focused network/inventory checks.
4. Exercise both public package entry points under Node and Bun using local tarballs, then fresh published npm packages.
5. Run normal commit/push gates, verify the GitHub release and npm provenance, then close #548.

Worker compatibility is not the reported failure and is not inferred from Node/Bun tests.

## Validation observations

- Initial reproduction: direct binary/empty cases passed; both mounted cases failed with curl exit 23.
- Fixed candidate: 21 new regression cases and 294 combined network/inventory checks pass. Root build and fresh local-tarball Node/Bun/TypeScript consumers pass.
- The optional broader `virtual-bash` typecheck reports missing legacy oracle imports and strict-type errors in unrelated diff/patch, jq, invocation-cleanup and timing fixtures. No exclusions or unrelated fixture changes are made. This is not reported as a passing full-package typecheck; normal root commit, push and release gates remain required.
