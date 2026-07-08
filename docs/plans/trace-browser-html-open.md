---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Trace browser HTML open

Generate a self-contained HTML page from a selected agent trace and open it with the platform browser.

## 1. What we're building

An **open** action on the existing `poe-code traces` browser (and matching path/CLI/SDK entry points) that:

- Builds a single, self-contained HTML document for the selected trace (or a loaded path)
- Opens that document in the system browser via the standard `open` path already used elsewhere (`toolcraft-design` `openExternal`)
- Looks polished and intentional — not a dump of the terminal detail view

The page covers every meaningful state the viewer already knows about: full detail (header, model, source, context gauge, breakdown, conversation turns by role), empty conversation, redacted content (poe-code), estimated vs exact breakdown, high/mid/low context pressure, collapsed tool/system turns with expand, missing optional fields, and **subagent traces nested inline in the conversation at the moment they were spawned** — each child is a collapsible panel (own header, gauge, breakdown, conversation, further nested children) inserted after its parent spawn turn, not in a separate Subagents appendix.

### Explicit non-goals

- Not a live multi-trace SPA or remote server
- Not replacing the terminal explorer / TUI detail modal
- Not shipping network assets (fonts, CDNs, analytics)
- Not writing permanent artifacts into the project tree by default
- Not re-implementing trace discovery or token counting
- Not an HTML list/index of all discovered traces (list stays terminal)
- Not multi-file / multi-tab HTML (one document, full tree inlined)
- Not changing the terminal explorer’s `s` subagent drill-down behavior

## 2. User-facing shape

### CLI

```sh
# Existing list / explorer — unchanged
poe-code traces
poe-code traces --yes
poe-code traces --source claude --limit 20

# Path detail in terminal — unchanged
poe-code traces /path/to/trace.jsonl
poe-code traces /path/to/trace.jsonl --json

# NEW: generate self-contained HTML for a path and open it in the browser
poe-code traces /path/to/trace.jsonl --open

# NEW: write HTML without opening (CI / share / inspect)
poe-code traces /path/to/trace.jsonl --html-out ./trace.html

# NEW: write + open
poe-code traces /path/to/trace.jsonl --open --html-out ./trace.html
```

Flags:

| Flag | Behavior |
| --- | --- |
| `--open` | After loading the target trace, write HTML (temp file unless `--html-out`) and open via platform browser. Requires a path argument. Incompatible with `--json`. |
| `--html-out <file>` | Write the HTML document to this path. Does not open unless `--open` is also set. Requires a path argument. Incompatible with `--json`. |

Validation:

- `--open` / `--html-out` without a path → validation error: path required.
- `--open` / `--html-out` with `--json` → validation error: mutually exclusive.
- Missing / unreadable path → same errors as today’s path mode.
- Browser launch failure → non-zero exit with a clear message; HTML file still left on disk when written.

Without `--open` / `--html-out`, behavior is identical to today.

### Interactive explorer

In the existing `poe-code traces` explorer, add action:

| Key | id | Label | When |
| --- | --- | --- | --- |
| `o` | `open-html` | Open in browser | Always (selected row) |

Flow:

1. User highlights a trace.
2. Presses `o`.
3. Spinner / toast while load + HTML write (if load not already cached).
4. System browser opens the page.
5. Explorer stays open; toast `Opened in browser` (or warning on failure).

`Enter` still opens the terminal detail modal. `s` / `c` / `r` unchanged.

### SDK / library

```ts
import {
  loadTraceFromFile,
  loadTraceTree,
  renderTraceHtml,
  writeTraceHtml,
  openTraceHtml
} from "@poe-code/agent-trace-viewer";
import { openExternal } from "toolcraft-design";

// Load root + recursive children as one tree (for HTML)
const tree = await loadTraceTree(
  await loadTraceFromFile(path, { fs }),
  { fs }
);
// tree: TraceTreeNode { view, children: TraceTreeNode[] }

// Pure string — no I/O; embeds full nested tree
const html = renderTraceHtml(tree);

// Write only
const filePath = await writeTraceHtml(tree, {
  fs,
  outPath: "/tmp/trace.html" // optional; default under os.tmpdir()/poe-code-traces/
});

// Write + open
const opened = await openTraceHtml(tree, {
  fs,
  outPath,                 // optional
  open: openExternal       // injectable; default openExternal from toolcraft-design
});
// opened.path is the file that was opened
```

CLI and explorer call the same load-tree → `openTraceHtml` / `writeTraceHtml` path.

`loadSubagentSummaries` stays for the terminal TUI only; HTML open does not use flat summaries.

### Page product rules

