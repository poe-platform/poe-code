# xq command workspace

## Ownership and compatibility

Revalidated at `d0d1eac6e9`: `safe-bash-command-xq` already owns the async
XML-to-JSON handler and the synchronous evaluator. Safe Bash retains the
`commands/xq`, `commands/xml`, and root export routes. The XML family composes
xq with xmllint; default inventories and replacement policy stay unchanged.

The private dependency graph is contracts/IO/XML/query engines → jq/xq
commands → Safe Bash. xq reuses jq's execution pipeline and the shared XML
engine; neither depends back on Safe Bash. All these workspaces remain private,
with no external runtime dependencies or independent publication. The existing
parent packaging route bundles code and rewrites declarations into the shipping
artifact. Existing workspace admission, lockfile, and build edges already cover
this extraction.

## Completion work

- Preserve existing XML conversion, jq flags/statuses, UTF-8 operand policy,
  streams, cancellation, and explicit resource limits.
- Move direct xq tests into its owning package; retain Shell integration tests.
- Export the command's limits type from the root alongside its factory/options.
- Add maintained isolated packed runtime and strict NodeNext consumers for xq.
  Check factory/error identity, canonical byte argv with a negative control,
  invalid byte operands through VFS scripts, pipes, cancellation/stream cleanup,
  collision/replacement policy, and explicit limits.
- Run selected workspace builds and fresh xq unit/lint/type checks, the XML Shell
  integration suite, package boundary tests, and package-lint gates.
- Package and install only public tarballs in an isolated consumer; deny private
  package resolution. Execute the xq fixture on Node and in a Buffer-free portable
  realm for browser/workerd conditions, and typecheck strict NodeNext declarations.

No output or help change is intended, so screenshot verification is not required.
