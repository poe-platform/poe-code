---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: design-system-format-columns
    title: Width-aware formatColumns helper in design-system
    prompt: |
      Add a width-aware column formatter to
      packages/design-system/src/components/help-formatter.ts.

      Public API:

        export interface FormatColumnsOptions {
          rows: Array<{ left: string; right: string }>;
          totalWidth?: number;     // defaults to process.stdout.columns ?? 100
          minLeftWidth?: number;   // defaults to 12
          maxLeftWidth?: number;   // defaults to 32
          gap?: number;            // defaults to 3
          indent?: number;         // defaults to 2
        }

        export function formatColumns(opts: FormatColumnsOptions): string;

      Behaviour:
        - leftWidth = clamp(max(rows.map(r => visibleWidth(r.left))) + gap,
                            minLeftWidth, maxLeftWidth)
        - rightWidth = max(20, totalWidth - leftWidth - indent)
        - For each row: indent + padEnd(left, leftWidth) + word-wrapped
          right column. Continuation lines align to (indent + leftWidth).
        - visibleWidth strips ANSI escape codes when measuring. Add a
          5-line inline ANSI-strip helper; do not pull a new dep.
        - Word-wrap breaks on whitespace; long unbreakable tokens are
          emitted as-is and overflow rather than mid-token-broken.
        - Empty rows array returns "" (no trailing newline).

      Refactor formatCommandList and formatOptionList in the same file
      to be thin wrappers over formatColumns. Their public signatures
      stay the same. Internally:
        - formatCommandList maps { name, description } to
          { left: text.command(name), right: description }
        - formatOptionList maps { flags, description } to
          { left: text.option(flags), right: description }

      Drop reliance on widths.helpColumn = 24 (it can stay as a token
      but the formatter no longer reads it).

      Tests in
      packages/design-system/src/components/help-formatter.test.ts:
        - formatColumns aligns left to min(maxLen+gap, maxLeftWidth)
        - wraps right at totalWidth - leftWidth - indent
        - continuation indent is preserved
        - ANSI-styled left tokens do not widen the column
        - empty rows array returns ""
        - formatCommandList / formatOptionList still produce expected
          output via the new path (snapshot a small example)

      No filesystem in tests; pure string assertions.
    status:
      implement: done
      test: done
      commit: done

  - id: design-system-section-header
    title: Add text.sectionHeader to design-system
    prompt: |
      Add a sectionHeader function to
      packages/design-system/src/components/text.ts on the existing
      `text` object:

        sectionHeader(content: string): string

      Behaviour:
        - terminal mode: typography.bold(content.toUpperCase()),
          rendered on its own line, no trailing colon
        - markdown mode: `## ${content}`
        - JSON mode: passthrough (return content unchanged)

      Reuse the same resolveOutputFormat / typography path that
      text.section already uses. Do NOT remove text.section — other
      callers depend on it.

      Re-export sectionHeader from packages/design-system/src/index.ts
      alongside the existing `text` export. (sectionHeader lives on
      `text`; just confirm `text` is exported.)

      Tests in packages/design-system/src/components/text.test.ts (new
      or existing):
        - terminal mode: returns bold uppercase, no colon
        - markdown mode: returns `## Title`
        - JSON mode: returns input unchanged
    status:
      implement: done
      test: done
      commit: open

  - id: design-system-help-formatter-plain
    title: Plain-text fallback module for help-formatter
    prompt: |
      Create
      packages/design-system/src/components/help-formatter-plain.ts.

      Re-export formatColumns, formatCommandList, formatOptionList
      with the SAME signatures as
      packages/design-system/src/components/help-formatter.ts but
      bypass chalk and `text.*` styling — produce ASCII-only output
      with no ANSI escape codes.

      Re-export from packages/design-system/src/index.ts as a
      sub-namespace, e.g.:

        export * as helpFormatterPlain from
          "./components/help-formatter-plain.js";

      Use cases:
        1. runCLI output when process.stdout.isTTY === false
        2. Source for regenerating
           ashby-mcp/todos_mcp_cli/vendor/design-system/index.js (the
           vendored stub today reduces formatCommandList /
           formatOptionList to `${name}\t${desc}`; that gets replaced
           by this module's plain output).

      Tests in
      packages/design-system/src/components/help-formatter-plain.test.ts:
        - output contains no ANSI escape codes (regex
          /\x1b\[[0-9;]*m/ never matches)
        - same row alignment / wrapping rules as the chalk version
          (reuse a couple of cases from help-formatter.test.ts to
          confirm parity)
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-help-global-options-gate
    title: Gate global option rows in toolcraft help
    prompt: |
      Rewrite formatGlobalOptionRows in
      packages/toolcraft/src/cli.ts (current location around line
      1211, function name unchanged).

      New signature:

        function formatGlobalOptionRows(ctx: {
          showVersion: boolean;
          presetsEnabled: boolean;
        }): HelpOptionRow[]

      Rules:
        - --preset <path>      → only if presetsEnabled
        - --yes                → always
        - --output <format>    → always; description text becomes
                                 "Output format: rich, md, json."
                                 (drop the parenthesised form)
        - -h, --help           → NEVER on a help screen. Do not push
                                 this row from this function. Help is
                                 still wired by commander, just not
                                 advertised in the rendered help table.
        - --version            → only if showVersion

      Update the call sites in renderGroupHelp and renderLeafHelp to
      pass { showVersion: options.version !== undefined,
             presetsEnabled: options.presets === true }.

      Rename the section header from "Global options:" to "Options"
      (no trailing colon). Use text.sectionHeader from
      @poe-code/design-system instead of text.section for that line
      (and for "Commands", "Options", "Secrets (environment)").

      Today the shipped toolcraft@0.0.3 unconditionally pushes
      --preset, --yes, --output, -h/--help and the source has a
      partial gate; this task makes the gate complete and consistent.

      Tests in packages/toolcraft/src/cli.test.ts (or a new
      cli.help.test.ts): three snapshot cases:
        1. presets:false, version:undefined → only --yes and
           --output rendered
        2. presets:true, version:"1.2.3" → --preset, --yes,
           --output, --version rendered (in that order)
        3. -h, --help never appears in any of the above
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-help-field-tokens
    title: Boolean-aware and pattern-aware help field tokens
    prompt: |
      Fix value-token rendering in
      packages/toolcraft/src/cli.ts. The relevant function is
      formatHelpFieldFlags (~line 760) plus its callers.

      Today: every option renders as `${flags} [value]` (for booleans)
      or `${flags} <string>` / `<number>` (for scalars). This leaks
      schema kinds into help and confuses booleans with optional-value
      flags.

      Required behaviour:

      Booleans:
        - default false (or no default) → render `--flag`, no value
          token at all
        - default true → render `--no-flag` (the negation form),
          since enabling is the no-op

      Scalars / arrays:
        Token derivation, in priority order:
        1. field.schema.format if present:
             "date" → <date>
             "date-time" → <datetime>
             "uri" → <url>
             "email" → <email>
        2. field.schema.pattern: if it matches a known shape, expand:
             /^\d{4}-\d{2}-\d{2}$/ → <YYYY-MM-DD>
             /^\d{4}-\d{2}-\d{2}T/ → <YYYY-MM-DDTHH:MM:SS>
           Otherwise fall through.
        3. Field-name heuristic on the displayPath / optionFlag:
             *Path / *File → <path>
             *Url          → <url>
             *Email        → <email>
             *Name         → <name>
             *Id           → <id>
        4. Fallback: <value>

      The schema-kind tokens <string> and <number> are NEVER emitted
      by help. (commander still uses them internally for parsing —
      that is fine; the help renderer just produces its own token.)

      Tests in packages/toolcraft/src/cli.test.ts:
        - boolean field default false → row shows "--flag", no value
          token; description appended in the right column
        - boolean field default true → row shows "--no-flag"
        - string field with pattern ^\d{4}-\d{2}-\d{2}$ → "--date
          <YYYY-MM-DD>"
        - string field with format=email → "<email>"
        - string field named "configPath" with no schema metadata →
          "<path>"
        - string field with no metadata and no name match → "<value>"
        - <string>/<number> never appear in any rendered help row
          (regex assertion across the rendered output)
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-help-document-layout
    title: Heading line, Usage line, breadcrumb, flat commands list
    prompt: |
      Rewrite renderHelpDocument, renderGroupHelp, renderLeafHelp,
      and formatCommandRows in packages/toolcraft/src/cli.ts.

      Heading and description (renderHelpDocument):
        - Drop empty breadcrumb segments before joining:
          breadcrumb.filter((s) => s.length > 0).join(" ")
          (today the root group has name "" and the current code
          prints a leading space and a blank heading line).
        - If description is present, render the heading on a single
          line:  `${title} — ${description}`
          When description spans multiple sentences, use the first
          sentence (split on first ". ") for the heading line; emit
          the remainder as a paragraph after a blank line.

      Usage line (always rendered):
        - `Usage: ${rootUsageName} ${subPath} ${suffix}`
        - subPath = breadcrumb.filter((s) => s.length > 0).slice(1)
                              .join(" ")
        - suffix is "[command] [options]" for groups, or
          "[options]" + positional tokens for leaves (existing logic).
        - rootUsageName resolution: use options.rootUsageName when set;
          otherwise fall back to inferProgramName(process.argv) (that
          helper already exists at the top of cli.ts but is currently
          only used when `roots` is an array — extend the fallback to
          fire whenever options.rootUsageName is undefined).

      Section headers:
        - Use text.sectionHeader(...) from @poe-code/design-system,
          not text.section(...). Headers are "Commands", "Options",
          "Secrets (environment)" — no trailing colons.

      Flat commands list (formatCommandRows):
        - Remove the recursive depth-prefixed rendering ("  ".repeat
          (depth)). A group's "Commands" section lists ONLY its
          direct children. To see grandchildren, the user runs
          `--help` on the child group.

      Tests in packages/toolcraft/src/cli.test.ts (snapshots for each
      case at process.stdout.columns = 100, isTTY = true unless
      noted):
        1. Root group with name "", description "X" → heading is
           inferred program name + " — X" (no leading space, no
           empty heading line)
        2. Two-level group `parent child --help` → heading is
           "parent child — desc"
        3. Usage line always present at all levels; rootUsageName
           defaults from argv
        4. Group with subgroups: Commands section lists ONLY direct
           children, no indented grandchildren
        5. Leaf with description containing two sentences: heading
           uses first sentence; remainder appears as a paragraph
           after a blank line
        6. Snapshot at columns=60: descriptions wrap; section
           headers still render correctly
        7. Snapshot at isTTY=false: plain-text helpFormatterPlain
           path is used; output contains no ANSI escape codes
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-renderer-mcp-unwrap
    title: Auto-unwrap MCP CallToolResult in renderer
    prompt: |
      In packages/toolcraft/src/renderer.ts add a normaliser that
      runs at the start of renderResult.

      Detection (strict to avoid false positives on user data):

        function isMcpCallToolResult(v: unknown): v is {
          content?: unknown[];
          structuredContent?: unknown;
          isError?: boolean;
          _meta?: unknown;
        } {
          if (!isObject(v)) return false;
          const hasContent = Array.isArray((v as any).content);
          const hasStructured = (v as any).structuredContent !== undefined;
          if (!hasContent && !hasStructured) return false;
          return Object.keys(v).every((k) =>
            k === "content" || k === "structuredContent" ||
            k === "isError" || k === "_meta");
        }

      Extraction:

        function extractMcpPayload(env): unknown {
          const sc = env.structuredContent;
          if (isObject(sc) && "result" in sc) return (sc as any).result;
          if (sc !== undefined) return sc;
          if (Array.isArray(env.content)) {
            const text = env.content
              .filter((b) => b && b.type === "text" &&
                             typeof b.text === "string")
              .map((b) => b.text)
              .join("\n");
            return text.length > 0 ? text : undefined;
          }
          return undefined;
        }

      Wiring:
        - renderResult calls unwrapMcpEnvelope(result) before
          autoRender / custom render hooks.
        - When env.isError === true, write the unwrapped payload (or
          joined content[*].text fallback) to STDERR via the WriteFn
          and signal the caller to set process.exitCode = 1.
        - Extend WriteFn to
          (chunk: string, stream?: "stdout" | "stderr") => void;
          default to process.stdout.write / process.stderr.write
          respectively.
        - In packages/toolcraft/src/cli.ts, after the command handler
          returns, if the renderer signalled an MCP error, set
          process.exitCode = 1. Today the run-CLI exit handling
          (around line 2985) only sets non-zero on commander throws.

      Tests in packages/toolcraft/src/renderer.test.ts (new):
        1. structuredContent.result = "- Daily Focus", no isError →
           stdout is "- Daily Focus\n", exitCode untouched
        2. structuredContent = { foo: 1, bar: 2 }, no .result → the
           unwrapped value is the object (downstream rendering tested
           by toolcraft-renderer-yaml-fallback)
        3. content = [{type:"text",text:"hello"},{type:"text",
           text:"world"}], no structuredContent → stdout is
           "hello\nworld\n"
        4. content = [], no structuredContent → stdout is "Done.\n"
           (via existing autoRender null/undefined path)
        5. isError:true with text content → stderr receives the
           text; stdout is empty; exitCode marker is set
        6. Object with extra keys
           ({content,structuredContent,isError,customKey}) is NOT
           treated as an envelope and renders as-is
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-renderer-yaml-fallback
    title: String/string[] shortcuts plus YAML fallback in autoRender
    prompt: |
      In packages/toolcraft/src/renderer.ts simplify autoRender so
      that, after the MCP envelope unwrap, results render as
      human-readable text by default.

      Add `yaml` as a direct dependency of packages/toolcraft if it
      is not already pulled in. Import as
        import YAML from "yaml";

      autoRender rules (after the unwrap step from
      toolcraft-renderer-mcp-unwrap):
        1. value === null || value === undefined → "Done."
        2. typeof value === "string" → value (printed as-is, single
           trailing newline added by renderResult)
        3. Array.isArray(value) && value.every(v => typeof v ===
           "string") → value.join("\n")
        4. Otherwise → YAML.stringify(value)

      The previous renderObjectTable / renderArrayTable paths are NO
      LONGER reached from autoRender. Keep both functions exported so
      Command.render.rich consumers can still use them when they want
      a tabular layout — autoRender just does not call them.

      output mode handling stays:
        - --output md → existing markdown renderer on the unwrapped
          payload (unchanged)
        - --output json → existing JSON renderer on the unwrapped
          payload (unchanged)
        - default --output rich (or unset) → the four-rule layer
          above

      Tests in packages/toolcraft/src/renderer.test.ts:
        1. string → as-is
        2. string[] → joined with \n
        3. object {foo:1, bar:[1,2]} → YAML.stringify output
           (snapshot match)
        4. array of objects → YAML.stringify output (snapshot match)
        5. Command.render.rich defined → handler is invoked; YAML is
           bypassed
        6. --output md → markdown renderer runs; YAML NOT used
        7. --output json → JSON renderer runs; YAML NOT used

      Update any existing renderer tests whose expectations were
      based on the old object/array table being the default. Tables
      now appear only via Command.render.rich, never automatically.
    status:
      implement: open
      test: open
      commit: open

  - id: toolcraft-help-output-qa
    title: Markdown QA for help output at multiple terminal widths
    prompt: |
      Create packages/toolcraft/QA-help-output.md as an ad-hoc
      manual QA walkthrough (not a test script — markdown only, per
      the project's QA-as-markdown rule).

      Contents:

        1. A small example consumer the QA can run from the toolcraft
           package itself. Either reuse an existing fixture under
           packages/toolcraft/src/cli.test.fixture.json or describe
           a one-file example with two groups, one leaf with mixed
           field shapes (boolean, pattern-constrained string,
           positional), one secret. The QA must not depend on
           ashby-mcp.

        2. Steps to run the example at three terminal widths:
             - 60 columns
             - 100 columns
             - 160 columns
           For each width, capture root --help, group --help,
           leaf --help.

        3. Acceptance checklist for each captured screen:
             [ ] Heading is "<program> — <description>" with no
                 leading space and no blank heading line
             [ ] Usage: line is present
             [ ] Section header is "Commands" / "Options" /
                 "Secrets (environment)" — no trailing colons
             [ ] -h, --help is NOT listed under Options
             [ ] --preset is listed only when presets:true was passed
             [ ] --version is listed only when version is set
             [ ] Boolean flags render as --flag, not --flag [value]
             [ ] Pattern-constrained scalar renders the human token
                 (e.g. <YYYY-MM-DD>), not <string>
             [ ] Description column wraps at the right edge;
                 continuation lines align with the description column

        4. Steps to verify run output:
             - run a command whose handler returns a string
             - run a command whose handler returns string[]
             - run a command whose handler returns an object
             - run a command whose handler is an MCP proxy returning
               a CallToolResult
             - run a command whose handler returns isError:true
           For each, the acceptance checklist:
             [ ] string → printed as-is
             [ ] string[] → one per line
             [ ] object → YAML
             [ ] MCP envelope → unwrapped to its payload, then
                 rendered per the rules above
             [ ] isError → payload to stderr, process exit code 1

      Do NOT write a test runner. The QA is human-executed.
    status:
      implement: open
      commit: open

  - id: toolcraft-release-and-vendor-refresh
    title: Release toolcraft 0.0.4 and refresh ashby-mcp vendor stub
    prompt: |
      Cut a release that ships the help and renderer fixes, and
      regenerate the consumer-side vendor stub so ashby-mcp picks
      them up.

      Steps:

        1. Bump packages/design-system version (patch level — output
           surface change, no programmatic API removal).

        2. Bump packages/toolcraft version to 0.0.4.

        3. Update each package's CHANGELOG / release notes if the
           repo has them (search the package for a CHANGELOG.md
           before adding one; do not create one if not present).

        4. Push the branch / open a PR per the repo's standard
           release workflow. Releases are done on github via the
           trusted-publishing workflow — do not publish from local.
           See NPM_PUBLISHING.md at the repo root for the canonical
           sequence.

        5. After publish, in the ashby-mcp consumer
           (/Users/kjopek/Workspace/ashby-mcp):
             - update todos_mcp_cli/package.json: bump
               toolcraft to ^0.0.4 (or pin to the registry tarball
               URL if the existing entry uses that form)
             - regenerate
               todos_mcp_cli/vendor/design-system/index.js from
               packages/design-system/dist/components/help-formatter-plain.js
               so the vendored copies of formatCommandList /
               formatOptionList match the new wrapping/padding
               behaviour. The vendor stub is what actually ships
               inside ashby-mcp; the npm-installed copy is shadowed
               by the file: link in package.json.
             - npm install in todos_mcp_cli/

        6. Smoke test in ashby-mcp via terminal-pilot (or by hand
           in a terminal):
             node todos_mcp_cli/bin/todos-mcp-cli.mjs --help
             node todos_mcp_cli/bin/todos-mcp-cli.mjs calendar --help
             node todos_mcp_cli/bin/todos-mcp-cli.mjs calendar events --help
             node todos_mcp_cli/bin/todos-mcp-cli.mjs calendar events list --help
             node todos_mcp_cli/bin/todos-mcp-cli.mjs todo lists --yes
           Confirm:
             - no leading blank lines on root help
             - no -h, --help row anywhere in the help output
             - no Global options: header
             - todo lists prints "- Daily Focus" (or whatever the
               actual value is), NOT a key/value table of the
               envelope

      Do not run any of the destructive paths flagged in
      todos_mcp_cli/bin/todos-mcp-cli.mjs's
      destructiveCommandsByGroupPath (asana add_task / delete,
      calendar.meeting create / edit). Only --help and known
      read-only commands.
    status:
      implement: open
      commit: open
---

## Toolcraft help and result rendering overhaul

Holistic fix for `toolcraft` CLI output: rebuild `--help` from the design system, render results as human-readable text by default, and stop dumping raw MCP `CallToolResult` envelopes when a proxied command runs.

Driver: `ashby-mcp/todos_mcp_cli` consumes `toolcraft@0.0.3`. Help is unreadable, results render as a 4-row key/value table of the MCP envelope. Both flaws live in `packages/toolcraft` and `packages/design-system`; ashby-mcp is just the witness.

## North star: human-readable output

Every screen toolcraft renders is read by a person, in a terminal, scanning for what to do next. Every formatting decision answers to that.

- **Sentences, not jargon.** No `<string>` schema-kind tokens, no `[value]` placeholders, no envelope keys (`structuredContent`, `content[]`, `isError`) leaking out.
- **One thing per line.** Descriptions wrap to terminal width with continuation aligned under the description column.
- **Skim-first.** Bold section header, indent rows, blank line between sections.
- **No noise.** No `-h, --help` on a `--help` screen. No `--preset` if presets aren't enabled. No repeated `Global options:` header.
- **Results read like prose by default.** String → text. `string[]` → one per line. Anything richer → YAML. Tables only via `Command.render.rich`.
- **Width-aware.** `process.stdout.columns` honoured; layout composes at 60 cols, doesn't sprawl at 160.

## Observed defects

Captured via terminal-pilot against ashby-mcp at 120 cols.

### Root --help (today)

```text
$ node todos_mcp_cli/bin/todos-mcp-cli.mjs --help


CLI proxy for todo workspace tools.

Commands:
slack    Slack messages and channels.
asana    Asana project tasks.
todo    Apple Reminders todos.
calendar    Google Calendar.
approvals    Inspect and execute queued approvals.

Global options:
--preset <path>    Load parameter defaults from a JSON file
--yes    Accept defaults, skip prompts
--output <format>    Output format (rich, md, json)
-h, --help    Show help
```

Defects: empty heading line; no Usage line; `-h, --help` listed during `--help`; `Global options:` header repeats on every screen; `--preset` advertised even when presets are not enabled; tab-separated columns from the vendored `@poe-code/design-system` stub at `ashby-mcp/todos_mcp_cli/vendor/design-system/index.js` produce inconsistent alignment.

### Group --help (today)

```text
 calendar events

Google Calendar events.

Commands:
list    Get Google Calendar events for today, tomorrow, the current week, or a specific date. Returns events with UIDs usable by google_calendar_edit_meeting. TIMEZONE HANDLING: ...
```

Heading has a leading space (`breadcrumb = ["", "calendar", "events"]`); description column overflows the terminal width.

### Leaf --help (today)

```text
Options:
--tomorrow [value]    Get tomorrow's events ... (default: false)
--week [value]    Get this week's events ... (default: false)
--details [value]    Include Notion and Zoom links in output (default: false)
--date <string>    Specific date in YYYY-MM-DD format ...
```

Booleans render as `[value]`; `--date <string>` exposes the schema kind instead of the value shape.

### Run output (today)

```text
$ node todos_mcp_cli/bin/todos-mcp-cli.mjs todo lists --yes
key    value
content    [{"type":"text","text":"- Daily Focus"}]
structuredContent    {"result":"- Daily Focus"}
isError    false
```

The MCP `CallToolResult` envelope is rendered instead of its payload. The actual result `"- Daily Focus"` lives at `structuredContent.result`.

## Target output

### Root --help

```text
todos-mcp-cli — CLI proxy for todo workspace tools.

Usage: todos-mcp-cli [command] [options]

Commands
  slack       Slack messages and channels.
  asana       Asana project tasks.
  todo        Apple Reminders todos.
  calendar    Google Calendar.
  approvals   Inspect and execute queued approvals.

Options
  --yes               Accept defaults, skip prompts.
  --output <format>   Output format: rich, md, json.
```

### Group --help

```text
calendar — Google Calendar.

Usage: todos-mcp-cli calendar [command] [options]

Commands
  events    Google Calendar events.
  meeting   Google Calendar meetings.

Options
  --yes               Accept defaults, skip prompts.
  --output <format>   Output format: rich, md, json.
```

### Leaf --help

```text
calendar events list — Get today's, tomorrow's, this week's, or a specific date's events.

Usage: todos-mcp-cli calendar events list [options]

Options
  --tomorrow            Get tomorrow's events.
  --week                Get this week's events.
  --details             Include Notion and Zoom links.
  --date <YYYY-MM-DD>   Specific date (overrides --tomorrow / --week).
  --yes                 Accept defaults, skip prompts.
  --output <format>     Output format: rich, md, json.

Secrets (environment)
  GOOGLE_CREDENTIALS_FILE   Path to Google OAuth credentials JSON.
```

### Run output (string result)

```text
- Daily Focus
```

### Run output (object result)

For `{ lists: [{ id: "1", title: "Daily Focus" }, { id: "2", title: "Errands" }] }`:

```yaml
lists:
  - id: "1"
    title: Daily Focus
  - id: "2"
    title: Errands
```

vs. today's `key | value` table with JSON-stuffed cells.

## Out of scope

- Replacing commander; the parser stays.
- `NO_COLOR` / `--no-color` handling (already in design-system).
- Changing what MCP-proxied commands return; only the rendering of their result changes.
- Rich tabular output by default; tables remain available via `Command.render.rich`.
