---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---

# Mermaid renderer for safe-bash

Build a Mermaid-to-SVG and Mermaid-to-PNG renderer from scratch, exposed as an opt-in `mmdc` command, with zero external runtime dependencies and configurable light and dark themes.

## 1. What we're building

A first-party Mermaid renderer with its own implementation, layout engine, rasterizer, and visual design language. The command has the familiar shape of Mermaid CLI's `mmdc`; it does not claim complete Mermaid CLI or Mermaid language compatibility. Do not include competitor names or external inspiration attributions in maintained user-facing copy (`README.md`, `--help`, or error messages).

The first release renders flowcharts, sequence diagrams, state diagrams, class diagrams, and entity relationship diagrams to both SVG and PNG. Deliver flowcharts first (through both SVG and PNG pipelines and visual sign-off), then each additional diagram family behind passing acceptance tests and mandatory visual inspection of all generated PNG outputs. Publish a precise supported-syntax table for each family.

All parsing, layout, routing, glyph metric measurement, SVG serialization, 2D antialiased scanline rasterization, and PNG encoding are implemented locally. No Mermaid, Dagre, ELK, Resvg, Canvas, browser, subprocess, remote rendering service, or external font download at runtime. Development tooling and first-party safe-bash contracts are allowed; bundle first-party code into the existing publication boundary.

Initial output formats are SVG and PNG. PDF, ASCII output, Markdown extraction, animation, arbitrary HTML labels, external assets, clickable links, and full Mermaid compatibility are outside the initial scope. Unsupported constructs and unsupported formats produce explicit errors rather than disappearing from the output.

This document is planning only. It does not authorize implementation, commits, or publishing.

## 2. User-facing shape

### Command

```bash
mmdc -i diagram.mmd -o diagram.svg
mmdc -i diagram.mmd -o diagram.png
mmdc -i diagram.mmd -o diagram.png -s 2 -t dark
mmdc -i diagram.mmd -o diagram.svg -t light
cat diagram.mmd | mmdc -i - -o -
cat diagram.mmd | mmdc -i - -o - -e png > diagram.png
mmdc -i diagram.mmd -o diagram.svg -w 1200 -H 800 -b transparent
mmdc --help
```

Support `-i/--input`, `-o/--output`, `-e/--outputFormat` (`svg` | `png`), `-t/--theme` (`light` | `dark`), `-w/--width`, `-H/--height`, `-s/--scale` (positive scale multiplier for PNG rasterization, default `2` for crisp Retina/HiDPI output), `-b/--backgroundColor`, `-c/--configFile`, `-q/--quiet`, `-h/--help`, and `-V/--version`. Research the pinned Mermaid CLI contract before implementation and document deliberate differences.

Infer output format from `-e/--outputFormat` when supplied; otherwise infer from the `-o` extension (`.svg` or `.png`), defaulting to `svg` when `-o -` is used without `-e`. Reject conflicting `-e` and file extension combinations (for example `-e png -o out.svg`) with exit status 2.

Require explicit input and output operands initially; `-` selects stdin or stdout. Read and write through the command's virtual filesystem and streams. Successful rendering exits 0. Argument/configuration errors exit 2; source, filesystem, resource, and rendering failures exit 1. Diagnostics go to stderr; stdout contains only the rendered SVG text or PNG bytes when selected as the output.

Width and height are positive viewport dimensions (in CSS pixels before `-s/--scale` multiplication for PNG), with a computed `viewBox` and preserved aspect ratio. With neither specified, use the natural diagram bounds including padding. With one specified, calculate the other from the natural aspect ratio. They do not change graph topology or silently crop content.

Reject browser-specific options, CSS injection, unsupported output extensions/formats (such as `.pdf`), and upstream themes other than the documented light/dark modes. Help identifies the supported profile clearly.

### Tool settings and SDK

Expose `createMmdcCommand(settings)`, `mmdcCommand`, and `mmdcCommands` through `@poe-platform/safe-bash/commands/mmdc`. Register the returned command using the existing safe-bash custom-command API. Capture settings before asynchronous work so later caller mutation cannot change a render.

Proposed settings shape:

```ts
interface MmdcSettings {
  theme?: {
    mode?: 'light' | 'dark';
    light?: Partial<MermaidThemeTokens>;
    dark?: Partial<MermaidThemeTokens>;
  };
  limits?: Partial<MermaidLimits>;
}
```

