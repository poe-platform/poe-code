# Shared structured queries

The internal structured-query engine keeps jq and the restricted yq profile on
the same parser, decimal values, interpreter and bounded query sessions. It
preserves streaming order, cooperative cancellation and byte accounting.

Use `structuredCommands` from `@poe-platform/safe-bash` and `yqCommands` from
`@poe-platform/safe-bash/commands/yq` to register commands. This private
workspace is bundled into Safe Bash and does not need a separate installation.