- One HTML file. All CSS and JS inlined. Zero network requests.
- Dark-first UI (trace reading), system font stack only.
- Escape all user/model text. Prefer text content over raw HTML insertion; assistant markdown rendered through existing `renderMarkdownHtml` and embedded as sanitized HTML.
- Tool and system turns collapsed by default (first ~3 lines / preview), expandable in-page with no server.
- Very large turn bodies get a hard cap with “Show full turn” expand (client-side, content already in the document under a collapsed region — or truncated with a note if the serialized page would be huge; see level 3).
- Subagents: **inline in the conversation timeline on the same page**, at the spawn point — not a trailing Subagents section, not separate files, not TUI-only. When the parent fires a spawn tool turn (`Task` / `Agent`, and any future spawn tool the reader already classifies), the matching child panel is rendered **immediately after that turn** (or after its tool_result if we pair them). Expanded panel shows the child’s full detail (meta, own gauge, own breakdown, own conversation with the same inline-nesting rule). Collapsed panel is a one-line summary (agent type, title, compact gauge, turn count, nested-child count). Children order follows `view.children` / spawn tool-use order from the reader. Unmatched leftover children (no spawn turn found) append at the end of the conversation with a muted “unanchored” note. Recursion uses the same rule inside each child.
- Estimated breakdown shows a subtle “estimated · exact tokens may differ” chip (HTML is a snapshot; no live recount).
- Redacted poe-code turns render as intentional redacted placeholders, not empty noise.
- Print-friendly enough that browser print-to-PDF is usable (simple flow, no special chrome).

### Page mocks

**Interactive HTML mock (open in browser):** [`trace-browser-html-open.mock.html`](./trace-browser-html-open.mock.html)

Self-contained dark UI with tabbed states M0–M15, nested collapsible subagents, expand/collapse, and responsive layout. Prefer this over the ASCII blocks when judging polish.

ASCII mocks below remain the structural checklist for each state.

#### M0 — Shell (all states share this chrome)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  poe-code traces                                            file://…     │
│  ────────────────────────────────────────────────────────────────────    │
│  ▸ TITLE OF THE TRACE (or id)                                            │
│    [claude]  model: claude-sonnet-4.5  ·  48 turns                       │
│    started 2026-07-01T12:00:00Z  ·  updated 2026-07-01T13:10:00Z         │
│    path  ~/.claude/projects/…/abc.jsonl                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

Header always includes: brand, title, source badge, turn count, timestamps when known. Model and path rows omit entirely when absent.

#### M1 — Full healthy detail (exact breakdown, mid gauge, subagents, mixed turns)

```text
┌─ header (M0) ────────────────────────────────────────────────────────────┐
│                                                                          │
│  Context                                                                 │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  ▐████████████░░░░░▌  84.2k / 200k  ·  42%  ·  reported            │  │
│  │  tone: success ( <60% green · 60–84 amber · ≥85 red )              │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Breakdown                                          exact                │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  ▐███▓▓▓▒▒▒▒░░░░▌                                                  │  │
│  │  ■ System prompt     12.1k   14%                                   │  │
│  │  ■ Skills            28.4k   34%                                   │  │
│  │      plan                 9.2k  ×2                                 │  │
│  │      experiment           7.1k  ×1                                 │  │
│  │      … 3 more                                                      │  │
│  │  ■ MCP                4.0k    5%                                   │  │
│  │      github               4.0k  ×6                                 │  │
│  │  ■ System reminders   1.2k    1%                                   │  │
│  │  ■ Tools             18.0k   21%                                   │  │
│  │      Bash                10.1k  ×12                                │  │
│  │      Read                 5.2k  ×8                                 │  │
│  │  ■ Reasoning          6.0k    7%                                   │  │
│  │  ■ Messages          14.5k   17%                                   │  │
│  │  ■ Other              0.0k    0%   (hidden if 0 tokens)            │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Conversation  (timeline — subagents appear where they were spawned)     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  › human                                            12:00:01       │  │
│  │    Implement the open action for the trace browser.                │  │
│  │                                                                    │  │
│  │  ✦ assistant                                        12:00:08       │  │
│  │    I'll inspect the existing viewer and add HTML open.             │  │
│  │                                                                    │  │
│  │  ⚙ tool · Task · Explore                            12:00:09       │  │
│  │    find callers of openExternal                         [Expand]   │  │
│  │  ┌ subagent (collapsed, inline under spawn) ─────────────────────┐ │  │
│  │  │ ▸ Explore · find callers…  ▐███░░▌ 12.1k · 6% · 14 turns      │ │  │
│  │  └───────────────────────────────────────────────────────────────┘ │  │
│  │                                                                    │  │
│  │  ⚙ tool · Task · Plan                               12:00:12       │  │
│  │    draft HTML open approach                             [Expand]   │  │
│  │  ┌ subagent (expanded in place) ─────────────────────────────────┐ │  │
│  │  │ ▾ Plan · draft HTML open approach               [Collapse]    │ │  │
│  │  │   meta · own Context · own Breakdown                          │ │  │
│  │  │   Conversation                                                │ │  │
│  │  │     › human  draft the page structure…                        │ │  │
│  │  │     ✦ assistant  …                                            │ │  │
│  │  │     ⚙ tool · Task · Bash                         [Expand]     │ │  │
│  │  │     ┌ nested child (collapsed, at its spawn) ───────────────┐ │ │  │
│  │  │     │ ▸ Bash · run unit tests  ▐█░░░░▌ 2.1k · 1% · 3 turns  │ │ │  │
│  │  │     └───────────────────────────────────────────────────────┘ │ │  │
│  │  │     ⚙ tool · Read  …                               [Expand]   │ │  │
│  │  └───────────────────────────────────────────────────────────────┘ │  │
│  │                                                                    │  │
│  │  ⚙ tool · Bash                                      12:00:20       │  │
│  │    $ rg -n open packages/agent-trace-viewer             [Expand]   │  │
│  │                                                                    │  │
│  │  ⚙ tool · Task · Bash                               12:00:22       │  │
│  │    smoke the open path                                  [Expand]   │  │
│  │  ┌ subagent collapsed ───────────────────────────────────────────┐ │  │
│  │  │ ▸ Bash · smoke the open path  ▐█░░░░▌ 2.1k · 1% · 3 turns     │ │  │
│  │  └───────────────────────────────────────────────────────────────┘ │  │
│  │                                                                    │  │
│  │  ⚠ system · reminder                                12:00:23       │  │
│  │    Keep going until the feature works.                  [Expand]   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  footer · generated by poe-code traces · source claude · id abc…         │
└──────────────────────────────────────────────────────────────────────────┘
```

