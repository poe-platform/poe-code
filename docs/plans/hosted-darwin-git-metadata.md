# Hosted Darwin Git metadata qualification

## Approved observation scope

The existing `darwin-native-metadata` dispatch also records the Git executable
resolved by `xcrun --find git`: canonical path, regular executable mode, size,
SHA-256, version, `--exec-path`, canonical git-core directory and Apple code
signature display/verification. Commands and arguments are fixed. This remains
a ten-minute, permissions-empty hosted job without checkout, installs, secrets,
artifact uploads or writes to repository contents. Ordinary push/default release
behavior and the separate GNU build qualification are unchanged.

Observations are explicitly unreviewed. The historical Git SHA-256
`10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9`
is retained for comparison, not replaced. A new first-observed digest does not
admit a tool or qualify semantic behavior. Executable identity is checked again
after the read-only commands. Failed resolution, invalid file/directory shape or
failed signature verification fails the job.

## Additional existing obligations

Release run `33406086775` reported three unavailable-Xcode-Git cases in
`packages/safe-bash/tests/commands/diff-patch-stress/editflows/oracles.test.ts`:
quoted spaces, quoted tab escape and quoted UTF-8 octets. Its native-identities
case also requires Git, and the complete file contains ten cases. These are
additional to the earlier thirteen-obligation/seven-file inventory; that
inventory was incomplete. The oracle assertions, `fixtures.ts`, helper bindings
and historical pins are unchanged by this metadata addition.

## Execution and next decision

After normal hooks and main push, dispatch the existing Release workflow with
`qualification=darwin-native-metadata`. Save the complete job logs and emitted
metadata with the actual run SHA, runner image and code-signature evidence.
Serialize this dispatch and GNU build qualification under existing concurrency;
do not cancel a healthy job. Run `npm run lint:workflows` for this configuration,
not workflow unit tests.

Review the resulting identity before proposing a fixed hosted binding and the
unchanged full ten-case semantic qualification. Linux Git, if needed, requires
independent genuine Linux provenance and qualification; it is not Apple evidence.
No new binding, caller, profile admission or release clearance is claimed here.