The tool host supplies styling through settings. With no settings, use the built-in light theme. Dark mode is explicit; the renderer never depends on terminal detection, a DOM, or operating-system appearance.

Merge validated partial theme settings into the selected built-in palette. Theme tokens cover:
- `canvas`, `surface`, `surfaceElevated`, `surfaceAccent`, `text`, `mutedText`
- `border`, `borderStrong`, `edge`, `edgeLabelBackground`, `edgeLabelBorder`
- `accent`, `accentSurface`, `accentBorder`, `accentText`
- `groupSurface`, `groupHeaderSurface`, `groupBorder`
- `noteSurface`, `noteBorder`, `noteText`, `activationSurface`
- `shadowColor`, `fontFamily`, `monospaceFontFamily`, `fontSize`, `secondaryFontSize`, `lineHeight`, `strokeWidth`, `edgeStrokeWidth`, `cornerRadius`, `elbowRadius`, `rankGap`, `nodeGap`, and `padding`

Keep visual values out of parsing and diagram semantics.

### Visual design system & exact geometry specification

Diagrams must look refined, balanced, and publication-ready (comparable to modern design tools like Linear/Figma), never like stiff legacy Graphviz output. Lock these exact design metrics and rendering rules into `src/theme.ts`, `src/layout/`, `src/svg.ts`, and `src/raster.ts`:

- **Color palettes & surface depth**:
  - **Light mode**: canvas `#f8fafc`, primary node surface `#ffffff`, decision/terminal accent surface `#eff6ff` (border `#60a5fa`), subgraph surface `#f1f5f980`, subgraph header `#e2e8f080`, subgraph border `#cbd5e1`, primary border `#cbd5e1`, strong/active border `#64748b`, edge stroke `#64748b`, edge label pill `#ffffff` (border `#e2e8f0`), note surface `#fefce8` (border `#facc15`, text `#713f12`), text `#0f172a`, muted text `#475569`, accent `#2563eb`, elevation shadow `rgba(15, 23, 42, 0.06)`.
  - **Dark mode**: canvas `#0b1120`, primary node surface `#1e293b`, decision/terminal accent surface `#172554` (border `#3b82f6`), subgraph surface `#0f172a99`, subgraph header `#1e293b`, subgraph border `#334155`, primary border `#334155`, strong/active border `#64748b`, edge stroke `#94a3b8`, edge label pill `#1e293b` (border `#334155`), note surface `#422006` (border `#ca8a04`, text `#fef08a`), text `#f8fafc`, muted text `#94a3b8`, accent `#60a5fa`, elevation shadow `rgba(0, 0, 0, 0.35)`.
  - **Subtle elevation**: Render primary nodes, class/ER cards, and notes with a soft 2-layer drop shadow (`dy=1.5px, blur=3px` in SVG `<filter>` and a matching Gaussian/box-blurred alpha shadow pass in `src/raster.ts`) so cards lift cleanly off the canvas and group backgrounds.
- **8px spatial grid, typography, and padding**:
  - Canvas outer margin (`padding`): `32px` on all four sides.
  - Node typography: `13px` medium (`500` weight) proportional UI font, `20px` line height. Secondary text (edge labels, stereotypes, ER/class types, cardinalities): `11.5px`, `16px` line height.
  - Node internal padding: `18px` horizontal, `11px` vertical (`14px` horizontal, `6px` vertical for edge label pills). Minimum node size: `88px` wide by `40px` high.
  - Corner radii: `8px` for standard rectangular nodes and class/ER cards, `20px` (full pill) for stadium/terminal nodes, `6px` for edge label pills and notes, `12px` for subgraph/composite containers, and `4px` rounded vertex tips on decision diamonds.
  - Inter-rank spacing (`rankGap`): `56px` for `TB`/`BT`, `64px` for `LR`/`RL` (automatically expanded by `edgeLabelHeight + 20px` whenever an inter-rank edge carries a label). Sibling node spacing (`nodeGap`): `32px`.
- **Arrowhead & marker geometry (no bulky equilateral triangles)**:
  - Use a sleek swept-back concave dart (`length = 9px`, `width = 7px`, `inner notch = 2.2px`: path `M 0 0 L 9 3.5 L 0 7 L 2.2 3.5 Z` with `stroke-linejoin="round"`).
  - Pull the edge path endpoint back by `6.8px` along the terminal tangent vector so the `1.5px` edge stroke ends inside the dart body and never pokes through the sharp arrow tip.
  - Render UML hollow triangles (`10px x 8px`, filled with `canvas` background), composition/aggregation diamonds (`12px x 7px`), and ER Crow's Foot markers (`||`, `|o`, `}|`, `}o` drawn with `1.5px` antialiased strokes) with exact tangent alignment.
