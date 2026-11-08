# Workspace native npm lifecycle QA

Verify the maintained workspace runner through actual npm processes. Keep these
disk and native-process checks outside the fast unit route; deterministic task
ordering, failure propagation, lifecycle admission, and cleanup checks remain in
`scripts/build-workspaces.test.ts`.

Create a fresh owned temporary root for each of the five cases below. Give it
`packages/*` workspaces: `alpha` depends on `beta`, and both define `prebuild`,
`build`, and `postbuild` as `node ../../step.cjs`. Add a `python` workspace with
no build. Copy the current `build-workspaces.mjs`, `check-cache.mjs`, and
`workspace-test-ownership.mjs` into its `scripts` directory, and link the installed
`typescript` and `shell-quote` packages into its `node_modules`.

The root build runs `node scripts/build-workspaces.mjs && node step.cjs suffix`.
Its prepack invokes the same actual Node/npm CLI to run that root build. The step
program appends JSON events containing `npm_package_name`, `npm_lifecycle_event`,
`CUSTOM_TEST_VALUE`, and whether its argv contains `suffix`; a `fail` argument
exits with code seven.

Invoke the actual npm CLI with `--prefix <owned-root> run <event>`, the fixture as
cwd, and a detached process group. Use an isolated fixture HOME, TMPDIR, npm cache,
empty user/global npmrc files, offline mode, disabled audit/fund/update notices,
`CUSTOM_TEST_VALUE=preserved`, C locale and UTC. Set PATH to Node's directory plus
`/usr/bin:/bin`. Capture at most one MiB of output. Retain the original 20-second
child deadline: terminate only the owned group with SIGTERM, escalate after one
second, and await close before removing the fixture. A deadline is a failure,
never a successful verification.

Execute and assert all five cases:

1. **Build:** exit zero, no signal, events exactly `beta:prebuild`, `beta:build`,
   `beta:postbuild`, `alpha:prebuild`, `alpha:build`, `alpha:postbuild`,
   `owned-root:build`; the last event has `suffix=true`. Output contains
   `NO_DECLARED_BUILD_NOT_A_PASS`.
2. **Prepack:** invoke prepack and assert the identical successful build sequence,
   suffix, and buildless-workspace notice.
3. **Postbuild failure:** change beta's postbuild to `node ../../step.cjs fail`.
   Require a nonzero exit, no signal, and exactly the three beta lifecycle events;
   alpha and the root suffix must never run.
4. **Suppressed lifecycle:** put `ignore-scripts=true` in the fixture `.npmrc`.
   Require a nonzero exit, the diagnostic `Unsupported lifecycle or workspace
   option`, and no event file.
5. **Include root:** put `include-workspace-root=true` in the fixture `.npmrc`.
   Require the same successful event sequence, suffix and notice as build, without
   duplicating the root event.

For every emitted event, require `custom` to equal `preserved`. All cases must
close normally without signal or forced timeout, and cleanup must remove only
their owned fixtures.

Also execute five unit-mode lifecycle cases in fresh owned roots using the same
isolation, actual npm invocation, output cap and unchanged deadlines. Declare one
`@poe-platform/safe-bash` workspace with pre/build/postbuild and
pre/test:unit/posttest:unit scripts pointing to the step program. Declare root
pre/test/posttest and pre/test:unit/posttest:unit scripts; the root test invokes
`node scripts/build-workspaces.mjs --test-unit`. Declare the Bash unit task's
dependency on `build` in `turbo.json`. The step program records package/event and
exits seven only when the Bash workspace reaches the selected failed event.

Run with failure selectors `none`, `prebuild`, `postbuild`, `pretest:unit`, and
`posttest:unit`. Require no signal, an event file, and exit zero for `none` or
exactly seven otherwise. The complete successful sequence is:

```text
owned-root:pretest
@poe-platform/safe-bash:prebuild
@poe-platform/safe-bash:build
@poe-platform/safe-bash:postbuild
owned-root:pretest:unit
owned-root:test:unit
owned-root:posttest:unit
@poe-platform/safe-bash:pretest:unit
@poe-platform/safe-bash:test:unit
@poe-platform/safe-bash:posttest:unit
owned-root:posttest
```

For each failure, require exactly the prefix ending at the selected Bash event;
no later lifecycle or root posttest may run.

All ten original cases and assertions passed unchanged on 27 September 2026:
build 2858 ms, prepack 3302 ms, postbuild failure 1533 ms, suppressed lifecycle
544 ms, include root 2358 ms; unit-mode selectors respectively took 2796, 882,
1127, 2334 and 2561 ms. The full unit run exposed a 20-second host-startup
timeout during beta's postbuild; no production failure or deadline increase was
needed.
