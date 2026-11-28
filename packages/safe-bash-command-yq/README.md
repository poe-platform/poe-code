# YAML and TOML queries

The default `createYqCommand()`, `createYqCommands()`, and `yqCommands()`
use the Mike-yq profile with document, comment, alias and in-place editing support. Commands execute
against the shell's virtual filesystem, using Web APIs in Workers without a global `Buffer`.
In-place and split-file writes share the shell's configured output budget.
JSON input is decoded incrementally from stdin or the injected filesystem: ordinary
evaluation finishes each document's output before consuming the next document.
Completed output can precede a later input error. Each individual document still
uses an in-memory node model; `eval-all` retains all documents, and YAML and other
formats still buffer input. This is not a bounded-memory guarantee for arbitrary queries.
Resource quotas default to `Infinity`;
configure finite byte, work, node, alias or depth limits when needed.
The internal `safe-bash-command-yq/query` legacy query profile also accepts `limits.maxSourceLines` to bound YAML lines,
including comments and document separators; it defaults to `Infinity`. Explicit
`Infinity` disables an individual quota. The default profile requires the
optional `yaml@2.9.0` peer.

```ts
import { Shell, createMemoryFileSystem, standardCommands } from "@poe-platform/safe-bash";
import { yqCommands } from "@poe-platform/safe-bash/commands/yq";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(standardCommands()).use(yqCommands());
await shell.exec("printf 'name: example\\n' | yq '.name'");
await shell.dispose();
```

The default factories support `-i`, `-n`, `-e`, `ea`, `-P`, and `-I`. Both profiles
accept attached format flags such as `-p=yaml`, `-p=toml`, and `-o=json`.
The profile also supports maps with quoted or identifier keys (`{name: .name, count: 5}`),
or select fields with shorthand (`{name}` means `{name: .name}`).
Use optional traversal such as `.a?`, `.a.b.c?`, or `.["a"]?` to skip incompatible
values. Missing map keys still produce `null`; optional iteration uses `.[]?`.
Pipe binds more tightly than union: `.a | upcase, length` applies `length` to the
original document. Use `.a | (upcase, length)` to apply both operations to `.a`.
Use `key` to get a selected node's map key or array index, and `parent` or
`parent(n)` to select its containing node or an ancestor `n` levels up.
Filter with `select(.tags | contains(["x"]))`; `contains` matches string substrings,
array subsets, and recursively contained map values.
Decode embedded documents with `.c | from_json | .d` or `.a | from_yaml | .b`.
Format values with string interpolation, for example `"name=\(.name)"`.
Join array values into a string with `join(", ")`, or select names first with
`.items | map(.name) | join(",")`.
Bind values with `.a as $v | {"k": $v}`, or merge files with
`yq ea '. as $item ireduce ({}; . * $item)' a.yml b.yml`.
Merge flags append arrays (`*+`), merge arrays by index (`*d`), update only existing
keys (`*?`), or add only new keys (`*n`). Combine flags, for example
`yq ea 'select(fi == 0) *?+ select(fi == 1)' a.yml b.yml`.
Use `.a |= sub("o", "0")` to replace every regex match in a string while preserving
its YAML style and comments. Replacements support `$1`, `${name}`, and `$$` for a
literal dollar sign, using the shared bounded regex engine and configured work
and scalar-byte limits.
The package and command entrypoints also export `createMikeYqCommand`,
`createMikeYqCommands`, and `mikeYqCommands` explicitly.
`@poe-platform/safe-bash/yq` exports the same Mike-yq profile. Register one profile
at a time, or explicitly request replacement under the shell registry's existing
collision policy. This workspace is internal; its implementation ships through
the established Safe Bash exports.
