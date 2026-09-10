# Temporal dependency reconciliation

## Scope

Commit the existing exact `temporal-polyfill` 1.0.4 runtime dependency and its
lock entries independently of the remaining Temporal integration. Committed
private year-month and month-day implementations already import
`temporal-polyfill/full/implementation`; leaving its declaration only in the
working tree makes those commits insufficient for a reproducible installation.
This reconciliation changes no dependency version or runtime implementation.

## Verification

- `npm ls temporal-polyfill temporal-spec temporal-utils --workspace=@poe-code/safe-js`
  succeeds: polyfill 1.0.4, spec 1.0.1, utils 1.0.2.
- Parsed manifest, lockfile and installed package versions agree exactly.
- A fresh Node process imports the actual `full/implementation` subpath;
  epoch-zero Instant formatting and February 2000 year-month length checks pass.
- `npm run lint:packages -- --rule bundled-transitive-npm-dep-unbundled --rule no-published-to-private-dep --rule imported-workspace-dep-unresolvable`
  passes all three selected rules across 71 packages.
- This is dependency/configuration reconciliation, not a code behavior change.
  The full package gate remains failing as recorded in
  `safejs-post-year-month-integration-gate.md`; these narrow checks do not
  supersede it or prove Temporal completeness.

## Delivery

Local commit only. The release hold remains in effect. Other uncommitted
integration and unrelated staged Safe Bash changes are excluded. No push,
release or issue closure is authorized by this dependency check.
