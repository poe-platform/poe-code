# Shared structured queries

The internal structured-query engine keeps jq and the restricted yq profile on
the same parser, decimal values, interpreter and bounded query sessions. It
preserves streaming order, cooperative cancellation and UTF-8 byte accounting
without requiring the Node.js `Buffer` global. Queries support recursive and
lexically scoped `def` filters, `test`/`match` regex queries, capture-based
`sub`/`gsub` replacements, flagged `scan`/`splits`, membership and `INDEX`
lookups, lazy `isempty`/`nth` selection, `pick` projections, repeated
`combinations`, Unicode `explode`/`implode`, basic math including `sqrt`, and UTC
`gmtime`, `mktime`, `strftime`, and `strptime` date conversions. Date formats use
English names and POSIX format directives; `strftime` takes one format argument,
as in jq. `todate` and `fromdate` alias the ISO-8601 conversions.

Use `structuredCommands` from `@poe-platform/safe-bash` and `yqCommands` from
`@poe-platform/safe-bash/commands/yq` to register commands. This private
workspace is bundled into Safe Bash and does not need a separate installation.
