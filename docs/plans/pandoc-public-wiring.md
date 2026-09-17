# Pandoc public package wiring

Scope: expose the original SDK and explicit virtual-bash plugin through the root
package. Preserve private workspace identities, agentCommands and historical data.

1. Add original failing public export, type-resolution and in-memory bundle checks.
2. Publish a portable SDK/plugin graph with maintained bundling and exports.
3. Exercise explicit registration, collisions and conversion through public entries.
4. Run selected workspace build closure, package checks, full npm test and root lint.
5. Record evidence under docs/pandoc; commit verified owned files on main, no push.

Initial tests: three failures reproduced the missing root SDK export, absent
portable converter build and unresolved public SDK types. The plugin already
had a root export; its Node-only entry is replaced with the portable graph. Existing pipeline edits
are unrelated and will not be staged.

## Maintained verification and manual QA

- Execute `npm run build:workspaces -- --workspace=virtual-bash` for the declared
  dependency closure, then Pandoc workspace lint/typecheck and test scripts.
- Execute `npm run build`, `npm test`, and `npm run lint` for integration. Do not
  replace these routes with task inventories or root-only tests.
- Execute the public imports/example in docs/pandoc/public-wiring.md against built
  root exports; test collision preflight and explicit replacement with the shell.
- Deny ambient fetch in a fresh Node process before importing the SDK and converting
  original in-memory text. Inspect converter static import graphs and the reachable
  canonical core graph for native filesystem/child-process engines.
- Execute `npm pack --dry-run --ignore-scripts --json`; check both exported runtime
  files, both declaration entries and live converter chunks in the file inventory.
  Check that unbundled private Pandoc JavaScript is absent.
- Record actual outcomes under docs/pandoc. No CLI rendering changes are made;
  existing command output and agentCommands registration remain unchanged.

Current results: selected closure, Pandoc checks, full build, repository lint,
focused public consumers and manual runtime/pack checks pass. Full npm test is
pending. Auxiliary repository package lint validates two missing README files;
no README edits are authorized. Initial invalidated full-test run was stopped
and restarted after build completion; its failures are not passes.
