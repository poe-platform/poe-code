# neato

Render DOT graphs entirely inside Safe Bash with `neatoCommands()`. Files, stdin, stdout and binary output use the supplied virtual filesystem and streams.

```ts
import { neatoCommands } from "@poe-platform/safe-bash/commands/neato";
shell.use(neatoCommands());
await shell.exec("neato -Tpng graph.dot -o graph.png");
```

Formats: SVG (default), PNG, JPG/JPEG, WebP, JSON layout geometry, DOT with node positions, canonical DOT, Graphviz plain text, and vector PDF. Use `-Tformat`, `-o FILE`, `-Gname=value`, `-Nname=value`, `-Ename=value`, `-Kdot|neato`, `-V`, or `--help`. Multiple input files are processed in order; `-` reads stdin or writes stdout.

`dot` uses layered layout; `neato` uses deterministic spring layout. These are portable layouts, not byte-identical native Graphviz output. JSON exposes the engine's layout model. Set `limits` to bound input/output bytes, nodes, edges, raster pixels and estimated layout work. SVG defaults and existing PDF export remain supported.
