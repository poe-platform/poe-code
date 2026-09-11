# Issue 704: archive publication on filesystems without permissions

The reported tar failure remains reproducible: an adapter with working exclusive
creation and `permissions: false` rejects the unconditional `mode: 0o600` passed
by archive publication. The same failure affects streaming and buffered writes.

Resolve the destination's capabilities before constructing write options. Omit
the mode property when permissions are explicitly unavailable; retain the
requested mode when support is true or unknown. Keep exclusive creation and the
invocation signal unchanged. This does not establish a privacy guarantee on a
filesystem without permissions or change its authorization policy.

The companion regression uses the in-memory filesystem behind a capability-aware
adapter that rejects permission options. Twelve cases cover streaming and buffered
publication, global false/true/unknown capability values, and path-specific
false-over-true, true-over-false and unknown-over-false overrides. Each successful
creation is extracted through the same adapter and real tar command, then
compared with the original binary; extraction write options are checked too.
The new test is explicitly admitted by the maintained discovery assertion.

Validation:

- Before the fix, the ten-case matrix produced four expected ENOTSUP failures
  and six passes: `/tmp/poe-704-tar-red.log`.
- After the fix, the six-file archive cohort passed all 133 tests in 16.32s:
  `/tmp/poe-704-tar-green.log`.
- Independent review prompted the path-unknown control and extraction through
  the same adapter. All twelve final matrix cases pass:
  `/tmp/poe-704-tar-review-green.log`.
- Focused strict TypeScript and discovery validation results are recorded in
  `/tmp/poe-704-tar-types.log` and `/tmp/poe-704-tar-admission.log`.
- Root-coordinated build, final lint, remote delivery and release validation
  remain pending at this implementation handoff.

This atomic change addresses only archive permissions. The issue's find
formatting request is separate. Background execution remains explicitly
unsupported, and the existing maxCpuMs documentation describes elapsed time
including waits rather than CPU accounting.

Root integration validation passed: normal workspace build; the complete root
lint/type/workflow route in 389.83 seconds with 10,510 configured/linted files,
zero errors/warnings and 25 receipts (`/tmp/poe-704-lint-allocation-full.log`).
The isolated candidate consumer at `/private/tmp/poe-704-tar-public-x40cvdzo`
passed all 12 capability profiles on Node, Bun, browser bundle and actual workerd,
plus three strict TypeScript profiles.
