# docx

Private ESM workspace for DOCX admission, inspection, editing and
publication. It does not render Word documents and has no standalone binary.
`RGBColor(red, green, blue)` supports factory calls and `new`, with immutable
components and the `RGBColor.from_string(hex)` helper.

```js
import { parseDocxArguments, getDocxDiscovery } from "safe-bash-docx-engine";

const encode = value => new TextEncoder().encode(value);
const invocation = parseDocxArguments(["schema", "text", "replace"].map(encode));
console.log(getDocxDiscovery(invocation).data);
```

Formatting values support factory and constructor calls: `RGBColor(255, 0, 17)`
and `new RGBColor(255, 0, 17)`, or `Inches(1)` and `new Inches(1)`.
`Length`, `Emu`, `Inches`, `Pt`, `Cm`, `Mm`, and `Twips` retain immutable values
and unit accessors. Both length invocation styles support `instanceof` against
their helper and `Length`; RGB colors support `instanceof RGBColor`.

[Usage](../../docs/docx/usage.md) covers imports, explicit Safe Bash registration,
selection, mutation, and publication. Generated `help` and `schema` describe
operation arguments. The [test index](../../docs/docx/acceptance-matrix.md) links
to maintained regressions; the [specification](../../docs/specs/docx.md) describes
the proposed contract.

## Configuration and environment

No product environment variables or configuration files are exposed. Host
`ArchiveContext` supplies `signal` and optional `limits` and `budget`.
Resources are unlimited by default. Each limit is optional; setting one leaves
omitted resources unlimited. Command engines accept optional `limits` and
`documentLimits`; I/O context may
provide `registerCleanup`. Archive limits are `maxArchiveBytes`, `maxEntryBytes`,
`maxTotalBytes`, `maxMembers`, `maxPathBytes`, `maxDepth`, `maxExtraBytes`,
`maxCommentBytes`, `maxRetainedBytes`, and `chunkSize`.
The [usage guide](../../docs/docx/usage.md#host-limits-and-publication) describes
host limits and document budgets. CLI `--limit NAME=VALUE` uses the same document
settings as the SDK and can raise or lower an earlier setting. Capabilities lists
finite limits; resources omitted from that list are unlimited. Template repeats
use `templateRepeatDepth` and `templateRepeatItems` in the document budget; both
default to `Infinity` and accept `--limit` overrides.

Filesystem and publication authority must be explicitly supplied. Linked content
is inert; no ambient filesystem, network or native Office process is acquired.
Test-only `DOCX_SCHEMA_ROOT` and pinned `/usr/bin/xmllint` are required by the
optional schema research checks, not by runtime operations.
