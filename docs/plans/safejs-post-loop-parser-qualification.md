# Post-loop-parser qualification

## Integration gate

Runtime d4891dd09 includes both literal-member assignment targets and sloppy
`let` statement-body parsing. The maintained full package command is running
in session 69114:

```sh
npm test --workspace=@poe-code/safe-js -- --reporter=json --outputFile=/tmp/safejs-post-loop-parser-integration-results.json
```

All 100 filesystem type contracts passed (1ad151). The unit runner was confirmed
live by polling (64c8a2) and by process inspection (240bed, PID 60496, CPU 214%).
This is not a completed or passing full gate. Preserve this run; do not restart
it merely because its JSON reporter is quiet. Main runtime/test sources remain
unchanged while it runs.

## Independent language probes

Read-only public `run` probes compare strict native execution against guest
execution. No source changes were warranted by these results.

- Fifteen optional-chain cases match (313828): deletion, parenthesized chain
  boundaries, skipped computed/call arguments, `typeof`, nullish coalescing and
  receiver binding. This initial diagnostic uses JSON result comparison, so it
  is not evidence distinguishing undefined array entries from null entries.
- Thirty-two synchronous iterator-close cases match (d2e1ca), using deep strict
  comparison after structured cloning. The cross-product covers break, throw,
  return and labeled continue; close returning an object, number, null or
  throwing; and method versus getter acquisition of `return`.
- The corresponding 32 asynchronous iterator-close cases match (e7a3ca), using
  async iterators, async close methods and native async function execution.
  These compare completion results and close/getter effect logs. They do not
  test snapshot recovery or every async scheduling interaction.

The Promise own-property failures still require a safe admission policy; this
probe does not justify copying private host metadata. See
[the policy findings](safejs-host-promise-import-policy.md).

These are bounded qualification results, not full JavaScript conformance.
The previous full-gate failures remain unresolved until independently fixed
and verified. No push or release is authorized during the release hold.