Layout rule: **one Conversation timeline**. After each spawn tool turn (`Task` / `Agent`), insert the matching child panel inline. Expanded children use the same timeline rule for *their* nested spawns. No trailing Subagents section. Child tokens never roll into the parent gauge (same rule as the TUI).

#### M2 — High context pressure (≥85%)

Same as M1, gauge block only changes tone:

```text
│  Context                                                                 │
│  ▐████████████████▌  190k / 200k  ·  95%  ·  reported                    │
│  bar + percent use danger/red; label chip "high"                         │
```

#### M3 — Warning context pressure (60–84%)

```text
│  Context                                                                 │
│  ▐████████████░░░░░▌  140k / 200k  ·  70%  ·  reported                   │
│  bar + percent use warning/amber                                         │
```

#### M4 — Estimated breakdown (no reported usage / snapshot before exact)

```text
│  Context                                                                 │
│  ▐██████░░░░░░░░░░░▌  62k / 200k  ·  31%  ·  estimated                   │
│                                                                          │
│  Breakdown                               chip: estimated                 │
│  ▐████▓▓▒▒░░░░░░░░░▌                                                     │
│  footnote: "Token counts are estimated from character length."           │
```

#### M5 — Empty conversation

```text
│  Context · breakdown as available                                        │
│                                                                          │
│  Conversation                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │           No turns recorded in this trace.                         │  │
│  └────────────────────────────────────────────────────────────────────┘  │
```

#### M6 — No subagents

Conversation is turns only — no inline child panels, no empty Subagents shell.

#### M7 — Redacted poe-code trace

```text
│  header · source badge [poe-code] · model may be present                 │
│                                                                          │
│  Breakdown                                                               │
│  ■ Tools   ~0 tokens  ×48     (call counts visible, bodies redacted)     │
│  ■ Messages ~0 tokens                                                    │
│                                                                          │
│  Conversation                                                            │
│  › human                                                                 │
│    ┌ redacted ──────────────────────────────────────────────────────┐    │
│    │  Content redacted in poe-code traces.                          │    │
│    └────────────────────────────────────────────────────────────────┘    │
│  ✦ assistant                                                             │
│    ┌ redacted ──────────────────────────────────────────────────────┐    │
│    │  Content redacted in poe-code traces.                          │    │
│    └────────────────────────────────────────────────────────────────┘    │
│  ⚙ tool · Spawn                                                          │
│    redacted body · still shows toolName and counts                       │
```

Detect redaction as today’s terminal path does: poe-code source with empty/near-empty bodies but present structure — render the explicit redacted card, not blank lines.

#### M8 — Missing optional fields

```text
│  ▸ session-deadbeef                                                      │
│    [codex]  ·  12 turns                                                  │
│    updated 2026-07-02T09:00:00Z                                          │
│    (no model row · no started row · no path row · no cwd)                │
```

#### M9 — Collapsed vs expanded tool/system turn

Collapsed (default):

```text
│  ⚙ tool · Read                                                           │
│    path: packages/agent-trace-viewer/src/run.ts                          │
│    … +40 lines                                              [Expand]     │
```

Expanded:

```text
│  ⚙ tool · Read                                              [Collapse]   │
│    path: packages/agent-trace-viewer/src/run.ts                          │
│    <full body, scrollable pre block, max-height with inner scroll>       │
```

#### M9b — Nested subagent collapse (inline at spawn)

Default: **all subagent panels collapsed** so the parent timeline stays scannable. Expand reads the child **in place under its spawn turn**.

```text
│  ⚙ tool · Task · Explore                                                 │
│    find callers…                                              [Expand]   │
│  ┌ inline child (collapsed) ───────────────────────────────────────────┐ │
│  │ ▸ Explore · find callers…  badge  ·  ▐███░░▌ 12.1k · 6% · 14 turns  │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ⚙ tool · Task · Plan                                                    │
│  ┌ inline child (expanded) ────────────────────────────────────────────┐ │
│  │ ▾ Plan …                                              [Collapse]    │ │
│  │   Conversation                                                      │ │
│  │     ⚙ tool · Task · Bash                                            │ │
│  │     ┌ nested inline at grandchild spawn ──────────────────────────┐ │ │
│  │     │ ▸ Bash · run tests …                                        │ │ │
│  │     └─────────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
```

