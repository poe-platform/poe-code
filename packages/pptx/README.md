# pptx

Private ESM workspace for bounded PowerPoint package inspection, editing and
publication. It is not included in the published `poe-code` package. It has no
standalone binary and does not render presentations.

[Usage](../../docs/pptx/usage.md) covers creation, inspection, text, images,
tables, SDK examples and explicit safe-bash registration. Generated `help`,
`schema`, and `capabilities` describe operation arguments and supported behavior.
Schema declarations alone do not establish complete PowerPoint compatibility.

## Configuration and environment

No environment variables or configuration files are exposed. Filesystem,
publication, time, author and font metrics are explicit caller capabilities.
`PresentationContext` accepts `timestamp`, `author`, `fontMetrics`, `signal`,
and four limit groups. Supplying a group replaces its defaults:

- `limits`: `maxBytes`, `maxReads`, `chunkBytes`.
- `archiveLimits`: `maxArchiveBytes`, `maxEntryBytes`, `maxTotalBytes`,
  `maxMembers`, `maxPathBytes`, `maxDepth`, `maxPaxBytes`, `maxTextBytes`, `chunkSize`.
- `xmlLimits`: `maxBytes`, `maxNodes`, `maxDepth`.
- `relationshipLimits`: `maxBytes`, `maxParts`, `maxRelationships`.

`createPptxCommandEngine` requires `context`, `maxArgumentBytes`, and
`maxOutputBytes`. Context optionally supplies `validationLimits`: `maxBytes`,
`maxNodes`, `maxDepth`, `maxEntries`, `maxParts`, `maxRelationships`.
Execution supplies encoded `args`, `signal`, `readInput` and optional
`preflightOutput`, `publishOutput`, `publishOutputs` callbacks. Multi-output
publication requires a real atomic host transaction.

CLI `--limit NAME=VALUE` lowers trusted ceilings only: `maxBytes`, `maxNodes`,
`maxDepth`, `maxOutputBytes`, and `maxOutputs` for applicable extraction commands.
[Configuration defaults](../../docs/pptx/usage.md#configuration-and-limits) and
[byte transport options](../../docs/pptx/package-usage.md) document the complete
host and per-operation configuration. External links are never fetched implicitly.

## Development

Run `npm test --workspace=pptx` and `npm run lint --workspace=pptx` from the
repository root.
