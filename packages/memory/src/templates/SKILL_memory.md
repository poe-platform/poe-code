## CLI — `poe-code memory <subcommand>`
| Command | Purpose (when the agent should reach for it) |
|---|---|
| `init` | create `.poe-code/memory/` if missing; safe before first write |
| `ls` | list pages + one-line descriptions; first step for recall questions |
| `show <path>` | print one page verbatim after `ls` identifies a candidate |
| `search <query>` | ripgrep over memory when the page is not obvious from `ls` |
| `write <path> --reason <text>` | replace a page from stdin when authoring or rewriting |
| `append <path>` | append stdin to a page; intended for `LOG.md`-style updates |
| `edit <path>` | open `$EDITOR`; avoid from agents, prefer `write`/`append` |
| `ingest <source>` | spawn an ingest agent to fold a file or URL into memory |
| `query "<question>"` | answer a question from memory only, with citations |
| `explain <path>` | summarize a page plus its inbound/outbound links |
| `lint` | find stale citations, untagged claims, contradictions |
| `status [--no-tokens]` | show counts, bytes, and token-reduction ratio |
| `cache status` / `cache clear` | inspect or clear the ingest cache |
| `clear --yes` | wipe memory; destructive, user-request only |
| `install` | install this skill and register the `poe-code-memory` MCP server |

## MCP — `poe-code-memory` server
| Tool | Purpose |
|---|---|
| `list_pages` | enumerate pages (preferred over shelling out to `memory ls`) |
| `read_page` | read one page (preferred over `memory show`) |
| `search_memory` | search memory text (preferred over `memory search`) |
| `append_to_page` | append to a page when writes are enabled |
| `status` | read counts and token ratio |

- Prefer MCP tools over shell commands when both surfaces are available.
- Confidence-tag non-trivial claims with `extracted`, `inferred`, or `ambiguous`.
- Keep memory edits focused; update the minimal relevant pages.
- Never call `memory clear` without explicit user request.
