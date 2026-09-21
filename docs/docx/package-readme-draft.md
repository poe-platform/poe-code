# docx

README draft for the private TypeScript ESM package. Package README publication
awaits explicit permission.

The private workspace exposes bounded package admission, inspection, text and
structure editing, typed utility batches, immutable Image/URI values and a
bounded style/formatting model. It includes an async Document factory and bounded live table, section, review,
settings and drawing owners. It is not a Word renderer or complete public model API. [Usage](usage.md) documents verified imports, command injection,
all operation schemas/options, limits, environments and output safety;
[acceptance](acceptance-matrix.md) records current read/edit/preserve/reject levels.
The API and publication boundaries remain qualified subsets. Applying this draft
to a package README requires explicit permission and is pending.

The following low-level archive example is distinct from utility operations:

```typescript
import { readArchive } from "docx";

const archive = await readArchive(inputBytes, {
  signal: controller.signal,
  limits: {
    maxArchiveBytes: 64 * 1024 * 1024,
    maxEntryBytes: 64 * 1024 * 1024,
    maxTotalBytes: 256 * 1024 * 1024,
    maxMembers: 10000,
    maxPathBytes: 4096,
    maxDepth: 256,
    maxExtraBytes: 65535,
    maxCommentBytes: 65535,
    maxRetainedBytes: 512 * 1024 * 1024,
    chunkSize: 65536
  }
});

for (const member of archive.members) {
  // member.name, member.bytes, member.directory, member.modified
}
```

`inputBytes` is a `Uint8Array`, including a Buffer. Supply a real AbortSignal and
all limits explicitly. These are host ceilings; this low-level reader has no
operation-level overrides, implicit defaults, environment variables or config
files. It has no filesystem or networking authority. Local workspace imports
are supported; the package is private and has no published installation promise.

| Option             | Meaning                                                                     |
| ------------------ | --------------------------------------------------------------------------- |
| `maxArchiveBytes`  | Compressed container byte ceiling before copying                            |
| `maxEntryBytes`    | Declared and actual expanded bytes per member                               |
| `maxTotalBytes`    | Aggregate expanded member bytes                                             |
| `maxMembers`       | Central directory member count                                              |
| `maxPathBytes`     | Raw and decoded UTF-8 path bytes, also bounded by ZIP fields                |
| `maxDepth`         | Slash-separated path components                                             |
| `maxExtraBytes`    | Extra field bytes per local or central header                               |
| `maxCommentBytes`  | Archive/member/Unicode-comment bytes                                        |
| `maxRetainedBytes` | Conservative owned-buffer admission budget                                  |
| `chunkSize`        | Requested processing bytes; 512 through 1048576, capped at 65536 internally |

Limits are safe integers. Metadata byte ceilings may be zero; other capacities
must be positive. Retained admission reserves four times the input byte count,
two processing chunks, 64 KiB of fixed decoder workspace and the aggregate
declared expansion. This covers input,
parser copies, metadata scratch and decoded buffers conservatively; it is not
process RSS isolation. JS objects and decoded name strings are additionally bounded by archive bytes
and member/path limits.

The reader accepts stored and raw-deflated members, classic ZIP and bounded
ZIP64, signed/unsigned data descriptors, admitted UTF-8/legacy names and metadata.
It rejects encrypted/multi-disk archives, unsupported flags/methods, malformed or
overlapping headers, gaps, prefixes, trailing data, CRC/expansion disagreements,
duplicate effective names, traversal/absolute paths, backslashes, colons and
symlinks. Directory records remain explicit empty members. ZIP validation does
not establish OPC relationship validity, XML safety or a valid Word document.

Member order follows the central directory. Dates represent the admitted
metadata timestamp, with DOS fields interpreted in UTC. Input bytes and limits
are snapshotted before suspension. Returned byte buffers are caller-owned and
independent; their mutation cannot affect another member or the supplied input.

`readArchive` always returns a Promise. Neutral errors expose stable `code`:
`InputTypeError`/`InvalidValueError` use `usage`, `InvalidContainerError` uses
`invalid-container`, `ResourceLimitError` uses `limit-exceeded`, and
`CancellationError` uses `cancelled`. Diagnostics exclude member names/content.

Local workspace checks (not runtime dependencies):

```sh
npm run build:workspaces -- --workspace=docx
npm test --workspace=docx
npm run lint --workspace=docx
```

Compression uses the existing shared portable incremental codec. There is no
native compression fallback. XML parsers and memory filesystems used by original
unit assertions are development dependencies only.

## Work with document content

| Need                                  | Available bounded surface                                    |
| ------------------------------------- | ------------------------------------------------------------ |
| Read text and structure               | text get, inspect, tables list, images list, properties list |
| Replace text while keeping runs       | text replace with explicit first/all/occurrence              |
| Edit tables, styles and page settings | declared resource set/add/remove operations                  |
| Fill tagged templates                 | template apply with typed record data                        |
| Automate ordered edits                | version-1 typed batch with one publication                   |
| Discover support                      | schema, help and capabilities; rejected routes stay visible  |

Use the built local `docx` ESM import. There is no standalone bin or public registry
installation promise; root `poe-code/docx` is not exported. For a granted shell,
resolve createDocxCommand/docxCommands from the current local
`@poe-platform/safe-bash/commands/docx` and explicitly inject the document engine.
No command registration grants filesystem authority.

A checked original memory-only model example:

```js
import { Document } from "docx";
const document = await Document(undefined, {
  timestamp: new Date("2026-09-21T12:00:00Z"),
  author: "Surveyor"
});
document.add_paragraph("Harbor notes").add_run(" — checked").bold = false;
let saved;
await document.save({
  write: async (bytes) => {
    saved = bytes.slice();
  }
});
const reopened = await Document(saved);
```

Fields and pages are stored caches; no calculation or rendering. Utility direct
insertion supports PNG/JPEG, while bounded model add_picture supports the five
characterized raster formats. Static SVG utility insertion requires explicit
validated raster fallback. Protection is respected; signed ordinary mutation
rejects, and explicit signature stripping never claims verification or signing.
There are no product environment variables or ambient filesystem/network/font/
clock/identity inputs. Optional native schema QA prerequisites are test-only.
See [usage](usage.md) for every option/schema, exact model context, document and
archive limits, explicit sinks, output collision/alias/partial-output rules,
exit statuses and current runtime qualification. Full Word/OOXML compatibility,
whole-public-API acceptance and renderer fidelity are unqualified.
