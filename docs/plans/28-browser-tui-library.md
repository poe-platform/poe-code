---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Browser TUI library

A reusable `list + preview + actions` browser component in `@poe-code/design-system`, modeled on fzf's interaction loop and Textual's widget/action architecture, replacing the hand-rolled `plan browse` screen and powering future task/package browsers.

## 1. What we're building

A library unit in [packages/design-system/src/](packages/design-system/src/) that provides a generic three-region browser TUI — left sidebar list, main preview pane, action footer — driven by fuzzy filter input and keybind-dispatched actions, built on top of the existing [dashboard](packages/design-system/src/dashboard/) primitives (raw ANSI renderer, `ScreenBuffer`, `createTerminalDriver`, `computeDashboardLayout`).

Consumers of the library (first: [packages/plan-browser/src/browser.ts](packages/plan-browser/src/browser.ts)) declare what is being browsed, not how it is drawn:

- a **list provider** — async iterable of rows + metadata
- a **row formatter** — title, optional second-line metadata, status badge
- a **preview renderer** — given the highlighted row, return ANSI text (markdown plans use the existing [terminal-markdown](packages/design-system/src/terminal-markdown/) renderer)
- an **actions registry** — `{ key, label, predicate, handler }` entries; the footer hint bar, command palette, and dispatch loop all derive from this one source
- a **theme** — reuses the existing [tokens/colors.ts](packages/design-system/src/tokens/colors.ts) palette (accent/muted/success/warning/error/info)

The library handles: layout, focus, fuzzy filtering, async loading + cancellation of preview renders, ANSI passthrough, multi-select, keybind dispatch, `?`-help modal, command palette, confirm modals, narrow-terminal vertical fallback, and the redraw loop (granular dirty regions, not full repaints).

**Non-goals**

- Not a generic Textual port. No CSS parser, no DOM, no widget tree — one composite screen with fixed regions.
- Not a replacement for the dashboard. The dashboard remains the streaming-output primitive; the browser is a peer screen built from the same `ScreenBuffer` + driver.
- Not a parallel theme system. Reuses `tokens/colors.ts` as-is; if a gap appears it gets added to the existing token file, not a new one.
- Not multi-screen / no screen stack — one browser screen at a time, plus modal overlays.
- No regex filter mode in v1. Fuzzy only.
- No mouse support in v1.
- No async streaming list updates in v1 — list provider resolves once before render. (Cancellation applies only to preview renders.)
- Existing dashboard consumers ([pipeline.ts](src/cli/commands/pipeline.ts), [experiment.ts](src/cli/commands/experiment.ts)) are not touched.

## 2. User-facing shape

_To be drafted in the next pass._

## 3. Implementation details and technical decisions

_To be drafted in the next pass._

## 4. Interfaces and test plan

_To be drafted in the next pass._

## 5. Code plan

_To be drafted in the next pass._
