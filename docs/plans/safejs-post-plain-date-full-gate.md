# Post-PlainDate full package gate

## Scope and source identity

Started after local commit bdbb921ec, including the existing uncommitted public
Temporal/Intl integration. This is a working-tree gate, not a clean-commit or
remote-main verification. No push, tag, release or issue closure is authorized
while the release hold remains in effect.

Command: `npm test --workspace=@poe-code/safe-js`.
Log: `/tmp/safejs-full-gate.UzTtCJ/full-test.log`.
Execution session: 29473, started in e5063d. Latest poll 8dd9ad confirms it is
still running. Do not restart based on an observation timeout.

Pre-run fingerprint (ee5fa7): 1497 files, SHA256
`509fab2a05186e8b8883790fa61e262b1f2e36e4b1a7fcea0bdcb89932da5178`.
Membership: every regular file recursively under packages/safe-js/src and
packages/safe-js/test, plus packages/safe-js/package.json, root package.json
and package-lock.json. Sort relative paths; hash each path, NUL, bytes, NUL.
Keep source unchanged during the gate and repeat the same fingerprint at its
end. Docs are outside this fingerprint.

All 100 filesystem type contracts passed. Unit execution is active; progress
markers are not final test counts or failure diagnoses. The earlier full gate
had two native Promise property-import failures, but this run's final result
must be read rather than inferred from that history.

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