- **Orthogonal rounded-elbow routing & perpendicular stubs**:
  - Distribute multiple ports along a node face with `>= 14px` spacing centered on the face midpoint.
  - Enforce a **minimum `16px` straight perpendicular stub** leaving every source port and entering every target port so edges and arrowheads always depart and arrive strictly perpendicular (`0°` or `90°`) to the shape face—never at an awkward diagonal.
  - Connect orthogonal segments with **smooth `10px`-radius quadratic rounded elbows** (`r = min(10, segA / 2, segB / 2)`) so edges flow cleanly without sharp 90° spikes or wild S-curve overshoots.
  - Center edge label pills on the longest straight segment of the edge, backed by a rounded pill (`rx=6`, `1px` border) with `4px` clearance from any bend.
- **Subgraphs, sequence frames, and multi-compartment cards**:
  - Subgraphs and composite states render a distinct top header band (`32px` height, `groupHeaderSurface` fill, `12px` semibold label) and `20px` interior margin around all child nodes and routed edges.
  - Class and ER entities render as `rx=8` cards with a tinted header band (`groupHeaderSurface`), crisp `1px` full-width divider lines (`border`), left-aligned member name column, and right-aligned muted monospace type/key badge (`PK`, `FK`, `UK` in small rounded badges).
- **High-precision PNG rasterization (`src/font.ts` & `src/raster.ts`)**:
  - Default `-s/--scale` to `2` (2x Retina resolution) so a `600x400` logical diagram renders as a crisp `1200x800` PNG.
  - Use **4x4 subpixel analytic area-coverage antialiasing** (16 coverage samples per pixel) for all lines, quadratic curves, rounded rectangles, diamonds, markers, and TrueType glyph outlines so diagonal edges and `13px` text are smooth and completely free of staircase aliasing.

Resolve mode from CLI/config selection, then tool settings, then light. Host palette overrides remain authoritative. `--backgroundColor` overrides only the canvas (including `transparent`). JSON config supports the documented mode and diagram layout options; reject unknown keys. Reject Mermaid init directives and frontmatter in the initial profile so source documents cannot replace host styling or execution settings. No arbitrary CSS or executable configuration.

Expose a pure rendering SDK (`renderMermaidSvg`, `renderMermaidPng`) and a context-based command runner (`runMmdc`). Every supported CLI rendering option has a typed SDK equivalent, using one validation and rendering path.

## 3. Implementation details and technical decisions

### Execution prerequisites

Use the existing checkout, Node/npm development tooling, maintained build/test routes, and in-memory filesystem fixtures. Runtime rendering needs no credentials, network, service, or installed executable.

Before coding, obtain pinned reference revisions for Mermaid grammar and CLI research. Record revisions, inspect licenses, and inventory useful test cases before adapting them. Upstream sources are development research only. Do not make routine tests require network access or an upstream installation.

### Package ownership

Create private workspace `packages/safe-bash-command-mmdc`. Keep renderer logic in that package initially; do not introduce speculative shared packages. Depend on `safe-bash-contracts` for command, branded argument/value (`getCommandArguments`, `ByteShellValue`), filesystem, stream (`ByteSink`), resource lease, plugin, and output contracts. Preserve `carrier.args === context.args` brand identity. Do not import `safe-bash` back into the command workspace.

Safe-bash only wires the opt-in export (`./commands/mmdc`) and maintained bundling/declaration metadata (`poeCode.integration.privateWorkspaces["safe-bash-command-mmdc"]` in `packages/safe-bash/package.json`). Follow `packages/safe-bash-command-htmlq` and `packages/safe-bash-command-wkhtmltopdf` conventions. Preserve runtime contract identity and avoid a workspace dependency cycle. Default command registration remains unchanged.

### Pipeline