Visual: left rail / indent by depth under the parent timeline; disclosure chevron on the child header. Failed child loads render as a non-expandable error row still anchored after the spawn turn: `⚠ unavailable · <title or id>`. Unanchored children (no matching spawn turn) append at end of conversation under a small “Additional subagents” divider — rare fallback only.

#### M10 — Long assistant markdown

```text
│  ✦ assistant                                                             │
│    rendered markdown: headings, lists, fenced code (inlined highlight    │
│    only if already available offline via renderMarkdownHtml options;     │
│    otherwise plain <pre><code>), inline code, links as text+href.        │
│    No remote images loaded (img src blocked / stripped).                 │
```

#### M11 — Role gallery (must all be distinct)

```text
│  › human      accent left border, "human" label                          │
│  ✦ assistant  success left border, markdown body                         │
│  ⚙ tool       info left border, mono body, toolName chip                 │
│  ⚠ system     warning left border, muted body, sourceKind chip           │
```

#### M12 — Skills / MCP / tools item overflow in breakdown

```text
│  ■ Skills                                                                │
│      plan …                                                              │
│      experiment …                                                        │
│      safejs …                                                            │
│      superintendent …                                                    │
│      pipeline …                                                          │
│      … 4 more                                                            │
```

Top 5 items + remainder count, matching terminal `renderBreakdown` behavior.

#### M13 — Zero measured tokens / empty breakdown

```text
│  Context                                                                 │
│  ▐░░░░░░░░░░░░░░░░░▌  0 / 200k  ·  0%  ·  estimated                      │
│                                                                          │
│  Breakdown                                                               │
│  No context tokens measured                                              │
```

#### M14 — Write/open success signals (terminal side, not HTML)

```text
# --open
Opened /var/folders/…/poe-code-traces/trace-abc.html

# --html-out only
Wrote ./trace.html

# explorer toast
Opened in browser
```

#### M15 — Failure signals

```text
# browser launcher failed (file still written)
Wrote /tmp/…/trace-abc.html
Error: Browser launcher exited with code 1

# validation
Error: --open requires a trace path.
Error: --open cannot be used with --json.
```

### Example invocations (happy path)

```sh
poe-code traces ~/.claude/projects/.../session.jsonl --open
# → builds HTML, opens browser, prints path

poe-code traces
# → explorer; press o on a row → browser opens; explorer remains
```

## 3. Implementation details and technical decisions

### Autonomy audit

| Need | Status |
| --- | --- |
| Existing `TraceView` / breakdown / subagent loaders | Available in `@poe-code/agent-trace-viewer` |
| Platform open | `openExternal` in `toolcraft-design` |
| Markdown → HTML | `renderMarkdownHtml` in `toolcraft-design` |
| Temp / cache write | Node `os.tmpdir()` + injected `fs` (`writeFile`, `mkdir`) — same `AgentTraceFileSystem` shape already used; extend only if mkdir missing (it is present on `AgentTraceFileSystem`) |
| Design tokens | Inline a fixed dark palette inspired by toolcraft landing + design tokens; do **not** pull terminal ANSI theme into HTML |
| Sample traces for QA | Real local claude/codex/poe-code traces via `poe-code traces --yes`; unit tests use synthetic `TraceTreeNode` fixtures in memory |
| Nested child traces | Available via `view.children` + recursive `loadTrace` (claude reader already attaches ordered children / spawnDepth) |
| Credentials / network | None |

No mid-run human setup required.

### Architecture

Keep everything inside `@poe-code/agent-trace-viewer`. Core stays a thin CLI/SDK wire.

```text
CLI traces.ts
  └─ runTraceViewer({ open, htmlOut, path, ... })
        ├─ path + (open|htmlOut) → loadTraceFromFile → loadTraceTree → write/open HTML → exit
        ├─ path only → existing terminal detail (flat subagent summaries)
        └─ list explorer → action open-html → loadTraceTree → openTraceHtml

loader.ts          loadTraceTree(root, options) → TraceTreeNode (recursive children)
render-html.ts     pure: TraceTreeNode → single html string (nested collapsible panels)
write-html.ts      fs write to outPath or temp
open-html.ts       write + openExternal(file URL)
run.ts             explorer key + path-mode branches
```

Pure rendering is separate from I/O so tests never touch disk or browsers (except through injected fakes).

### Decisions (locked)

