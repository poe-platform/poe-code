# Native publication child execution QA

Unit tests verify execution limits, error identity, and successful output with a mocked child process. Execute the native process behavior separately:

1. Import `runCommand` from `scripts/verify-safe-publication.mjs` and run `/bin/sh -c 'exit 7'` with a normal native execution budget. Verify the rejection preserves exit code 7.
2. Run `/bin/sh -c 'while :; do :; done'` with a 50 ms deadline. Verify SIGKILL terminates the stalled process.
3. Run `/bin/sh -c "printf '%2000000s' x"` with a normal native execution budget. Verify ERR_CHILD_PROCESS_STDIO_MAXBUFFER bounds output above 1 MiB.
4. Store temporary execution evidence under `out`, inspect it, then remove only that evidence.
