# csvcut independent stress QA

Execute the in-memory `packages/safe-bash/tests/commands/csvcut-stress.test.ts`
through Node's TypeScript test route after rebuilding the domain workspace.
The expectations follow released csvkit 2.2.0 `utilities/csvcut.py` and its
`cli.py` helpers; the source archive hash is pinned in
`docs/csvkit/reference-profile.json`.

Check exact stdout, stderr and status for empty input versus an empty header,
selector bypass on names-only execution, physical skip-lines before multiline
parsing, selected-value row deletion, repeated output cells, raw scalar text,
and numbering only emitted output rows. Verify names/no-header rejection occurs
before stdin acquisition. Run maintained narrow lint/typechecking after tests.
The streaming names case admits one complete 8192-byte CPython TextIO decode
window before checking early return and exactly-once source cleanup. A shorter
transport chunk can require additional reads to complete that frozen window;
names early return applies to parsed records, not individual transport chunks.

Do not infer complete csvkit parity from this scope. Input quoting modes 2, 4
and 5, native TTY behavior, driver profiles and service interoperability need
their own qualified evidence. Existing cancellation and cooperative-stream
cleanup suites remain separate required validation.
