# `safe-bash-command-mmdc`

Deterministic, zero-DOM Mermaid-to-SVG and Mermaid-to-PNG diagram renderer for `@poe-platform/safe-bash` and Node.js applications.

Render crisp architecture flowcharts, sequence interactions, state machines, UML class hierarchies, and entity-relationship diagrams directly inside a sandboxed virtual shell or TypeScript SDK—without headless browsers, native canvas bindings, or network requests.

---

## Feature Index Card

| Capability | Details |
| :--- | :--- |
| **Command** | `mmdc` (`@poe-platform/safe-bash/commands/mmdc`) |
| **Output Formats** | Vector `svg` and antialiased `png` (`4x4` subpixel supersampling, RFC 2083 PNG) |
| **Diagram Families** | `flowchart` / `graph`, `sequenceDiagram`, `stateDiagram-v2` / `stateDiagram`, `classDiagram`, `erDiagram` |
| **Themes** | `default` / `light`, `dark`, green `forest`, slate `neutral`, and customizable `base` palettes on an `8px` spatial grid |
| **Typography** | Embedded TrueType (`sfnt`) glyph metrics & outlines (`Latin`, `Greek`, math symbols, and `CJK`) |
| **Sandbox Safety** | Zero DOM/browser dependencies, strict node/edge/pixel/time budgets, and VFS-only I/O |

---

## Quick Start

### 1. Inside `@poe-platform/safe-bash`

Register `mmdcCommands()` on a `Shell` instance to enable the `mmdc` command in scripts and pipelines:

```ts
import { Shell } from "@poe-platform/safe-bash";
import { mmdcCommands } from "@poe-platform/safe-bash/commands/mmdc";

const shell = new Shell().use(
  mmdcCommands({
    theme: { mode: "dark" }
  })
);

await shell.exec(`
  cat << 'EOF' > /arch.mmd
  flowchart LR
    Client([Client App]) -->|HTTPS| Gateway[API Gateway]
    Gateway --> Auth{Authenticated?}
    Auth -->|Yes| Core[(Core DB)]
    Auth -->|No| Reject[401 Unauthorized]
  EOF
  mmdc -i /arch.mmd -o /arch.svg
  mmdc -i /arch.mmd -o /arch.png -s 2
`);
```

### 2. Pipeline Mode (`stdin` -> `stdout`)

```bash
# Render SVG directly to stdout
echo "flowchart TD; A[Start] --> B[Finish]" | mmdc -o - > diagram.svg

# Render PNG directly via pipeline
cat schema.mmd | mmdc -i - -o - -e png -t dark > schema.png
```

### 3. Programmatic TypeScript SDK

```ts
import {
  parseMermaid,
  layoutMermaid,
  renderMermaidSvg,
  renderMermaidPng,
  verifySceneGeometry
} from "safe-bash-command-mmdc";

const source = `
sequenceDiagram
  participant Client
  participant API
  Client->>+API: POST /v1/orders
  API-->>-Client: 201 Created
`;

// Render vector SVG
const { svg, width, height } = renderMermaidSvg(source, {
  theme: "light"
});

// Render 2x Retina PNG
const { png } = renderMermaidPng(source, {
  theme: "dark",
  scale: 2
});

// Inspect intermediate AST & positioned scene geometry
const ast = parseMermaid(source);
const scene = layoutMermaid(ast, { theme: "light" });
const verification = verifySceneGeometry(scene);
```

---

## CLI Reference (`mmdc`)

| Flag | Alias | Default | Description |
| :--- | :--- | :--- | :--- |
| `--input <path\|->` | `-i` | `-` (`stdin`) | Input Mermaid file path in the VFS or `-` for `stdin` |
| `--output <path\|->` | `-o` | `<input>.svg` or `out.svg` | Output file path in the VFS or `-` / `/dev/stdout` for `stdout`; `-e` controls the default extension |
| `--outputFormat <svg\|png>` | `-e` | Inferred from `-o` or `svg` | Explicit output format (`svg` or `png`) |
| `--theme <name>` | `-t` | `default` | Theme preset (`default`, `forest`, `dark`, `neutral`, `base`, `light`) |
| `--backgroundColor <css>` | `-b` | `white` | Canvas background color (CSS names, `#hex`, `rgb(...)`, `rgba(...)`, or `transparent`) |
| `--width <px>` | `-w` | Scene width | Positive integer output width; preserves aspect ratio when height is omitted |
| `--height <px>` | `-H` | Scene height | Positive integer output height; preserves aspect ratio when width is omitted |
| `--scale <factor>` | `-s` | `1` | Positive raster scale multiplier; resource budgets bound the output |
| `--configFile <path>` | `-c` | — | JSON renderer configuration in the VFS |
| `--svgId <id>` | `-I` | — | Root SVG ID; namespaces internal definitions for embedding |
| `--quiet` | `-q` | `false` | Suppress non-error diagnostic output |
| `--version` | `-V` | — | Print command version and exit `0` |
| `--help` | `-h` | — | Print usage summary and exit `0` |

