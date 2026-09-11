# SafeJS CLI help startup

The combined unit gate timed out five CLI help entrypoint cases at their existing five-second limit. A focused baseline passed but spent 3,521 ms initializing the first help import, because the entrypoint eagerly loaded execution modules.

- Keep public CLI options, help text, direct execution detection, and broken-pipe behavior intact.
- Move execution code into a private runtime module loaded only for script execution or error classification. Help does not initialize the interpreter.
- Preserve all real entrypoint cases and their deadlines. Add a failing import-boundary regression before changing production code, plus a short-help broken-pipe check.

Validation: the import-boundary regression failed before the change. Existing CLI and filesystem configuration checks passed with the entrypoint checks (86 tests); the final entrypoint file passed 13 tests in 42 ms, compared with the original 11 tests in 4,172 ms. The normal workspace build and root suffix stages passed. Emitted CLI declarations retain the public option exports and resolve the runtime declarations. Fresh native help invocations completed in 234 ms and 73 ms; a real temporary script returned 7 through the built CLI. The help screenshot was rendered and inspected. Independent review approved the change. Repository-wide lint and the combined maintained unit gate follow in the coordinating task.
