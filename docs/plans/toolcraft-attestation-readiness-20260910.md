# Wait for registry attestations before signature verification

Release-toolcraft run 34453894061 for commit
`44a14eb902778377d84e5cc74dd31939057c76b2` publishes the three packages at
0.0.220, then its installed-signature verification fails on September 10, 2026
at 08:26:45 UTC. Installation and both existing version-availability waits pass.
The actual failure is npm E404 for the toolcraft 0.0.220 attestation endpoint,
not an invalid-signature verdict or the separate dependency vulnerability notice.

At 08:28:45 UTC, without retrying publication, the same package and attestation
endpoint return HTTP 200. Two attestations are present; exact/latest package
gitHead matches the commit, and package shasum matches the publish log. This
validates a version-versus-attestation propagation gap. HTTP availability alone
does not establish cryptographic validity.

Extend the existing bounded availability waits to require each newly published
package's registry attestation endpoint before dependent signature checks run.
Use the fixed official registry endpoint, a ten-second per-request limit, the
existing bounded attempts and eleven-minute step deadline. Exhaustion explicitly
fails; no final version-only probe may accidentally turn missing attestations
into success. Cover schema before the packed audit and toolcraft/openapi before
the installed audit.

Keep both `npm audit signatures --omit=optional` invocations unchanged and
mandatory. Do not disable provenance, ignore signature errors or treat a 200
response as verification. A permanently missing or invalid attestation still
fails the release. Do not blindly rerun the old publish job: it recomputes the
next version and may create another release unnecessarily.

This workflow-only fix has its own atomic commit. Per repository instructions,
use `npm run lint:workflows`, not unit tests for GitHub workflows. Preserve the
failed run, verify remote delivery, and monitor the subsequent workflow through
actual publication and successful signature verification.