1. Decode bounded UTF-8 input, allowing a leading BOM and CRLF. Reject malformed UTF-8 with a source diagnostic.
2. Tokenize with a scanner, retaining offsets, line, and column. Handle comments, quoted labels, escapes, and statement separators explicitly.
3. Parse into family-specific ASTs, then normalize identifiers, references, labels, and relationships into a typed diagram model (`MermaidDocument`).
4. Measure labels with the deterministic embedded TrueType font metric model (`src/font.ts` & `src/text.ts`), including multiline and Unicode handling. Never require DOM measurement.
5. Lay out nodes and groups, assign distributed ports, route orthogonal rounded-elbow edges with `16px` perpendicular stubs and obstacle/channel checks, and place label pills into a concrete resolution-independent `MermaidScene`. Preserve stable source-order tie breaking and deterministic output.
6. Verify scene geometry invariants (finite coordinates, positive bounds, viewBox containment).
7. Emit the requested target format from the same `MermaidScene`:
   - **SVG (`src/svg.ts`)**: Serialize escaped SVG with explicit geometry, elevation shadow filter, palette, swept-back dart markers, and font attributes; include accessible title/description when supplied.
   - **Direct zero-dependency PNG (`src/raster.ts` & `src/png.ts`)**: Rasterize the `MermaidScene` at `width * scale` by `height * scale` into a bounded `Uint8Array` RGBA framebuffer using 4x4 subpixel analytic antialiasing for soft shadows, rounded rects, polygons, quadratic elbow strokes, dashed segments, markers, and TrueType glyph outlines (`src/font.ts`), then encode to RFC 2083 PNG (`IHDR`, filtered `IDAT` via bounded RFC 1950/1951 deflate, `IEND` with CRC32/Adler32).

For flowcharts, implement layered layout: find connected components and strongly connected components, assign ranks, reduce crossings with bounded sweeps, assign coordinates on the 8px grid, and route edges with obstacle and rank-channel checks. Cover cycles, self loops, parallel edges, disconnected components, nested subgraphs, and all supported directions (`TB`, `TD`, `BT`, `LR`, `RL`). Estimate text before layout; group bounds, headers, and edge label pills must participate in routing.

Sequence diagrams use participant columns and ordered message rows. State diagrams reuse applicable graph layout with dedicated state semantics. Class and ER diagrams use compartment nodes and relationship markers. Keep shared geometry cohesive; do not force different diagram semantics into an overly generic parser.

### Supported syntax baseline

- Flowchart: `flowchart`/`graph`, TB/TD/BT/LR/RL directions, identifiers, quoted and multiline labels, rectangle/rounded/diamond/circle nodes, directed/undirected/dotted/thick edges, edge labels, and nested subgraphs.
- Sequence: explicit and implicit participants, solid/dashed messages and arrowheads, self messages, notes, activation/deactivation, and loop/alt/opt blocks.
- State: `stateDiagram-v2`, named states, aliases, transitions, initial/final states, composite states, and notes.
- Class: class declarations, attributes/methods as display text, relationships, multiplicity labels, and namespaces.
- ER: entity declarations, attribute compartments, relationships, cardinality markers, and relationship labels.

Treat this baseline as an acceptance contract, not a claim that every combination already works. Capture grammar details and unsupported features in the package README as each parser is delivered. Inline styling directives (`style`, `classDef`, `linkStyle`) are unsupported initially; labels are text, never raw HTML.

### Safety and failures

Validate settings, colors, numbers, scale factors, and font values structurally. Escape SVG text and attributes. Emit no scripts, event handlers, `foreignObject`, external resources, or source-controlled URLs/IDs. Use generated local IDs with stable collision handling.

Bound source bytes, tokens, nesting, nodes, edges, label size, layout work, raster pixel dimensions (`width * height * scale^2 <= maxPixels`), framebuffer memory, and output bytes. Expose documented finite defaults and lowerable host ceilings; CLI/config cannot raise them. Charge work inside parser, layout, and scanline rasterizer loops. Yield at bounded intervals in the command execution path so cancellation can be observed during large renders; the synchronous pure SDK still applies work limits.

Produce the complete bounded SVG or PNG payload before publishing it. Preserve an existing destination on parse/render failure and reject input/output aliases, including symlinks. Use the established safe filesystem publication contract. Respect backpressure, cancellation, consumer failure, and cleanup; do not leak partial diagnostics into SVG or PNG output streams.

## 4. Interfaces, test plan, and mandatory agent visual verification

Proposed interfaces, finalized against current contracts during implementation:

