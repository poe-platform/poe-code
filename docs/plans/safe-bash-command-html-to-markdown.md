# html-to-markdown private command extraction

The private `safe-bash-command-html-to-markdown` workspace owns input parsing,
retained tree budgets and Markdown rendering. Safe Bash retains the public
`@poe-platform/safe-bash/commands/html-to-markdown` facade and composition.
No standalone package is published and default registration remains unchanged.

Source ownership was revalidated on remote main `6e0997b2ea`: the extraction
already existed, including subsequent malformed HTML and work-budget fixes.
This completion moves command-only rendering, repair, adversarial and limit
regressions to the private owner. Shell/VFS integration tests stay in Safe Bash.
Canonical contracts and filesystem errors come from the existing leaf packages;
there is no dependency back to Safe Bash.

Validation gates:

- A failing boundary test before moving suites; maintained unit prerequisite DAG.
- Selected workspace build, command unit tests, source/test types and lint.
- Existing Shell input/output limits, cancellation, registration and IO regressions.
- Maintained memfs package assembly, followed by removal of every private workspace,
  strict NodeNext public declarations and real Shell conversion in the isolated graph.
- Package-lint and public export boundary checks before remote-main delivery.

Preserve all behavior assertions, command names, default limits, portable export
conditions, output byte accounting and canonical runtime identity. No visual CLI
output or help changes are planned.