1. **Detail-only HTML** — one root trace (plus nested children) per page. List remains terminal.
2. **Both CLI and explorer** — `--open` / `--html-out` and key `o`.
3. **Default location** — `path.join(os.tmpdir(), "poe-code-traces", \`trace-${safeId}.html\`)`. Stable-ish name per trace id so reopening overwrites the same temp file. `--html-out` overrides.
4. **Open via `file:` URL** — `pathToFileURL(absPath).href` passed to `openExternal`. Extend `openExternal` usage only; if `openExternal` rejects `file:` because of `new URL` edge cases on Windows paths, open the absolute path form the platform launcher already accepts (verify in unit test with mocked spawn; darwin `open`, linux `xdg-open`, win32 rundll32). Prefer `file:` href when `new URL` accepts it.
5. **Dark-first, self-contained** — single `<style>` block + small `<script>` for expand/collapse only (turns **and** subagent panels share the same disclosure mechanism).
6. **Reuse data layer** — root via `loadTrace` / `loadTraceFromFile`. HTML path uses new **`loadTraceTree`**: walk `view.children` depth-first, `loadTrace` each child, recurse. Skip failed children (same tolerance as `loadSubagentSummaries`) but keep a placeholder node so the tree shape is visible. Prefer exact tokens for HTML (`deferExactTokens: false`) so the snapshot is final; tree load may take longer than TUI preview — show spinner in CLI when >~700ms.
7. **Inline nested collapsible subagents in the conversation timeline** — not a trailing Subagents section, not summary-only cards, not separate HTML files. Match each child to a parent spawn turn (`toolName` `Task` or `Agent`, `sourceKind: "tool_use"`) in order of appearance / `spawnToolUseIds` order already used by the claude reader when building `children`. Render the child panel immediately after that turn (after tool_result pair when adjacent). Collapsed by default; expand reveals full child detail whose conversation uses the same inline rule for deeper spawns. Indent/rail by depth. Parent context gauge/breakdown never includes child tokens. Leftover unmatched children append at end of conversation with an “Additional subagents” fallback divider.
8. **Assistant markdown** — `renderMarkdownHtml(text)` for assistant turns under the same size guard as terminal (`MAX_MARKDOWN_TURN_CHARS`). Strip/disable remote image loads in CSS (`img{display:none}` or sanitize). Other roles: escaped plain text in `<pre>`.
9. **Collapse defaults** — tool + system turns collapsed; human + assistant expanded; **all subagent panels collapsed**. Match terminal collapse thresholds for turn preview length.
10. **Redaction** — if `view.source === "poe-code"` and turn text is empty/whitespace, render redacted card (applies at every tree depth). Do not special-case other sources.
11. **No list HTML, no multi-file site.** Recursive child crawl is required for HTML only (TUI keeps flat summaries + `s` drill-down).
12. **SDK parity** — export `loadTraceTree`, `renderTraceHtml`, `writeTraceHtml`, `openTraceHtml` from package index; CLI uses package API only. `loadSubagentSummaries` remains for TUI.
13. **Page size safety** — if total HTML would exceed a hard cap (e.g. 8 MiB), stop inlining further turn bodies / deeper nodes with an in-page notice (“Trace truncated for HTML export …”). Prefer keeping subagent **headers** (collapsed summary rows) even when bodies are omitted. Depth/node caps are implementation details, tested. Optional soft caps: max depth (e.g. 8) and max nodes (e.g. 50) with “N deeper children omitted” rows.
14. **Cycle / diamond safety** — track loaded `source:id` (and path when present) in a set while walking; if a reference repeats, render a stub “already included” row and do not recurse.

### Edge cases

| Case | Behavior |
| --- | --- |
| Path is directory | Existing EISDIR handling |
| Path missing | Existing ENOENT handling |
| `--open` without path | ValidationError |
| `--open` + `--json` | ValidationError |
| `--html-out` directory path | Write error surfaced cleanly |
| Explorer open while detail still loading | Await tree load; don’t double-open |
| Browser fails | Error message; keep file; exit 1 for CLI; toast warning in explorer |
| Huge tool output | Collapsed preview + expand; still subject to page size cap |
| Deep / wide subagent trees | Inline nested collapsible panels at spawn turns; soft depth/node caps + size cap; failed child = unavailable row after spawn |
| Spawn turn without loadable child | Show tool turn only; no empty panel |
| Child without matching spawn turn | Fallback block at end of conversation (“Additional subagents”) |
| Missing child file | Placeholder unavailable row; parent HTML still generated |
| Characters needing escape | Full HTML escape for all non-markdown fields; markdown path must not re-introduce unescaped user HTML (use existing renderer guarantees) |
| Concurrent explorer opens | Each write overwrites same temp id file; last write wins — acceptable |
| Non-TTY + `--open` | Allowed (CI can open if browser exists; usually pair with `--html-out` only) |
| `--yes` + `--open` | Path still required; `--yes` irrelevant for path open |

### Config / env

- No new env vars.
- No package config keys.
- No README additions unless the user later approves (package README for agent-trace-viewer **should** document the new API and flags — that is package README, not root README; update package README as part of implementation).

### CLI wiring notes

`src/cli/commands/traces.ts`:

- Add `.option("--open", …)` and `.option("--html-out <file>", …)`.
- Parse mutual exclusion with `--json` and require path when either flag set.
- Pass `open: boolean` and `htmlOut?: string` into `runTraceViewer`.
- Keep `allWorkspaces: true` as currently hardcoded unless changed elsewhere — do not alter discovery behavior in this feature.

