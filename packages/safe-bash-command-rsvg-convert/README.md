# SVG conversion

Turn generated vector diagrams into PDFs or PNGs:

```ts
import { rsvgConvertCommands } from "@poe-platform/safe-bash/commands/rsvg-convert";
shell.use(rsvgConvertCommands());
await shell.exec("rsvg-convert -f pdf diagram.svg -o diagram.pdf");
await shell.exec("rsvg-convert -f png diagram.svg -o diagram.png");
```

`rsvg-convert [-f pdf|png] [-o OUTPUT] [INPUT]` defaults to PNG and stdin/stdout.
It accepts `--format`, `--output`, `--help` and `--`. Output directories must exist.
PDF shapes and text remain vectors; PNG uses 96 DPI. No host renderer or network
access is required.

`createRsvgConvertCommand`, `createRsvgConvertCommands`, and
`rsvgConvertCommands` accept `RsvgConvertCommandsOptions` (`limits`, `replace`).
`RsvgConvertLimits` defaults to 4 MiB input, 10,000 SVG elements and 16 million
output pixels. Processing supports cancellation and shell output budgets.

Supported SVG includes basic shapes, cubic/quadratic paths, groups, transforms,
solid colors, stroke styles and plain text. The SVG engine documents the exact
profile. Advanced SVG/CSS features are not full librsvg compatibility.
