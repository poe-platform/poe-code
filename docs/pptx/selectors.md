# PPTX selectors

`readSelectionIndex(input, context)` reads presentation locations from explicit bytes, a byte source, or an explicitly supplied VFS capability. The context requires byte limits, archive limits, XML limits and relationship limits. It performs no implicit host file access or network requests. These are development-checkout APIs; no release is claimed.

```ts
import { readSelectionIndex, createBatchHandles } from "poe-code/pptx";

const index = await readSelectionIndex(bytes, context);
const [slide] = index.select({
  kind: "slide",
  position: { coordinateSystem: "one-based", value: 1 }
});
const matches = index.select({
  kind: "object",
  owner: slide!.part,
  name: "Heading",
  all: true
});
const sameObject = index.select({ token: matches[0]!.token });
```

The `slides`, `parts` and `objects` arrays are immutable snapshot inventories. Each record supplies its kind, ID, name, canonical part URI, scope, one-based display position, location and canonical token. Object records also supply their XML drawing kind in `objectType`. Slide positions follow the presentation's slide list; object positions follow depth-first XML order within their drawing owner. Part positions are local to their scope.

JSON numeric selectors must explicitly use `coordinateSystem: "one-based"` or `"zero-based"`. Names are exact and case-sensitive. The name `"7"` is a name, not an ID. Object simple selectors require an owner URI. IDs are canonical decimal strings and shape IDs are unique only inside their owner. Duplicate IDs inside an owner are invalid package content. Repeated names require `all: true`; otherwise `SelectionError.candidates` returns up to 20 locations.

The default scope is `slides`. Other scopes are `notes`, `layouts`, `masters`, `notes-master`, `handout-master`, `presentation` and `shared`; they require explicit selection. A part outside slide scope requires its scope, for example `{kind:"part", scope:"presentation", part:"/ppt/presentation.xml"}`. `all` never broadens scope. Unselected inventory reads may return empty arrays; `select` requires at least one match.

`decodeSelectionToken(token)` validates and decodes a canonical token without opening any input; adapters use it for early usage errors. Treat emitted tokens as opaque strings. Their canonical JSON contains `fingerprint`, `scope`, `owner`, `objectId` and `coordinateSystem: "identity"`. The fingerprint is SHA-256 of exact admitted ZIP bytes. Tokens cannot combine with simple selectors or scope/all flags. A token from modified package bytes fails with `stale-selection`, even when an object's stable ID survives the edit. Malformed selectors use `invalid-selection`; absent targets use `missing-selection`; duplicate matches use `ambiguous-selection`.

`createBatchHandles(index.fingerprint)` provides an invocation-local registry for a future typed batch executor. Register a newly created `Location` with `register(name, location)`, read it through `resolve(name, owner)`, and invalidate replaced/deleted objects with `invalidate(name)`. Registration rejects duplicate names and foreign fingerprints. Resolution rejects forward references, different owners and invalidated handles. A registry handle does not grant I/O authority, mutate the snapshot, or execute a batch. Batch execution and serialization remain unimplemented.

The optional shell adapter is exported from `poe-code/safe-bash/commands/pptx`.
Install it on a shell whose filesystem and limits you have explicitly configured:

```ts
import { pptxCommands } from "poe-code/safe-bash/commands/pptx";
import { createPptxCommandEngine } from "poe-code/pptx";

shell.use(pptxCommands({
  engine: createPptxCommandEngine({
    context,
    maxArgumentBytes: 8192,
    maxOutputBytes: 65536
  })
}));
await shell.exec("pptx inspect deck.pptx --slide 1 --shape Heading --all --json");
```

`inspect` supports `--slide`, `--shape`, `--part`, `--scope`, `--select`, `--all`
and `--json`. Use `-` as input for stdin. `--` terminates option parsing. Reads
do not modify the VFS. `help`, `version`, `schema [inspect]` and `capabilities`
describe this limited inspection profile; editing commands are not exposed.
The package-local workspace import is `pptx`; the root export wires the same SDK.

`createPptxCommandEngine({ context, maxArgumentBytes, maxOutputBytes })` exposes the same read-only command profile through the SDK. Its `execute({ args, signal, readInput })` method accepts an array of raw UTF-8 `Uint8Array` arguments, an explicit `AbortSignal`, and an asynchronous `readInput(path, maxBytes)` capability. It returns `{ exitCode, stdout, stderr }`, with both output fields as bytes. The supplied capability owns path/stdin interpretation; the engine never opens host paths itself. The read ceiling is the smaller byte/archive admission limit. The engine owns command parsing, selection, discovery schemas, result envelopes and exit-status classification. Invalid UTF-8, malformed selector tokens and invalid part URIs fail before input access. JSON diagnostic output stays within the configured output limit; the minimum supported output ceiling is 512 bytes.