### Explorer action notes

In `buildTraceExplorerConfig` actions array, add after open-detail:

```ts
{
  id: "open-html",
  key: "o",
  label: "Open in browser",
  showInFooter: true,
  handler: async (ctx) => { /* load if needed, openTraceHtml, toast */ }
}
```

Inject `open` and temp path helpers through `RunTraceViewerOptions` for tests.

## 4. Interfaces and test plan

### Module-boundary types

```ts
// packages/agent-trace-viewer/src/types.ts (or tree.ts)
export interface TraceTreeNode {
  view: TraceView;
  /** Successfully loaded children, depth-first in reference order. */
  children: TraceTreeNode[];
  /** Present when the child reference could not be loaded. */
  unavailable?: {
    reference: TraceReference;
    reason: string;
  };
}

// packages/agent-trace-viewer/src/loader.ts
export interface LoadTraceTreeOptions extends LoadTraceOptions {
  maxDepth?: number; // soft cap, default e.g. 8
  maxNodes?: number; // soft cap, default e.g. 50
}

export async function loadTraceTree(
  root: TraceView,
  options: LoadTraceTreeOptions
): Promise<TraceTreeNode>;

// packages/agent-trace-viewer/src/render-html.ts
export interface RenderTraceHtmlOptions {
  generatedAt?: Date; // default now; injectable for snapshots
  pageSizeLimitBytes?: number; // default hard cap
}

export function renderTraceHtml(
  tree: TraceTreeNode,
  options?: RenderTraceHtmlOptions
): string;

// packages/agent-trace-viewer/src/write-html.ts
export interface WriteTraceHtmlOptions {
  fs: AgentTraceFileSystem;
  outPath?: string;
  tmpDir?: string; // default os.tmpdir()
  renderOptions?: RenderTraceHtmlOptions;
}

export async function writeTraceHtml(
  tree: TraceTreeNode,
  options: WriteTraceHtmlOptions
): Promise<{ path: string; bytes: number }>;

// packages/agent-trace-viewer/src/open-html.ts
export interface OpenTraceHtmlOptions extends WriteTraceHtmlOptions {
  open?: (target: string) => Promise<void>; // default: openExternal
}

export async function openTraceHtml(
  tree: TraceTreeNode,
  options: OpenTraceHtmlOptions
): Promise<{ path: string; bytes: number }>;
```

```ts
// extend RunTraceViewerOptions
export interface RunTraceViewerOptions {
  // existing fields…
  open?: boolean;
  htmlOut?: string;
  openExternal?: (target: string) => Promise<void>;
  tmpDir?: string;
}
```

Internal HTML view model (not necessarily exported):

```ts
interface TraceHtmlModel {
  root: TraceHtmlNode;
  truncated: boolean;
  omittedTurnCount: number;
  omittedNodeCount: number;
  generatedAt: string;
}

interface TraceHtmlNode {
  title: string;
  source: AgentTraceSource;
  agentType?: string;
  model?: string;
  id: string;
  path?: string;
  cwd?: string;
  createdAt?: string;
  updatedAt?: string;
  turnCount: number;
  context: ContextUsage;
  breakdown: ContextBreakdown;
  turns: TraceHtmlTurn[];
  children: TraceHtmlNode[];
  depth: number;
  collapsedByDefault: boolean; // true for depth > 0
  unavailable?: { title: string; reason: string };
}

interface TraceHtmlTurn {
  role: "human" | "assistant" | "tool" | "system";
  toolName?: string;
  sourceKind?: string;
  timestamp?: string;
  bodyHtml: string;       // trusted rendered fragment
  previewHtml: string;    // collapsed preview fragment
  collapsedByDefault: boolean;
  redacted: boolean;
  /** Child tree node(s) spawned by this turn, rendered inline after the turn. */
  spawnedChildren?: TraceHtmlNode[];
}

// Conversation render walks turns in order; after each turn with spawnedChildren,
// emit those node panels before the next turn. TraceHtmlNode.turns use the same shape recursively.
```

### Cross-package

- Depends on existing `toolcraft-design`: `openExternal`, `renderMarkdownHtml`.
- No new workspace packages.
- Core CLI only registers flags and forwards options.

### Unit tests (memfs / fakes, fast)

Colocated under `packages/agent-trace-viewer/src/`:

