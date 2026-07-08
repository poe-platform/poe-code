# UX: plan --help uses stacked single-column layout; exposes internal markdown commands

## Summary

`plan --help` has two issues:

### 1. Stacked option layout instead of two-column

Options and their descriptions are stacked vertically (name on one line, description indented below) instead of the two-column side-by-side layout used by every other command:

```
--agent <name>
  Agent to run the plan session with
--kind <kind>
  Filter by plan kind: plan, pipeline, experiment, ralph, superintendent, or
  superintendent-base
```

Compare with `configure --help`, `pipeline run --help`, etc., which all use a wide two-column layout. The stacked style looks like a different CLI entirely.

### 2. Internal markdown reader subcommands exposed at the top level

The Commands section includes:
```
markdown-read [options] <file>          Read a markdown file and print its table of contents.
markdown-read-section [options] <file> <section>  Read one section from a markdown file.
markdown-reader-mcp                     Run the standalone markdown reader MCP server.
```

These are low-level implementation utilities, not user-facing plan management commands. They appear alongside `browse`, `list`, `edit`, `delete` — creating a confusing mixed list.

## Evidence

Screenshot shows stacked layout for Options and all three `markdown-*` commands in the Commands list.

## Why it matters

The stacked layout breaks visual consistency with the rest of the CLI. The `markdown-*` commands obscure the actual plan management commands and expose internal details that most users will never need.

## Suggested direction

1. Switch to the standard two-column layout for Options.
2. Move `markdown-read*` commands to a separate "Advanced:" section or remove them from the top-level Commands list entirely.

## Severity

Medium

## Area

Plan / help / formatting / discoverability
