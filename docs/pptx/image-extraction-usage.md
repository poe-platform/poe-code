# Extract original image bytes

The `pptx` operation extracts selected image references without rendering them.
It preserves exact bytes, including SVG, vector and animated payloads. It never
fetches external images. Selected external-only references fail visibly.

```sh
pptx images extract deck.pptx --output-dir /images --json
pptx images extract deck.pptx --slide 2 --image 1 --output-dir /images --json
pptx images extract deck.pptx --scope notes --slide 2 --output-dir /images --json
pptx images extract deck.pptx --scope layouts --unique --output-dir /images --json
pptx images extract deck.pptx --sha256 HASH --output-dir /images --json
pptx images extract deck.pptx --unique --limit maxOutputs=20 --limit maxOutputBytes=10485760 --output-dir /images --json
pptx images extract deck.pptx --dry-run --json
pptx schema images extract --json
```

`HASH` is an exact lowercase 64-character SHA-256 digest. It filters within the
selected scope. An unmatched explicit hash fails. Selectors run before unique
grouping. Default scope is slides; notes, layouts, masters and shared scope are
explicit. Positions are one-based within their owner. An opaque `--select` token
is an alternative to scope/slide/image selectors.

Every occurrence produces an output by default: repeated references to one part
and distinct parts with identical bytes both remain separate. `--unique` groups
identical bytes and retains all selected source parts and occurrences in its
manifest. Names are `part-000001.png`, `part-000002.jpg`, and so on, using declared
content type rather than embedded filenames. Unknown or conflicting declarations
use `bin`. Names alone do not certify payload format or safety for rendering.

The version-1 JSON result identifies `images.extract`, reports affected outputs
and returns `data.outputs` entries with path, safe name, byte count, SHA-256,
content type, source parts and occurrence provenance. Dry-run validates limits and
selection without publishing. Output byte and file limits count emitted duplicate
resources unless unique mode was explicitly requested.

The SDK returns bytes and does no publication:

```ts
import { extractImages } from "pptx";

const files = await extractImages(
  admittedDeckBytes,
  {
    scope: "layouts",
    unique: true,
    maxOutputBytes: 10 * 1024 * 1024,
    maxOutputs: 20
  },
  context
);
// Each entry has name, bytes, sha256, contentType, sourceParts and occurrences.
```

`context` is the caller's existing explicit bounded selection/admission context.
The input is bytes, a bounded stream or a capability-scoped VFS descriptor.
Both SDK output limits are required positive safe integers. Returned bytes are
owned copies; no host path is inferred.

CLI publication requires an output directory and an adapter transaction. An
adapter without transactions requires explicit `--allow-partial-output`; a later
failure then reports only the completed outputs. Existing output files require
`--force`. Force does not waive validation, limits or transaction requirements.
Failures use common statuses: selection/unsupported 1, usage 2, publication 3,
limits 4 and cancellation 130. Schema and capabilities describe the currently
available operation; this operation does not implement the full live image model.