| File | Proves |
| --- | --- |
| `loader.test.ts` / `index.test.ts` (extend) | `loadTraceTree` walks children recursively, preserves order, skips/marks failed children, cycle-detects, respects maxDepth/maxNodes |
| `render-html.test.ts` | Structural asserts for M1–M13 + M9b: source badges, gauge classes by percent band, estimated chip, empty conversation, no trailing Subagents section, child panels appear **after** matching Task/Agent turns in conversation HTML order, nested collapsible panels with depth attributes, child bodies absent while collapsed default (`aria-expanded="false"` on depth>0), expanded markup still contains nested conversation with deeper spawns inline, unavailable child row after spawn, unanchored-children fallback at end, redacted cards for poe-code empty turns at nested depth, role markers, turn collapse defaults, top-5 breakdown items + “more”, missing optional fields omitted, HTML escaping of `</script>` in turn text, no external URLs in CSS/JS, `pageSizeLimitBytes` truncation notice, parent gauge not summed from children |
| `write-html.test.ts` | Writes to `outPath` via memfs; default temp path under `tmpDir/poe-code-traces/`; creates directory; returns bytes |
| `open-html.test.ts` | Calls write then injected `open` with `file:` URL or absolute path; propagates open errors after write |
| `run.test.ts` (extend) | Path + `open` loads tree and invokes open path and does not print terminal detail; path + `htmlOut` writes only; explorer action `open-html` present with key `o`; explorer handler calls open with loaded tree; terminal path without `--open` still uses flat `loadSubagentSummaries` |
| CLI `traces` command tests (existing pattern under `src/cli`) | Flag parsing, path required, mutual exclusion with `--json` |

Rules:

- No real browser.
- No real disk — memfs / in-memory fs fake already used by package.
- No LLM.
- Snapshots for full HTML fixtures allowed on disk per project snapshot rules if used; prefer focused string contains + DOM-ish regex over giant brittle snapshots unless one golden M1 snapshot is useful.

### Integration / package

- Export surface test: `renderTraceHtml`, `writeTraceHtml`, `openTraceHtml` exported from package index.
- Typecheck via package `tsc` build.

### Real-world test

Run in order on a machine with a GUI browser and local traces:

1. `poe-code traces --yes --limit 5`  
   Observe: table still works (no regression).

2. Pick a real claude path from the table (`c` in explorer or copy from `--yes` output), then:  
   `poe-code traces <that-path> --html-out /tmp/poe-trace.html`  
   Observe: file exists, `grep -n "<!doctype html>" /tmp/poe-trace.html`, opens in editor with header/gauge/conversation.

3. `poe-code traces <that-path> --open`  
   Observe: default browser opens the page; terminal prints `Opened …`.

4. Visual check in browser against mocks M1/M9/M9b/M11:  
   - source badge color distinct  
   - gauge tone correct for that trace’s %  
   - tool turns collapsed with Expand  
   - subagent panels sit **under their Task/Agent spawn turns** in the conversation, collapsed by default  
   - Expand reveals nested conversation on the same page; deeper spawns are again inline  
   - assistant markdown readable  
   - no network requests in browser devtools

5. Prefer a claude parent with known subagents (`poe-code traces --source claude`, open a parent that shows Subagents in TUI):  
   `poe-code traces <parent-path> --open`  
   Observe: no trailing Subagents section; each child panel appears after its spawn tool turn; expanding one shows full nested detail without a second file.

6. `poe-code traces --source poe-code --limit 5` then `o` on a row (or path `--open`)  
   Observe: redacted cards (M7), not blank conversation.

7. Explorer: `poe-code traces` → highlight row → `o`  
   Observe: browser opens, toast success, explorer still interactive; `Enter` still modal; `s` still drills TUI subagents.

8. Failure: `poe-code traces --open` (no path)  
   Observe: validation error, non-zero exit.

9. `poe-code traces <path> --open --json`  
   Observe: validation error.

### Must-work checklist

- [ ] `poe-code traces <file> --html-out /tmp/t.html` writes a self-contained HTML file that includes title, source, context gauge, breakdown, and conversation — prove by opening file and checking sections.
- [ ] Parent with children embeds nested collapsible subagent panels **inline after spawn turns** on the same page (not a trailing section, not separate files) — prove with a claude parent path; collapsed by default; Expand shows child conversation + further nesting at deeper spawn points.
- [ ] Child context is shown on the child panel and is not added into the parent gauge — prove unit + visual on nested parent.
- [ ] `poe-code traces <file> --open` launches the system browser via `openExternal` / platform open — prove by browser window showing the trace (or mocked unit + one manual).
- [ ] Explorer key `o` opens the selected trace in the browser without leaving the explorer — prove manually + unit on action wiring.
- [ ] Tool/system turns are collapsed by default and Expand reveals full body — prove in browser on a tool-heavy claude trace.
- [ ] poe-code redacted traces show explicit redacted placeholders — prove with `--source poe-code` path open.
- [ ] Gauge uses green/amber/red bands at 60 and 85 — prove with unit tests on class/style selection and one real high-% trace if available.
- [ ] `--open` without path and `--open --json` fail validation — prove CLI tests / manual.
- [ ] No external network requests from the HTML document — prove by grepping output for `http://` / `https://` in script/link/src (markdown links as text ok; no CDN).
- [ ] Existing `poe-code traces` list/detail/`--yes`/`--json`/TUI `s` behavior unchanged when new flags omitted — prove unit + smoke.
- [ ] SDK exports `loadTraceTree`, `renderTraceHtml`, `writeTraceHtml`, `openTraceHtml` — prove index export test.

### Rollout

- No migration. Additive flags and action.
- No config file changes.
- Ship on main with package as today (private workspace package bundled into CLI).

## 5. Code plan

### Files to create

