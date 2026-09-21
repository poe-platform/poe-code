# Current ODS/SXC independent review

Run this procedure from the repository root against the candidate being delivered.
This review uses original in-memory ZIP fixtures and source-derived expectations;
it does not execute a native utility inside unit tests or access external links.

1. Inspect authenticated `out/ssconvert-lifecycle/gnumeric-1.12.61/plugins/openoffice/openoffice-read.c`, especially `oo_attr_bool` and the typed-value branches of `oo_cell_start`.
2. Run `npx vitest run packages/ssconvert/src/codecs/odf-current-stress.test.ts packages/ssconvert/src/codecs/odf.test.ts`.
3. Run maintained workspace lint, unit and build checks using the uncached task routes selected by the integration owner.
4. Independently compare boolean lexical variants and malformed optional clock fields against the separately captured native oracle profile when available. Preserve diagnostics as well as values.
5. Review output records and assert no host/network calls for attacker namespace attributes and external drawing links; validate shared-engine and virtual-command delivery separately.

## Verified review results

The independent reviewer reproduced two defects before modifying the importer:

- Noncanonical boolean spellings were dropped, or caused a later numeric attribute to win. Released `oo_attr_bool` treats case-insensitive `false` and exact `0` as false, and other spellings as true. Two original regressions failed before the repair.
- A valid date with a malformed optional hour or minute yielded numeric `NaN`; released `sscanf` retains the successfully scanned date when fewer than six fields parse. One original regression failed before the repair.

After the fixes, seven independent tests and twelve existing ODF tests passed (19 total). Negative controls additionally verify renamed namespace prefixes, untrusted namespace attributes, a sparse 10,000-column empty repeat, materialized-cell budget rejection, negative repeat rejection, pre-aborted cancellation identity and a one-unit work budget rejection.

Focused ESLint on the importer and independent test passed. The maintained
`npm run lint --workspace=@poe-code/ssconvert` route also completed successfully,
including package-wide ESLint and both production/test TypeScript checks.
The reviewed importer SHA-256 was
`457ea623c1c0d68e2335e6b6aa8041e8040d21a015d07c43c896cf07024d03d6`;
the independent test SHA-256 was
`5e082d0456676851e69990dd1d06ba0914cba274cabf479a583742f50745cba0`.

These are deterministic semantic controls. Timings from the unit runner are not a performance qualification. Fixtures remain entirely in memory; no unit test spawns a native process, queries an LLM or writes fixture files.

## Remaining unverified cells and limits

- This independent review has no separate native execution result; its expectations are mapped to authenticated reader source. Native dependency/plugin/locale measurements belong to the integration owner's oracle report.
- The full unsigned and permissive `sscanf` lexical surface remains unmeasured: signed clock fields, unsigned overflow, hexadecimal numeric strings, date suffixes, whitespace and numeric prefixes.
- Conditional formats, validations, chart rendering, filters, print rendering, named-formula export and arbitrary extension diagnostics are not independently qualified here. Retained records do not establish semantic parity.
- Runtime realms, original/checkpoint/replay execution and virtual CLI/SDK boundaries are delegated to integration verification and are not passes from these codec tests.
- Mid-expansion cancellation and rollback of completed output are not independently measured by this suite; pre-aborted cancellation is verified.
- No broad repository gate, release or publication is established by the focused 19-test result.
