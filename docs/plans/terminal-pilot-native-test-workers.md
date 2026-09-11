# Terminal-pilot native test workers

## Problem and evidence

The maintained full unit run failed seven native terminal-pilot session tests across three files. The original thread-pool run reported 281 passing tests and seven 5-second timeouts in 31.02 seconds (`/tmp/poe-689-full-unit-committed.log`). Its worker also failed to terminate: a child node-pty spawn-helper remained blocked before executing the fixture. Native sampling showed `open` at helper startup (`/tmp/poe-689-terminal-helper.sample.txt`); installed `node-pty/src/unix/spawn-helper.cc` opens the slave terminal before executing the requested command.

The installed node-pty README explicitly states that the library is not thread safe across Node worker threads (line 120). The shared Vitest configuration selects two thread workers. This is a documented unsupported native-library topology, rather than evidence that the fixture needs a longer deadline.

An independent lifecycle test defect also leaked an actual terminal: its mocked successful close removed the session from tracking without closing the native process. Adding an assertion for a non-null actual exit code failed against that implementation (`/tmp/poe-689-terminal-close-red.log`).

## Changes

- Select Vitest's `forks` pool only in terminal-pilot's maintained `test` and `test:unit` commands. Keep the shared configuration, two workers, exact file membership, timeouts, and native pretest build hooks.
- Make the close-retry test's second attempt call the real session close, assert actual native exit, and restore the spy and close the session in `finally`.
- Keep native spawn, input, keypress, screen/history, screenshot, and repeated CLI session coverage. No product runtime or native dependency changes are required.

## Validation

- RED: the close-retry test observed `exitCode === null` after its fake successful close.
- GREEN: all 288 tests in eight terminal-pilot source files passed with process workers in 2.16 seconds (`/tmp/poe-689-terminal-forks-green.log`).
- GREEN: `npm run test:unit --workspace=terminal-pilot` completed its declared pretest build and all 288 tests in eight files (`/tmp/poe-689-terminal-maintained-green.log`).

The observations establish that the corrected supported topology passes the original failing tests. They do not identify a particular node-pty internal shared variable responsible for the blocked native open, or attribute all seven failures to the separately fixed leaked-session test.

## Follow-up: preserve native ownership in the shared runner

The next complete run exposed six exact-selector assertions that still expected the old command. More importantly, it ran 916 shared files/22,679 tests instead of 908/22,391: all eight native terminal files were mistakenly included in the root shared phase. The native workspace stage was still scheduled, so this also risked duplicate execution. Evidence: `/tmp/poe-689-full-unit-terminal-fixed.log`.

The ownership classifier rejected the new pool option and discarded the entire selection. Since root exclusions are derived from those selections, it stopped excluding terminal-pilot's owned files. Recognized built-in pool overrides now preserve selectors and exclusions while explicitly requiring native execution; shared stages cannot absorb them, even when no lifecycle hook exists. Both `--pool=forks` and `--pool forks` are supported, and any explicit built-in pool remains on its declared native route. Unknown/custom/missing pool values remain unsupported by the classifier. No arbitrary CLI parsing or global pool changes were added.

Focused TDD reproduced five new ownership failures plus the six existing argv failures (`/tmp/poe-689-terminal-routing-red.log`). That first direct-node diagnostic invocation also had ten lifecycle controls reject its missing invoking npm CLI environment; those are invocation errors, not claimed product regressions. Running through `npm exec -- vitest run` supplies the maintained lifecycle context: all 253 runner/ownership/shared-stage tests passed (`/tmp/poe-689-terminal-routing-green.log`). A final regression also verifies the actual terminal manifest retains its native prehook and exact root exclusion (`/tmp/poe-689-terminal-ownership-final.log`). The terminal workspace's unchanged 288 native tests are rechecked through its maintained npm lifecycle route (`/tmp/poe-689-terminal-routing-native.log`).
