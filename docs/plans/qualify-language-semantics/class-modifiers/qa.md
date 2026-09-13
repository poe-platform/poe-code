# Class modifier spelling QA

Execute against the candidate after the maintained SafeJS workspace build.

1. Run the selected upstream command recorded in `command.json`, preserving original
   strict/sloppy modes, fixture hashes, deadlines and all harness assertions.
2. Run independent parser cases in `class-modifier-spellings.test.ts`. Compare the
   minimal rejected class with native Node Script compilation. Confirm escaped
   names remain valid, including an escaped static field separated by a newline.
3. From each available runtime import the built SDK. Check early errors before
   side effects through direct/indirect eval and dynamic Function; private class
   access, error identity, finally, source text and three pending/completed replay
   cycles. Keep unavailable runtime cells explicitly unverified.
4. Run the built CLI with `invalid.ajs`, compare its location to SDK rejection, and
   render its terminal screenshot using the maintained screenshot command. Inspect
   the actual PNG. The separate trailing-newline caret finding remains open.
5. Inspect the patch for new authority, budget changes, snapshot changes and cleanup
   regressions. Confirm valid code runs after rejected compilation; malicious
   constructor-chain process/require access stays unavailable. Run a bounded guest
   loop with an explicit maxSteps budget and require budget rejection.
6. Record all command exits, failures/skips, exact source and runtime receipts. Do
   not count these focused checks as full package or full language qualification.
