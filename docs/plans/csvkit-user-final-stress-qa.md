# Independent csvkit input lifecycle QA

This bounded review exercises the actual Safe Bash command registration with
in-memory sources and `MemoryFileSystem`. It does not measure native csvkit,
workbook, database, terminal or compression compatibility.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvkit-user-final-stress.test.ts`.
2. Verify each of the fourteen original executable names returns exactly its
   `2.2.0` version line, empty stderr and status zero, without advancing caller
   stdin or opening/reading a named file.
3. Feed `csvcut` empty chunks alternating with individual bytes of a UTF-8 CSV
   containing emoji and accented text. Supply no iterator `return` hook. Compare
   exact stdout, stderr and status, and count source advancement through EOF.
4. Abort `csvcut` while an owned named-source `next` is pending. Have cooperative
   `return` release that pending read with late data. Verify cancellation reason
   identity, zero output, one close including disposal, and a successful later
   invocation on the same shell.
5. Run `npx eslint packages/safe-bash/tests/commands/csvkit-user-final-stress.test.ts`.

These checks add no filesystem artifacts, native process, network, LLM or real
database work to canonical tests. They do not establish full-suite parity.
