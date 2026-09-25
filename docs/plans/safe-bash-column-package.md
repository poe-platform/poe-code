# Column package extraction — issue 997

Move the existing column implementation without behavior changes into private safe-bash-command-column. Keep all public factories, limits, registration and runtime profiles intact. Extract the shared table-text record reader and budgets into private safe-bash-table-text-engine. Canonical diagnostics, escaping and yield helpers live in safe-bash-contracts and remain re-exported at existing paths.

Verify the new boundary with a failing characterization test, retain all existing column regression assertions, build the maintained dependency closure, run unit/type/lint and package-lint checks, and exercise isolated packed public exports with strict NodeNext declarations. Both workspaces are private, bundled using generic admission, with no independent publication or new runtime dependency. Commit and verify delivery to remote main before closing the issue.
