# 2026-06-22: Node 18 runtime support and explorer previews

## Runtime support

- The root package now supports Node.js `>=18.18`.
- Published runtime packages that previously required Node 20 were lowered to Node.js `>=18.18` where their package metadata changed.
- The dependency set was pinned or downgraded where needed for Node 18 compatibility, including Commander 13, Vitest 3, Vite 6, and the E2B 2.2 SDK line.

## Toolcraft design explorer

- The interactive explorer now draws framed `Plans` and `Preview` panes with a gutter between them.
- Detail content is rendered through the terminal Markdown renderer before display, so plan previews show formatted Markdown rather than raw Markdown text.
- The explorer detail body reserves space for pane borders in both wide and narrow layouts.
