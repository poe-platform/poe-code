# pptx

Pending package README content; this file does not authorize or change a README.
The package is currently a private TypeScript ESM workspace, version 0.0.1.

Create, inspect and edit presentations through explicit byte/capability inputs.
The model and registered command engine share document operations. Neutral model
members retain spellings such as `core_properties` and `text_frame`. There is no
standalone binary or implicit host filesystem, network, native runtime, clock,
identity or font discovery. No environment variables are read.

```ts
import { Presentation, type ByteSink } from "pptx";

declare const output: ByteSink;
const presentation = await Presentation();
presentation.core_properties.title = "Coastal survey";
// output is an explicit caller-owned ByteSink.
await presentation.save(output);
```

Package entry points are `pptx` and `pptx/bytes`, with runtime ESM and TypeScript
declarations. The bytes entry exports `readBinary` and `writeBinary`; raw transport
alone does not validate or atomically publish a presentation. There are no public
deep imports. See [the complete export catalog](sdk-exports.md).

[Usage](usage.md) supplies create/read/edit, image, merge, template and virtual
`.sh` examples, exact configuration fields/defaults, capability callbacks, common
flags/selectors, JSON/exit behavior and unsupported features. Its configuration
section is part of this draft README content: include it in full when publishing
this draft rather than omitting exposed options. [Byte transport](package-usage.md)
adds per-transfer options and ownership/publication semantics.

The command engine requires explicit byte/archive/XML/relationship budgets,
argument and output-message ceilings, read authority and publication callbacks.
The model supplies bounded defaults documented in Usage; caller overrides must
provide complete groups. Optional context fields supply author, timestamp,
cancellation and admitted font metrics. CLI limits only lower trusted ceilings.

Complete public API and rendering fidelity are not claimed. Rendering, native
application automation, external fetches, macro/script execution and arbitrary
model evaluation are unsupported. Check command-specific schema/capabilities
before edits; preservation-only content does not imply editing support.

Maintained development commands from the repository root:

```sh
npm run build:workspaces -- --workspace=pptx
npm test --workspace=pptx
npm run lint --workspace=pptx
```

Distribution includes emitted runtime/declarations, package metadata and standalone
license notices. Tests, source research and disposable QA fixtures are not shipped;
unit tests do not download content. The package is MIT licensed; retain LICENSE
and THIRD_PARTY_NOTICES.txt with distribution. This draft awaits README permission.
