# Typed table QA

Execute as an agent procedure; this is not an executable QA script.

1. Read the root and safe-bash AGENTS instructions, the frozen reference
   profile and `docs/specs/csvkit-table-inference.md`. Preserve unrelated edits
   and staging. Do not commit, push or publish.
2. Replay source probes with CPython 3.14.2 and the existing hash-pinned lock,
   in the frozen C/UTC reference environment. Native probing is development
   evidence only; canonical tests and product execution never invoke Python.
3. Reproduce a new discrepancy with an original failing regression before
   editing code. Use in-memory inputs and virtual files. Compare exact stdout,
   stderr, status and effects; explicitly label unsupported cases.
4. Run `npm run lint --workspace=@poe-code/csvkit`,
   `npm run test --workspace=@poe-code/csvkit` and
   `npm run build:workspaces -- --workspace=@poe-code/csvkit` uncached.
5. Independently stress the actual safe-bash registration with
   `node --import tsx --test packages/safe-bash/tests/commands/csvkit*.test.ts`.
   Check Number/Text inference, null-policy operand consumption, VFS input
   preservation, byte-fragmented input and cooperative failed-stream cleanup.
   Re-run the independent tests after rebuilding the csvkit workspace, since
   safe-bash imports the public built SDK.
6. Capture and inspect a terminal screenshot of the actual registered
   `csvformat -U 2` invocation through an in-memory Shell host. Store generated
   adapters and screenshots in `out`; purge only this procedure's evidence
   after inspection. No screenshot tests.
7. Report passing checks separately from blockers. Existing skipped/todo
   encoding cases are not passes and do not qualify table inference. Temporal
   parsers, header-warning provenance, additional locales, broader typed
   command paths and unmeasured Decimal cases remain explicit blockers.