| File | Purpose |
| --- | --- |
| `packages/agent-trace-viewer/src/render-html.ts` | Pure HTML document builder + CSS/JS strings + escape helpers; recursive node renderer |
| `packages/agent-trace-viewer/src/render-html.test.ts` | M1–M13 + M9b coverage |
| `packages/agent-trace-viewer/src/write-html.ts` | Resolve path, mkdir, write UTF-8 |
| `packages/agent-trace-viewer/src/write-html.test.ts` | memfs write paths |
| `packages/agent-trace-viewer/src/open-html.ts` | writeTraceHtml + open |
| `packages/agent-trace-viewer/src/open-html.test.ts` | inject open mock |

### Files to change

| File | Change |
| --- | --- |
| `packages/agent-trace-viewer/src/types.ts` | Add `TraceTreeNode` (and load-tree option types if not colocated) |
| `packages/agent-trace-viewer/src/loader.ts` | Add `loadTraceTree` recursive walker |
| `packages/agent-trace-viewer/src/index.test.ts` / loader tests | Tree load: order, failure, cycle, caps |
| `packages/agent-trace-viewer/src/run.ts` | Path-mode open/htmlOut via tree load; explorer `open-html` action; options plumbing |
| `packages/agent-trace-viewer/src/run.test.ts` | Cover new branches and action |
| `packages/agent-trace-viewer/src/index.ts` | Export `loadTraceTree`, HTML helpers, `TraceTreeNode` |
| `packages/agent-trace-viewer/README.md` | Document `--open`, `--html-out`, nested HTML tree, SDK helpers, explorer `o` |
| `src/cli/commands/traces.ts` | Flags, validation, forward to `runTraceViewer` |
| CLI traces tests (existing file(s) under `src/cli`) | Flag validation + wiring |

No root README changes.

### Signatures (new/modified)

```ts
export async function loadTraceTree(
  root: TraceView,
  options: LoadTraceTreeOptions
): Promise<TraceTreeNode>;

export function renderTraceHtml(
  tree: TraceTreeNode,
  options?: RenderTraceHtmlOptions
): string;

export async function writeTraceHtml(
  tree: TraceTreeNode,
  options: WriteTraceHtmlOptions
): Promise<{ path: string; bytes: number }>;

export async function openTraceHtml(
  tree: TraceTreeNode,
  options: OpenTraceHtmlOptions
): Promise<{ path: string; bytes: number }>;

export async function runTraceViewer(
  options: RunTraceViewerOptions
): Promise<void>;
// RunTraceViewerOptions gains: open?, htmlOut?, openExternal?, tmpDir?
```

Helpers (private to render-html):

```ts
function escapeHtml(value: string): string;
function gaugeTone(percent: number): "ok" | "warn" | "danger";
function buildTraceHtmlModel(
  tree: TraceTreeNode,
  options: RenderTraceHtmlOptions
): TraceHtmlModel;
function renderNode(node: TraceHtmlNode, isRoot: boolean): string;
function renderDocument(model: TraceHtmlModel): string;
```

### Build order (keep green)

1. **TDD `loadTraceTree`** — recursive children, unavailable nodes, cycle set, depth/node caps (memfs fake readers already used by package tests).
2. **TDD render-html** — fixtures for each mock state including nested M9b; implement `renderTraceHtml(tree)` until assertions pass (no I/O).
3. **TDD write-html** — memfs mkdir/write/default path.
4. **TDD open-html** — mock `open`; assert order write→open and error propagation.
5. **Extend runTraceViewer** — path open/htmlOut loads tree; explorer action; tests with mocked open/fs; TUI path unchanged.
6. **CLI flags + validation tests**.
7. **Exports + package README**.
8. **Real-world checklist** — `--html-out`, `--open`, nested expand on a parent with subagents, explorer `o`, poe-code redacted, grep for no CDN.
9. **Screenshot / visual** — `npm run screenshot-poe-code -- traces --help` for flag help; manual browser screenshots of the HTML page for M1/M7/M9/M9b stored ad-hoc under `screenshots/trace-browser/` if useful (not automated screenshot tests).

### Implementation notes for the HTML document

- `<!doctype html>`, `lang="en"`, charset, viewport, title = root trace title/id.
- CSS variables for bg/ink/muted/line/accent/success/warning/danger/source colors.
- Sticky compact top bar with brand + source badge + root context percent pill.
- Main width `min(100% - 48px, 920px)`.
- Breakdown segmented bar as pure CSS flex widths from percent (per node).
- Conversation as ordered list of articles; `data-role` for styling.
- Conversation is a single ordered stream of turns + inline child panels. After a spawn tool turn, emit `<section class="trace-node" data-depth="N">` for the matched child. Collapsed: summary row only. Expanded: full node chrome (meta, gauge, breakdown, conversation) where nested spawns again appear after their turns inside that conversation.
- Placement helper (private): `attachChildrenToTurns(turns, children)` pairs children to Task/Agent tool_use turns in order; remainder → unanchored fallback at end.
- JS: one event-delegation handler for `[data-toggle]` covering both turn expand and subagent panel expand; toggles `aria-expanded` and `.is-expanded`. No dependencies.
- Footer with generated timestamp and root trace id.
