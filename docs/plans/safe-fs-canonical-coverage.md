# Canonical filesystem coverage before shell retirement

## Scope and release order

This test-only slice adds the 24 frozen canonical filesystem test/helper files
under `packages/safe-fs/tests/migration` after the verified `poe-code@13.0.0`
WebDAV safeguard and its postrelease documentation. It changes no production
adapter, SDK runtime, dependency, lockfile, registry writer or shell implementation.
Preserve all current remote security, language and documentation increments.

The WebDAV release is commit `1b180668e29f43421ab2b89210a17ab6eab8c06e`, workflow
`33306648081` (success), actual registry version `13.0.0`. Its final receipt is
`/tmp/release-webdav-published.9XRakw/artifacts/final-receipt.json`; actual published
transport evidence is `/tmp/webdav-published-verification.yWqwIE/RECEIPT.json`.
The latter verifies 50 native Node controls, 390 browser assertions plus 12
observations, 134 zero-source/no-I/O cases and 1,242 stress operations. Native
Firefox/WebKit streaming safely rejects; Chromium HTTP/2 works in the exercised
deployment. This is not full browser SDK or universal WebDAV server coverage.

Canonical tests must be committed and verified on remote main before private
safe-bash implementation/test retirement. The separate shell candidate selects
peer `>=13.0.0` and development pin `13.0.0` where it uses the breaking streaming
contract; its final approval and gates remain separate. This coverage commit
does not claim the broad shell suite passes or authorize unfinished retirement.

## Frozen provenance and preserved assertions

Owner handoff: `/tmp/safe-fs-canonical-webdav-rebase.Eeb9a7/HANDOFF.md`.
Captured input: `/tmp/release-canonical-coverage-inputs.Hqo3Kl`.
Full 24-path patch SHA-256:
`f8d54a61c295cfc7cef4167e2e105d89c8de82a58edf0c3dbaccb16f7c0879a5`.
Every imported file is checked against the owner's afterhash before gates.

The 19 test files and five helpers preserve all 449 original named cases and
573 original static assertion sites. Six transport-fixture adaptations add 14
static sites and six runtime cases, giving 455 cases. Eighteen ports are
byte-identical to the earlier frozen ports. Only faithful upload-capable fixtures
declare `requestStreamSupport: true`; metadata-only fixtures are not blanket
enrolled. Four new cases verify faithful direct, created, forwarded and proxy
transports consume reused binary chunks with correct ownership/finalization.
Two prove undeclared faithful/coercing transports fail before source access/I/O.

The deliberately noncompliant post-send binding fixture remains negative: it
consumes submitted bytes, corrupts the wrong store, then receives `EIO` with the
illicit effect recorded. It is not a compliant success or dishonest-host defense.
Production policy and assertions are not weakened to make these tests pass.

The original 845-site shell-to-canonical ownership mapping remains 720 + 125;
573 is the static count in the canonical port files, not a replacement denominator.
Mapping evidence remains in
`/tmp/safe-bash-ownership-continuation.Dg5dm2/artifacts/coverage-final.json` and
`/tmp/safe-bash-migration-acceptance.ieN4iC/artifacts/five-file-assertion-accounting.json`.
The latter SHA-256 is `fe8b66d4b0ca74266a674ad198d843c46ff046882348ec35a96b294b9b3b1af1`.

## Validation and handoff requirements

Owner evidence preserves the original C baseline (449 pass), exact streaming
fix with unenrolled fixtures (272 pass/177 fail), updated ports (455 pass) and
focused transport controls (105 pass). Zero-test working-directory failures are
retained as harness failures, not behavioral reds. The owner's strict Node ES2022
type profile retains `skipLibCheck: true`; its attempted DOM/default-library
profile is not claimed green or used as browser acceptance.

The exact imported ports reproduce two failures under the normal root runner:
its deliberate global Fetch guard rejects the two real HTTP property cases.
The integration increment injects a bounded `node:http` property transport from
the existing loopback helper instead of restoring or bypassing the global guard.
It permits only that server's origin and PROPFIND, rejects stream bodies, bounds
responses and retains real wire serialization without private-store authority.
Two existing mocked GET responses now copy their byte inputs into owned
`Uint8Array` values, resolving the two reproduced DOM `BodyInit` type errors
without casts, changed assertions or production changes. These four test/helper
afterimages are a separately recorded successor to the immutable owner snapshot;
the 455 named cases and original assertion sites remain intact.

Commit preflight also detected three whitespace-only blank lines in the frozen
memory comparison port. A successor candidate normalizes only those lines,
preserves the prior archive/index/evidence, and reruns the full gates. This fifth
port difference changes no code or assertion expression.

The isolated current-main candidate must run the 455 canonical cases and 105
transport controls, scoped lint/types, full root build/lint/types/package rules,
workflow lint, uncached root tests, smoke and ordinary commit/push hooks. Preserve
the 41 existing skips; add no exclusions, production fixes or hidden policy
waivers. Record any candidate-only integration failure before changing scope.
This test/docs commit is not expected to publish npm; verify the workflow's
actual semantic-release result and registry state rather than inventing a version.

Keep original checkout HEAD/index/working bytes, four terminal fonts and the
`CLAUDE.md` symlink unchanged. After successful workflow and exact remote commit
verification, relay the canonical coverage commit to the shell owner through the
root coordinator; private retirements still require that candidate's approval.
