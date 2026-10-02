# DOCX command ownership

The private `safe-bash-command-docx` workspace owns byte argument parsing,
discovery, command execution, per-operation transport handlers and the Safe Bash
adapter. `safe-bash-docx-engine` retains reusable archive, XML, document model,
editing and semantic invocation validation. Pandoc continues consuming that
engine directly through its existing adapter; neither engine nor command depends
on Safe Bash.

The public `@poe-platform/safe-bash/commands/docx` facade, optional registration,
default engine, byte contracts, error identities and unlimited default budgets
remain unchanged. Both workspaces stay private. Existing generic packaging
bundles their code into the parent package, with no standalone publication or
new external runtime dependency. The internal SDK facade combines document APIs
and command APIs for command regression consumers without a reverse engine edge.

Validation:

- Reproduce missing frontend ownership with the boundary characterization before
  extraction; preserve existing command regression assertions as tests move.
- Build the selected command and Safe Bash closures through maintained workspace
  declarations; run command and engine unit, lint/type and package-lint gates.
- Verify packed public runtime and strict NodeNext declarations without private
  workspaces. Exercise built-in discovery, VFS scripts, pipelines, raw byte argv,
  canonical carrier/error identity, cancellation, replacement and explicit limits.
- Keep public usage and the maintained test index aligned with ownership.

No help text or command behavior is intentionally changed by this extraction.

Verification completed with 2,889 focused DOCX assertions across the command and
engine, 255 packaging/ownership assertions, workspace builds and lint/typechecks,
and isolated tarball runtime and strict NodeNext consumers. Packed browser and
workerd bundles also create and read documents without Node globals or external
runtime imports. Seven package-lint gates report no violations in the changed
packages; unrelated asset findings remain outside this scope. The optional full
repository ESLint attempt exceeded its configured 1 GiB heap, so it is not a
passing repository-wide lint result.