```ts
parseMermaid(source: string, options?: MermaidParseOptions): MermaidDocument;
layoutMermaid(document: MermaidDocument, options?: MermaidLayoutOptions): MermaidScene;
renderMermaidSvg(source: string, options?: MermaidRenderOptions): MermaidSvgResult;
renderMermaidPng(source: string, options?: MermaidPngRenderOptions): MermaidPngResult;
createMmdcCommand(settings?: MmdcSettings): CommandDefinition;
mmdcCommand: CommandDefinition;
mmdcCommands(settings?: MmdcSettings): CommandDefinition[];
runMmdc(context: CommandContext, options?: MmdcRunOptions): Promise<MmdcResult>;
```

`MermaidSvgResult` includes `svg: string`, natural bounds, and diagram family. `MermaidPngResult` includes `png: Uint8Array`, pixel `width` and `height`, `scale`, natural bounds, and diagram family. `MermaidRenderOptions` contains typed theme/layout/viewport options (`MermaidPngRenderOptions` adds `scale?: number`). `MmdcRunOptions` supports literal argv or typed CLI equivalents with an explicit conflict rule. Diagnostics include stable codes and source spans where applicable: syntax, unsupported feature, invalid config, resource limit, cancellation, and filesystem failure. Do not add proxy-only public functions.

### Repurpose and rewrite existing unit tests

Reuse existing behavioral cases and fixture patterns, rewriting their inputs and assertions for this renderer. Do not wrap an upstream renderer or preserve assertions tied to upstream internals.

- `packages/safe-bash-command-wkhtmltopdf/src/command.test.ts`: rewrite applicable stdin/file/output, input alias, publication race, bounded output, cancellation, and cleanup cases for `.mmd` input and `.svg`/`.png` output.
- `packages/safe-bash-command-htmlq/src/command.test.ts`: adapt applicable branded argv, SDK parity, diagnostics, configuration ownership, and stream failure cases.
- `packages/docx/src/svg-image.test.ts` and `packages/terminal-png-rust/tests/png.rs`: reuse relevant SVG dimensions/escaping/hostile-content assertions and PNG chunk/CRC/IHDR/IDAT decode verification patterns.
- Pinned Mermaid grammar & CLI tests: adapt supported argument, stdin/stdout, format extension, and error cases. Explicitly test intentional compatibility differences.

Write each behavior's failing test before its code. Unit tests use memfs or the established memory filesystem, never disk fixtures created at runtime. No LLM calls, slow processes, or live upstream oracles.

### Automated geometric & raster invariant tests

Every fixture across all five diagram families must pass automated geometric and pixel assertions in unit tests:

1. **Zero node-to-node overlap**: No two sibling node bounding boxes intersect, and minimum sibling clearance is `>= 24px`.
2. **Zero label collision**: No node label or edge label pill overlaps any node border or another label pill.
3. **Subgraph containment & header clearance**: Every child node and child subgraph lies strictly inside its parent subgraph padded interior (`>= 16px` inner margin), and no node or edge label overlaps the `32px` subgraph header band.
4. **Perpendicular port & arrow attachment**: Every edge start/end point lies within `0.5px` of its source/target node perimeter contour, has a `>= 12px` perpendicular stub before any bend, and its arrowhead tangent aligns with the terminal segment while the stroke stops `6.8px` short of the tip.
5. **ViewBox & PNG pixel integrity**: Every scene element lies inside `[padding, width - padding] x [padding, height - padding]`; decoded PNG RGBA dimensions match `ceil(width * scale) x ceil(height * scale)`, background pixel samples match the theme canvas (or alpha `0` when `-b transparent`), and diagonal/curved edges contain intermediate antialiased alpha/blend values (proving 4x4 subpixel smoothing is active, not 1-bit staircase pixels).

### Mandatory agent visual inspection protocol (check EVERY output)

The executing agent MUST generate PNG files using `mmdc` (both via CLI in a `safe-bash` session and via `renderMermaidPng`) into `/out/mmdc-qa/` and visually inspect **every single output** using `view_image` at the completion of each diagram family—not only at the end of the project.

Required inspection matrix (rendered in **both `light` and `dark` themes**, plus `-b transparent`, totaling at least 24 PNG outputs inspected via `view_image`):

