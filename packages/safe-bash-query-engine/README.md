# Shared structured queries

The internal structured-query engine keeps jq and the restricted yq profile on
the same parser, decimal values, interpreter and bounded query sessions. It
preserves streaming order, cooperative cancellation and UTF-8 byte accounting
without requiring the Node.js `Buffer` global. Queries support recursive and
lexically scoped `def` filters, `test`/`match` regex queries, capture-based
`sub`/`gsub` replacements, flagged `scan`/`split`/`splits`, membership and `INDEX`
lookups, lazy `isempty`/`nth` selection, `pick` projections, repeated
`combinations`, Unicode `explode`/`implode`, basic math including `fabs` and `sqrt`, `path` extraction, the jq 1.6
`leaf_paths` alias for `paths(scalars)`, and UTC
`gmtime`, `mktime`, `strftime`, and `strptime` date conversions. Date formats use
English names and POSIX format directives; `strftime` takes one format argument,
as in jq. `strflocaltime` formats timestamps or broken-down local dates in the
host timezone, including daylight-saving offsets. Zone names use the runtime’s
English timezone data. `todate` and `fromdate` alias the ISO-8601 conversions.

`env` and `$ENV` read only the environment supplied by the command context;
standalone query sessions default to an empty environment.

Use `structuredCommands` from `@poe-platform/safe-bash` and `yqCommands` from
`@poe-platform/safe-bash/commands/yq` to register commands. This private
workspace is bundled into Safe Bash and does not need a separate installation.
