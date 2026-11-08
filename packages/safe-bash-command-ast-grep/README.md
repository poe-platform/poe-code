# Structural search with ast-grep

Find code by syntax instead of text, then rewrite just the matched spans. `ast-grep` and its `sg` alias operate on your Safe Bash virtual filesystem without invoking a native executable.

```ts
import { Shell, createMemoryFileSystem } from 'poe-code/safe-bash';
import { astGrepCommands } from 'poe-code/safe-bash/ast-grep';

const fs = createMemoryFileSystem();
await fs.writeFile('/example.ts', new TextEncoder().encode('console.log(value);'));
const shell = new Shell({ fs, cwd: '/' }).use(astGrepCommands());
await shell.exec("sg -p 'console.log($VALUE)' --json example.ts");
await shell.exec("sg run -p 'console.log($$$ARGS)' -r 'logger.info($$$ARGS)' -U example.ts");
```

| Option | Purpose |
| --- | --- |
| `-p`, `--pattern` | Structural pattern, including `$NAME`, `$_`, `$$$ARGS` |
| `-r`, `--rewrite` | Replacement template in default / `run` mode; previews until `-U` |
| `scan -r RULE.yml` / `scan --inline-rules YAML` | YAML rules, including multiple documents or a sequence |
| `-l`, `--lang` | `ts`, `tsx`, `js`, `jsx`, `json`, `yaml`, `html`, `css`; otherwise inferred from filenames |
| `--json[=pretty\|compact\|stream]` | Array output or one JSON match per line |
| `-U`, `--update-all` | Write changed content back to virtual files |
| `--stdin` | Read input from a pipeline; `run` requires `--lang` |
| `--globs GLOB` | Repeatable inclusion glob; prefix with `!` to exclude |
| `--heading[=always\|never\|auto]` | File headings; `auto` uses noninteractive output |
| `-A N`, `-B N`, `-C N` | Context after, before, or around matches |

Paths default to the current virtual directory. Directory traversal skips symlinks and files with unknown language extensions. Explicit `--lang` parses selected files in that language. Glob exclusions override inclusions. Exit codes are 0 for matches, 1 for no matches, and 2 for invalid input or execution errors. Cancellation propagates to the caller.

```yaml
id: use-logger
language: TypeScript
rule:
  all:
    - pattern: console.log($VALUE)
    - inside: { kind: FunctionDeclaration }
fix: logger.info($VALUE)
message: Use the application logger
severity: warning
```

Rules support the engine's `pattern`, `kind`, `regex`, `all`, `any`, `not`, `inside`, `has`, `follows`, and `precedes` fields. Kind names follow the [AST engine](../ts-ast/README.md). Unsupported rule fields fail explicitly. Supply rule files or inline rules explicitly; project configuration discovery and interactive rewrite approval are not implemented.

Rewrites preserve UTF-8 source outside changed spans. Nested matches use the outermost replacement; conflicting edits from separate rules fail before writing that file. Updates commit one file at a time, so earlier files can remain updated if a later file fails. Stdin rewrites are previews; `-U` requires files.

`createAstGrepCommand()`, `createAstGrepCommands()` and `astGrepCommands()` accept `AstGrepCommandsOptions`. Limits may be passed directly or under `limits`: `maxInputBytes` (8 MiB total), `maxOutputBytes` (16 MiB, including rewritten files), `maxFiles` (10,000), `maxMatches` (10,000), and `maxDirectoryEntries` (50,000). Positive finite integers are required. The AST matcher runs synchronously within each bounded file; these are byte/count limits, not a CPU deadline. Set `replace: true` to replace existing registrations.

The plugin is also exported from `poe-code/safe-bash/commands/ast-grep`. The matching `@poe-platform/safe-bash` subpaths expose the same APIs. The parser, matcher and rewriter are available from `/ts-ast`. This private workspace bundles its parser, YAML reader and glob matcher; consumers do not install it separately.

## Native compatibility checks

JSON ranges retain UTF-8 byte offsets and use Unicode character columns, matching
native ast-grep. Capture metadata includes full ranges, single/variadic maps and
`transformed`; repeated metavariables report the last unified occurrence.

The checked-in corpus records ast-grep 0.45.3 results for TS, TSX, JS, JSON and
YAML. Unit tests compare both command aliases and the engine against it, and
also compare against an installed `ast-grep` or `sg`. Set `AST_GREP_BINARY` to
select a native executable. Live stdin rewrite comparisons remove only the one
newline added by native stdout rendering, preserving source line endings.

Run `npm run test:native --workspace=safe-bash-command-ast-grep` for native JSON
and actual file rewrites with both update flags. This integration check uses a
cleaned temporary directory under `out`; unit tests never write source files.
Missing native tools are reported as skipped, while recorded comparisons still run.

The engine deliberately supports populated middle variadics such as
`fn($A, $$$MID, $Z)`, including nested calls. Native 0.45.3 only matches the
empty-middle case for that pattern. The shared differential corpus covers the
empty case; engine stress tests retain the populated-case behavior.