1. **Flowcharts** (`flowchart-basic`, `flowchart-directions-tb-bt-lr-rl`, `flowchart-cycles-backedges`, `flowchart-self-loop-parallel`, `flowchart-nested-subgraphs`, `flowchart-unicode-multiline`).
2. **Sequence diagrams** (`sequence-participants-messages`, `sequence-activations-self`, `sequence-alt-loop-opt-notes`).
3. **State diagrams** (`state-v2-start-end`, `state-composite-nested`, `state-cycles-notes`).
4. **Class diagrams** (`class-compartments-visibility`, `class-inheritance-composition-multiplicity`, `class-namespaces`).
5. **ER diagrams** (`er-entities-attributes`, `er-crows-foot-cardinalities-labels`).
6. **CLI terminal screenshots**: Run `npm run screenshot-poe-code` (or capture terminal output) for `mmdc --help` and diagnostic error formatting.

For **every** PNG output opened with `view_image`, the agent must explicitly verify all 8 visual design criteria before proceeding:

- **Typography & optical centering**: Labels are crisp (`2x` Retina antialiased), optically centered both horizontally and vertically inside shapes, and have generous breathing room (`>= 11px` vertical, `>= 18px` horizontal padding) from borders.
- **Sleek arrowheads & perpendicular entry**: Arrowheads are sharp swept-back darts (no fat triangles, no line stroke poking through the tip) and always enter/leave node faces perpendicularly with a clean straight stub.
- **Smooth orthogonal rounded elbows**: All 90° edge turns have smooth `10px` rounded corners and never cut across unrelated nodes or containers.
- **Edge label pills**: Edge labels sit inside clean rounded background pills (`rx=6`) centered on straight edge segments and are never struck through by edge lines.
- **Card hierarchy & subtle depth**: Primary nodes have subtle elevation shadows, decision/start/end nodes use semantic accent tints, and class/ER/subgraph containers have distinct two-tone header bands.
- **Container hierarchy**: Subgraph, composite state, namespace, and sequence `alt`/`loop` titles sit cleanly inside their `32px` header zones with generous inner margin around child elements.
- **Contrast & palette fidelity**: Both `light` and `dark` renders have strong text/background contrast, distinct surface hierarchy, and accurate accent colors.
- **No clipping or jagged edges**: All borders, shadows, markers, diamonds, and curves are free of staircase pixelation and have intact `32px` outer padding on all four sides.

If any output fails any of the 8 criteria during `view_image` inspection, the agent must fix the layout/rasterizer/theme code, regenerate the PNGs, and re-verify all affected outputs before marking the family complete. Purge `/out/mmdc-qa/` only after all outputs pass visual sign-off.

### Manual acceptance session

Execute inside an opt-in safe-bash session with `createMmdcCommand` registered and virtual files loaded in memory:

```bash
mmdc -i /diagram.mmd -o /light.svg -t light
mmdc -i /diagram.mmd -o /dark.svg -t dark
mmdc -i /diagram.mmd -o /light.png -t light -s 2
mmdc -i /diagram.mmd -o /dark.png -t dark -s 2
cat /diagram.mmd | mmdc -i - -o -
cat /diagram.mmd | mmdc -i - -o - -e png > /piped.png
mmdc -i /invalid.mmd -o /light.svg
mmdc -i /diagram.mmd -o /diagram.pdf
```

Observe valid, visibly different light/dark SVGs and PNGs; stdout-only SVG or PNG bytes for pipes; source location diagnostics and preserved `/light.svg` for invalid input; and an explicit unsupported-format error (exit 2) for `.pdf`.

Must-work checklist:

- [ ] Every claimed syntax feature has a passing behavioral test and automated geometry invariant check.
- [ ] File and piped examples produce complete SVGs and PNGs with exit 0, verified in the registered session.
- [ ] Every fixture in the 5-family matrix has been rendered to PNG in both light and dark modes and inspected by the agent via `view_image`.
- [ ] Invalid/unsupported sources report their location and preserve existing output, verified by the invalid-source command and memory filesystem assertions.
- [ ] CLI and SDK options (`renderMermaidSvg`, `renderMermaidPng`, `runMmdc`) produce equivalent renders, verified by parity tests.
- [ ] Cycles, nested groups, self loops, compartments, Crow's Foot markers, and Unicode labels remain legible, verified by geometry tests and `view_image` checks.
- [ ] Resource exhaustion, pixel budget ceilings, cancellation, output failure, and injection are handled, verified by focused behavioral tests.
- [ ] Packed consumers import `@poe-platform/safe-bash/commands/mmdc` without external runtime modules or default-registration changes, verified by the maintained package gates.

