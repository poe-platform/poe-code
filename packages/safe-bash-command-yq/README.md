# YAML and TOML queries

The default `createYqCommand()`, `createYqCommands()`, and `yqCommands()`
use the Mike-yq profile with document, comment, alias and in-place editing support. Commands execute
against the shell's virtual filesystem, using Web APIs in Workers without a global `Buffer`.
In-place and split-file writes share the shell's configured output budget.
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
The package and command entrypoints also export `createMikeYqCommand`,
`createMikeYqCommands`, and `mikeYqCommands` explicitly.
`@poe-platform/safe-bash/yq` exports the same Mike-yq profile. Register one profile
at a time, or explicitly request replacement under the shell registry's existing
collision policy. This workspace is internal; its implementation ships through
the established Safe Bash exports.
