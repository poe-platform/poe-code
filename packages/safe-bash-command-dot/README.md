# DOT diagrams

Render graphs into SVG, vector PDF or PNG in your shell's virtual filesystem:

```ts
import { dotCommands } from "@poe-platform/safe-bash/commands/dot";
shell.use(dotCommands());
await shell.exec("dot -Tsvg graph.dot -o graph.svg");
await shell.exec("dot -Tpdf graph.dot -o graph.pdf");
await shell.exec("dot -Tpng graph.dot -o graph.png");
```

`dot [-Tsvg|-Tpdf|-Tpng] [-o OUTPUT] [INPUT]` reads stdin when INPUT is omitted
or `-`, and writes stdout when OUTPUT is omitted or `-`. SVG is the default.
Output directories must exist. No native Graphviz executable is required.
The first-party DOT engine supports directed/undirected graphs, subgraphs,
clusters, labels and layered layout; layouts are not identical to native Graphviz.

`createDotCommand`, `createDotCommands`, and `dotCommands` accept
`DotCommandsOptions` with `replace` and partial `DotLimits`. Input, graph size,
layout work and raster pixels are bounded. Defaults are 1 MiB input, 10,000 graph
objects, 16 million raster pixels and `maxLayoutCost: 100_000_000` for the
conservative expanded-layout cost estimate. PDF/PNG use the vector primitive
profile documented by the SVG engine; unsupported SVG features fail explicitly.
