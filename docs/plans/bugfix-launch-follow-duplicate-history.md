# Launch follow duplicate history

## Independently confirmed behavior

`launch logs api --follow` prints history through `readLaunchLogs` and then again
through `followLaunchLogs`, whose package implementation deliberately yields its
initial window. Existing A/B followed by appended C produces A B A B C; lines 1
produces B B C. Lines 0 and non-follow output are correct. Stderr is also affected.
Genuine repeated records must remain distinct: two existing repeats and one new
repeat should produce three records, not five and not one.

## Scoped fix

- Modify only `src/cli/commands/launch.ts`, `launch-command.test.ts`, and this plan.
- Make reading/printing history exclusive to the non-follow branch.
- Follow exclusively through the follower, preserving lines (default 50), stream,
  abort signal, and existing try/finally signal-listener cleanup.
- Do not change SDK/packages, deduplicate content, or force lines 0; an extra read
  followed by lines 0 can skip writes between those operations.
- Add no dependencies, comments, README edits, commits, or unrelated changes.

## TDD and validation

- Use existing SDK mocks and memfs containers with finite in-memory generators.
- Confirm red for default/explicit/zero history and stdout/stderr; follow must
  never call the separate history reader.
- Preserve non-follow and genuine-repeat controls.
- Check listener cleanup after finite completion, iterator error, and cancellation.
  Invoke captured SIGINT/SIGTERM callbacks directly; never emit process signals.
- Confirm green and notify the parent, then run scoped lint, types, and related
  SDK/package follower tests without editing their files.

## Parent visual QA

The parent captured and inspected `screenshots/ux-launch-follow-logs-before.png`
using a safe SDK stub and owns after-change PTY QA, screenshots, review, and commit.
Use the same fixture to verify initial history and newly appended lines appear
once, while identical records retain their original multiplicity.

## Validation results

- Red: 11 expected failures exposed duplicate history or the forbidden separate
  reader call; 67 controls passed before the production edit.
- Green: all 78 launch-command tests passed in 35 ms. Finite completion, iterator
  failure, and captured cancellation callbacks leave signal listeners unchanged.
- Related validation: all 28 SDK-core tests and three package follower tests passed.
- Scoped ESLint, root `npm run lint:types`, and scoped `git diff --check` passed.
- The parent was notified immediately after launch tests turned green. Actual
  after-change PTY QA, screenshots, review, and commit remain with the parent.
- Parent review and actual-PTY command execution passed using the same safe SDK
  stream stub as the baseline. Existing records and the live update appeared once,
  the separate reader was never called, both signal listener lists were restored,
  and the memfs volume stayed unchanged. The parent inspected
  `screenshots/ux-launch-follow-logs-after.png` against the before screenshot.