---

This implements the SVG/PNG subset of Mermaid CLI 11.x options with a deterministic renderer. Explicit `-e` overrides format inference. The CLI and SDK default to white backgrounds and PNG scale 1; use `-b '#0b1120'` with dark diagrams for a dark canvas.

Dimensions describe the output viewport, fitting the natural scene. They are not browser viewport dimensions; omitted dimensions use the natural scene size rather than Mermaid CLI's 800 × 600 browser viewport. Presets use this renderer's palette, not Mermaid's exact CSS. PDF output, Markdown extraction, Puppeteer, external CSS, icon packs, and diagram families outside the table below are unsupported and return explicit errors.

Use `-c config.json`, or the same object as SDK `mermaidConfig` (also available in typed `runMmdc`):

```ts
const { svg } = renderMermaidSvg(source, {
  svgId: "architecture",
  mermaidConfig: {
    theme: "base",
    flowchart: { nodeSpacing: 40, rankSpacing: 64, wrappingWidth: 200 },
    themeVariables: { primaryColor: "#e0f2fe", primaryTextColor: "#0c4a6e" }
  }
});
```

Supported `themeVariables` are `primaryColor`, `primaryTextColor`, `primaryBorderColor`, `lineColor`, `textColor`, `background`, `noteBkgColor`, `noteTextColor`, and `noteBorderColor`. The canvas background option controls the output background independently of theme variables. Config `theme` takes precedence over `-t`. Renderer extensions include `rankGap`, `nodeGap`, `padding`, `width`, `height`, `scale`, `backgroundColor`, and `theme: { mode, light, dark }` token overrides. Unknown config keys are rejected. Host settings remain authoritative for palette and resource limits.

## Supported Mermaid Syntax Reference

| Diagram Family | Header | Supported Constructs |
| :--- | :--- | :--- |
| **Flowchart** | `flowchart TD\|TB\|BT\|LR\|RL`<br/>`graph TD\|TB\|BT\|LR\|RL` | Node shapes: `[Rect]`, `(Rounded)`, `([Stadium])`, `[[Subroutine]]`, `[(Cylinder)]`, `((Circle))`, `{Diamond}`, `{{Hexagon}}`<br/>Edges: `-->`, `---`, `-.->`, `-.-`, `==>`, `===` with `\|label\|` or inline labels<br/>Containers: Nested `subgraph id [Title] ... end` blocks, comments `%%`, multiline labels (`<br/>`) |
| **Sequence** | `sequenceDiagram` | Actors: `participant Id as Label`, `actor Id as Label`, `autonumber`<br/>Messages: `->>`, `-->>`, `->`, `-->`, `-x`, `--x`<br/>Activations: `+` / `-` shorthand, `activate` / `deactivate`, self-message loops<br/>Blocks & Notes: `alt` / `else`, `opt`, `loop`, `par` / `and`, `Note left of`, `Note right of`, `Note over A,B` |
| **State (`v2`)** | `stateDiagram-v2`<br/>`stateDiagram` | Pseudo-states: `[*] --> State` (initial), `State --> [*]` (final)<br/>States: `state "Description" as Id`, `StateId : description`<br/>Composite states: Nested `state CompositeId { ... }` blocks<br/>Notes: `note left of State : text`, `note right of State : text` |
| **Class** | `classDiagram` | Declarations: `class Name { ... }`, stereotypes `<<interface>>`, `<<abstract>>`, `<<service>>`, `<<enumeration>>`<br/>Members: Visibility `+` (public), `-` (private), `#` (protected), `~` (package), classifiers `*` (abstract), `$` (static)<br/>Relationships: `<\|--`, `*--`, `o--`, `-->`, `..>`, `..\|>`, `--` with `"1"` / `"0..*"` multiplicity badges & `: label`<br/>Grouping: `namespace PackageName { ... }` |
| **Entity-Relationship** | `erDiagram` | Entities: `ENTITY { type name [PK\|FK\|UK] ["comment"] }` and `ENTITY["Display Label"]`<br/>Crow's Foot Cardinalities: `\|\|` (exactly one), `\|o` / `o\|` (zero or one), `}\|` / `\|{` (one or more), `}o` / `o{` (zero or more)<br/>Identifying (`--`) and non-identifying (`..`) relationships with `: label` |
