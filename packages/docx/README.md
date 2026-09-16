# docx

Private ESM workspace for bounded DOCX admission, inspection, editing and
publication. It does not render Word documents and has no standalone binary.

```js
import { parseDocxArguments, getDocxDiscovery } from "docx";

const encode = value => new TextEncoder().encode(value);
const invocation = parseDocxArguments(["schema", "text", "replace"].map(encode));
console.log(getDocxDiscovery(invocation).data);
```

[Usage](../../docs/docx/usage.md) covers public imports, safe-bash registration,
selection, mutation and publication. The [operation register](../../docs/docx/usage-contracts.json)
and generated `help`/`schema` describe all operation arguments and configuration.
[Acceptance evidence](../../docs/docx/whole-api-acceptance.md) distinguishes
qualified behavior from declared APIs.

## Configuration and environment

No product environment variables or configuration files are exposed. Host
`ArchiveContext` supplies `limits`, `signal`, and optional `budget`.
Command engines accept `limits` and optional `documentLimits`; I/O context may
provide `registerCleanup`. Archive limits are `maxArchiveBytes`, `maxEntryBytes`,
`maxTotalBytes`, `maxMembers`, `maxPathBytes`, `maxDepth`, `maxExtraBytes`,
`maxCommentBytes`, `maxRetainedBytes`, and `chunkSize`.
[Resource accounting](../../docs/docx/resource-limits.md) describes all document
budget options. CLI `--limit NAME=VALUE` lowers host ceilings only.

Filesystem and publication authority must be explicitly supplied. Linked content
is inert; no ambient filesystem, network or native Office process is acquired.
Test-only `DOCX_SCHEMA_ROOT` and pinned `/usr/bin/xmllint` are required by the
optional schema research checks, not by runtime operations.

## Development

Run `npm test --workspace=docx` and `npm run lint --workspace=docx` from the
repository root. `npm run test:schemas --workspace=docx` runs opt-in schema checks.
