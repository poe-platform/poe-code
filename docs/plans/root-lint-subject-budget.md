# Root lint subject budget

Full `npm run lint` stopped after 12,000 subjects with `subject cap`, zero lint
errors, and zero warnings. The repository now contains approximately 15,900
JavaScript and TypeScript files. The root guard's maximum prevented completing
the maintained repository lint route.

Raise the default and maximum subject count to 20,000. Retain the existing
individual/aggregate byte limits, metadata operation limits, directory limits,
and fail-closed handling of incomplete selections. No subjects are excluded.

A memfs regression test first reproduced refusal of a 16,000-subject budget.
It checks admission with that bounded budget and rejection above the maximum.
Existing low-cap tests continue to verify incomplete-selection reporting.

Validate with the full lint guard test file, root lint stress tests, and
`npm run lint`. This fix accompanies the separately committed temporary Safe
Python test quarantine needed to unblock the release.

Verification: all 280 lint guard unit tests and both lint stress tests pass.
The stable full `npm run lint` completes with 13,963 linted files, zero errors,
zero warnings, passing type contracts, and passing workflow lint. An earlier
parallel scan correctly refused directory drift during native Safe Bash tests;
the final scan ran after that filesystem-changing stage completed.
