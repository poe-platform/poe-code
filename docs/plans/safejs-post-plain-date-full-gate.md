# Post-PlainDate full package gate

## Scope and source identity

Started after local commit bdbb921ec, including the existing uncommitted public
Temporal/Intl integration. This is a working-tree gate, not a clean-commit or
remote-main verification. No push, tag, release or issue closure is authorized
while the release hold remains in effect.

Command: `npm test --workspace=@poe-code/safe-js`.
Log: `/tmp/safejs-full-gate.UzTtCJ/full-test.log`.
Execution session: 29473, started in e5063d, terminated with exit 1 in 7bfe26.

Pre-run fingerprint (ee5fa7): 1497 files, SHA256
`509fab2a05186e8b8883790fa61e262b1f2e36e4b1a7fcea0bdcb89932da5178`.
Membership: every regular file recursively under packages/safe-js/src and
packages/safe-js/test, plus packages/safe-js/package.json, root package.json
and package-lock.json. Sort relative paths; hash each path, NUL, bytes, NUL.
Keep source unchanged during the gate and repeat the same fingerprint at its
end. Docs are outside this fingerprint.

All 100 filesystem type contracts passed. Final report (411d47): 26,777 tests
passed, four failed and 41 skipped, across 1,111 files (1,106 passed, three
failed, two skipped), in 1073.19 seconds. This is a failing package gate.

The post-run fingerprint matched the pre-run 1,497-file hash exactly (411d47).
Saved log SHA256:
`8bbb32efdf0d32e77c57be84d88e96a54118d073d442781179da6668d0ecc187`.

Failures:

- Both native Promise own-property import assertions in
  `interp/promise-import-properties.test.ts` returned undefined instead of the
  explicit string descriptor and user-symbol value. The admission-policy
  decision remains unresolved; do not blind-copy private host metadata.
- `run.completed-replay.test.ts`: the 128-draw completed replay case exceeded
  its 5,000 ms timeout.
- `test/ppr2-integration-adjudication.test.ts`: the `co` fresh-writer scenario
  exceeded its 5,000 ms timeout.

The timeout cases require isolated revalidation and cost investigation, not a
larger timeout or an assumption that they are unrelated. The source freeze is
now ended; later edits are outside this full-run qualification.

An unchanged isolated rerun of both timeout files (session 13916, terminal
268e30) passed all 27 tests in 11.92 seconds. This does not repair or dismiss
the full-run timeouts. Their cumulative replay/serialization cost and behavior
under suite contention remain to be investigated; no timeout was increased
and no test was removed.

## Parallel read-only findings

The native Promise import path still copies settlement, not own properties.
The pending admission-policy question is documented in
safejs-host-promise-import-policy.md. Do not copy arbitrary private host symbols
or remove failing tests to make the gate appear green.

A source-runtime Temporal reflection audit (153cde), compared with Node 26.4.0,
checked own string-keyed static/prototype descriptors, function names/lengths
and getter names/lengths for eight constructors. It omitted symbol keys and
caller/arguments, and did not test algorithms or all descriptor values.

- Instant lacks toZonedDateTimeISO.
- PlainDate lacks toPlainYearMonth, toPlainMonthDay and toZonedDateTime.
- PlainDateTime lacks toZonedDateTime.
- PlainYearMonth, PlainMonthDay and ZonedDateTime are absent.
- Duration and PlainTime have no missing checked members.
- No descriptor/name/length mismatches appeared for checked existing members.

The first audit snippet had an unmatched brace and was rejected (ab1859).
Controls (bbb07d) and the corrected, native-syntax-checked audit established
that this was a diagnostic typo, not a validated parser issue. No runtime code
was changed for it. Native comparison is supplementary evidence, not the
normative JavaScript definition or proof of completeness.
