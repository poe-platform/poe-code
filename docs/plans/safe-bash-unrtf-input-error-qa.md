# UnRTF input acquisition error QA

Run against the current candidate, without registering UnRTF by default or
installing the private command workspace in the consumer.

1. Run the command workspace unit tests and lint/typecheck route. Confirm that
   missing VFS files produce status 1, empty stdout and identical deterministic
   diagnostics through the CLI and SDK. Verify the exact path then `.rtf` retry.
2. Run the selected `@poe-platform/safe-bash` workspace build closure. Stage
   public artifacts with the maintained `scripts/package-safe.mjs` assembler,
   pack only public SafeFS and Safe Bash, and install in an external consumer.
3. Execute the maintained UnRTF runtime and strict NodeNext declaration fixtures
   from that consumer. Check canonical runtime identity, default absence,
   opt-in registration, literal paths, stdin, extension retry and CLI/SDK parity.
4. Execute a missing-file command through the installed shell. Confirm empty
   stdout, status 1 and deterministic stderr; compare the SDK invocation.
   Capture and inspect the terminal transcript as a screenshot.
5. Confirm the injected source-failure test preserves the original error,
   invokes producer cleanup and releases all retained reservations. Confirm
   pre-input markup budget rejection still avoids pulling the source.
6. Remove task-owned temporary artifacts after recording results.

These checks qualify input-error behavior and package wiring only. GNU
personalities, ordered config merging, native-legacy Unicode/output, complete
codec/charmap coverage, picture exports and advanced tables remain unsupported.
Actual browser/workerd engines, checkpoint/replay and release publication are
not established by Node consumer checks.

## Candidate results — September 20, 2026

- Reproduced the missing-file HTML-prefix defect with a failing memory-VFS test.
  Deferred header delivery until the extractor produces an event, while retaining
  pre-input budget admission and accounting for the retained header bytes.
- Workspace tests: 63 passed, zero failures, skips or cancellations. The
  independent injected source failure preserves error identity, invokes cleanup
  and permits a full retained-budget reservation afterward.
- Workspace lint and both source/test TypeScript checks passed. A generator
  fixture initially failed `require-yield`; corrected the fixture and reran the
  complete workspace lint and tests successfully.
- The maintained selected Safe Bash build closure passed, including its native
  build/postbuild scripts. No root build suffix or broad unit/lint gate was run:
  implementation changes are confined to the UnRTF command workspace.
- Fresh public artifacts were staged, packed and installed offline with scripts
  disabled in an external consumer. Maintained UnRTF runtime and strict NodeNext
  declaration fixtures passed, including a declaration run without skipLibCheck.
  No private command workspace was installed. Safe Bash's aggregate artifact
  still declares unrelated external dependencies; this is not an aggregate
  zero-dependency claim.
- Installed CLI and SDK missing-file results matched byte-for-byte, status 1
  with empty stdout. Captured and inspected a readable terminal screenshot using
  the repository screenshot tool against the installed command.
- Full GNU compatibility remains incomplete as listed above. Actual non-Node
  engines, checkpoint/replay, upstream personality variants and picture output
  rollback were not executed and are not counted as passes.
- Local commits: none. Remote-main delivery: none. Releases: none. No command
  package publication occurred. Temporary staging, tarballs, consumer and
  screenshot evidence were purged after this receipt.