## 5. Code plan

Create in `packages/safe-bash-command-mmdc`:

- `package.json`, TypeScript/test configuration, `LICENSE`, and a user-facing `README.md` with commands, settings, supported syntax, and compatibility limits.
- `src/contracts.ts`: public models, scene graph (`MermaidScene`), options, theme tokens, limits, diagnostics, and result types.
- `src/scanner.ts` and `src/parser.ts`: bounded tokenization and diagram-family dispatch.
- `src/parsers/{flowchart,sequence,state,class,er}.ts`: family-specific grammar and normalization.
- `src/font.ts` and `src/text.ts`: embedded TrueType glyph outline/metric table (`cmap`, `hmtx`, `glyf`) and deterministic multiline/Unicode text measurement shared by SVG and PNG.
- `src/geometry.ts`, `src/layout.ts`, and `src/layout/{graph,sequence,routing}.ts`: port distribution, layered Sugiyama graph layout, orthogonal `10px` rounded-elbow edge routing with `16px` perpendicular stubs, obstacle avoidance, sequence column/row layout, and automated geometry invariant checks.
- `src/theme.ts` and `src/svg.ts`: validated light/dark defaults, elevation shadows, swept-back dart markers, token overrides, and safe SVG serialization.
- `src/raster.ts` and `src/png.ts`: zero-dependency 4x4 subpixel antialiased 2D scanline rasterizer (`MermaidScene` + TrueType glyph outlines + soft elevation shadows to RGBA framebuffer) and bounded RFC 2083 PNG encoder (`IHDR`, filtered `IDAT` with RFC 1950/1951 deflate, `IEND`).
- `src/arguments.ts`, `src/command.ts`, and `src/index.ts`: CLI grammar (`-i`, `-o`, `-e`, `-t`, `-w`, `-H`, `-s`, `-b`, `-c`, `-q`, `-h`, `-V`), VFS command execution, SDK rendering (`renderMermaidSvg`, `renderMermaidPng`), and exports (`createMmdcCommand`, `mmdcCommand`, `mmdcCommands`).
- Focused adjacent `*.test.ts` files and compact snapshot fixtures.

Change safe-bash's `package.json` (`exports["./commands/mmdc"]` and `poeCode.integration.privateWorkspaces["safe-bash-command-mmdc"]`), `src/commands/mmdc/index.ts`, `integration-boundaries.json`, and maintained build integration inputs/entrypoint declarations as required by existing conventions. Update actual workspace/build/test membership declarations discovered during implementation. Add no engine logic to root wiring. Update existing README text only where published behavior requires it; do not add root README sections.

Build order:

1. Pin/reference sources, inventory reusable tests, specify grammar and compatibility, and confirm maintained package integration paths.
2. Write failing font metric, theme, scanner, and flowchart parsing tests; implement `src/font.ts`, `src/text.ts`, `src/theme.ts`, and flowchart parsing.
3. Write failing geometry invariant and flowchart layout/routing tests; implement deterministic port distribution, layered layout, and rounded orthogonal routing with perpendicular stubs.
4. Write failing SVG and direct PNG rasterizer/encoder tests; implement `src/svg.ts`, `src/raster.ts`, and `src/png.ts`. Render all flowchart fixtures (light + dark) to `/out/mmdc-qa/*.png` and inspect every image with `view_image`, iterating until visual quality passes all 8 rubric criteria.
5. Write command contract tests first; implement `src/arguments.ts`, `src/command.ts`, virtual I/O, limits, cancellation, and CLI/SDK parity for both SVG and PNG.
6. Wire opt-in packaging in `packages/safe-bash` and verify maintained build/declaration/packed-consumer gates.
7. Add `sequence`, `state`, `class`, and `er` diagram families one at a time: for each family, write parser/layout/geometry/render tests first, implement the family, render its full light/dark PNG fixture set to `/out/mmdc-qa/`, and inspect every PNG with `view_image` before starting the next family.
8. Finish the syntax/compatibility `README.md`, run the full 24+ PNG visual inspection sweep and Markdown QA session, purge `/out/mmdc-qa/`, and complete maintained lint/test/build checks.

Keep each improvement atomic. Work on main when implementation is requested. Commit or push only when authorized; after a requested push, separately verify remote main and monitor the release through successful publication.
