# Opaque objects and font inventory

Use `pptx objects list deck.pptx --json` for package-level opaque resources. Each row includes the original part URI, declared content type, kind, byte length, SHA-256, active-content reasons, owners, outgoing internal dependencies, missing targets and external relationships. Package inventory includes unreferenced recognized resources. It does not activate content or inspect nested payloads.

Use `pptx fonts list deck.pptx --json` for embedded font declarations and font parts. Declarations preserve the stored typeface, charset and pitch-family strings and regular/bold/italic/bold-italic bindings. Missing bindings are visible. Listing does not install a font or establish rendering rights.

Extract one listed resource and its relationship closure:

```sh
pptx objects extract deck.pptx --part /ppt/embeddings/object.bin --output-dir /output --json
```

The host must provide atomic multi-file publication; otherwise explicitly add `--allow-partial-output`. Existing outputs require `--force`. `--dry-run` validates without publication. Safe generated `.bin` names map back to original part URIs in the returned manifest; no embedded filename becomes a filesystem path. The output includes original relationship-part bytes, not a reconstructed executable package. External targets remain strings and are never downloaded.

These are package-wide reads. Object routes accept `--scope shared`; font listing accepts `--scope presentation`. Slide, shape and opaque location selectors are not supported by these routes; extraction takes the exact `--part` URI. `schema objects list`, `schema objects extract`, `schema fonts list` and `capabilities` describe the bounded routes. Structured results use the common JSON envelope and exit statuses. Unsupported object creation and live model access remain separate API gaps.

The SDK exposes always-async operations:

```ts
import { readObjects, extractObject, readFonts } from "pptx";

const inventory = await readObjects(admittedBytes, context);
const fonts = await readFonts(admittedBytes, context);
const extracted = await extractObject(
  admittedBytes,
  { part: inventory.objects[0]!.part },
  context
);
```

`context` supplies byte, archive, XML and relationship limits plus optional cancellation. `admittedBytes` is a `Uint8Array`; explicit byte streams and capability-scoped VFS inputs are also supported. `extracted.bytes` and each dependency's `bytes` are owned copies. The direct SDK returns bytes for the caller to publish; it does not write host files.

`activeContent` is conservative carrier/header metadata, not a malware verdict. Controls, web extensions, nested packages, fonts and 3D resources stay opaque. No program, font, rendering engine or network fetch is started. The live model properties and OLE insertion API are not implemented by these inventory operations.
