# PDF parser API contract review

Status: contract review performed; full task acceptance remains blocked by the
qualification findings below. This is a working-tree receipt, not publication.

## Validated correction

`getPdfCommandGate` used property-key coercion to validate its runtime command
argument. An object with `Symbol.toPrimitive` returning `pdfinfo` was accepted
and retained as the returned command, violating the documented command/error
contract and executing caller coercion. A new in-memory control failed with
“Missing expected exception” while the other 163 controls passed. An explicit
string check now rejects coercible objects, boxed strings and symbols with
`ARGUMENT`, without invoking coercion. Valid string calls and cancellation
precedence are unchanged. No abstraction or dependency was introduced.

## Review observations

The capability and requirement tables are frozen and derive decisions from
engine-owned evidence. Inspection, extraction and lossless rewriting have
distinct requirements; local controls cannot grant mature qualification.
There is no caller override or host acquisition in this contract layer.
The portable source closure imports first-party modules only; the opt-in Node
crypto adapter remains separate. Recovery catches syntax failures specifically,
rather than absorbing quota/cancellation failures. Existing controls exercise
byte ownership, cumulative quotas, cancellation and partial semantic profiles.
No test-supported simplification of the contract layer was identified.

## Unresolved findings blocking full acceptance

- Parser-consuming Safe Bash artifacts have not been admitted, source-bundled
  or qualified through installed runtime/declaration consumers. The current
  conditional consumer controls bundle parser source in memory, rather than
  validating installed Safe Bash artifacts.
- Browser/workerd consumer tests run in Node VM realms. Actual browser and
  workerd execution is unverified; those controls cannot establish runtime
  qualification.
- Mature feature qualification remains incomplete, including filtered index
  integration, encrypted document interpretation, complete font/content/layout
  profiles and graph-aware lossless rewriting. No capability is `qualified`.
  pdfinfo/pdftotext/qpdf must remain blocked; admission-only pdftotext behavior
  does not discharge extraction gates.

These findings are already reflected in the capability matrix and API-contract
acceptance plan. They remain blockers, not passes or a mature-parser completion
claim. No external parser adoption or source adaptation was performed.

## Verification after correction

- `npm run test --workspace=pdf-parser`: 164 passes; zero failures, skips or
  cancellations, including the three conditional source-bundle controls.
- `npm run lint --workspace=pdf-parser`: ESLint and source/test typechecks passed.
- `npm run build:workspaces -- --workspace=pdf-parser`: maintained selected
  workspace runtime/declaration build passed.
- `npm run lint:packages`: all 18 rules passed.
- `git diff --check`: passed.

No visual CLI change, native oracle process, fixture file, temporary log or
snapshot format change was introduced. Other contributors' changes were
preserved. Local commits: none. Remote-main delivery: none. Releases: none.
