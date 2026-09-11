# Optional Safe Bash tools

This workspace builds the separately installed `@poe-platform/safe-bash-optional`
package for Node.js 22 or later. Install it with the exact same release versions
of `@poe-platform/safe-bash` and `@poe-platform/safe-fs`. Publication requires the
GitHub release and npm setup described in `docs/development/NPM_PUBLISHING.md`.

```ts
import { Shell, agentCommands } from "@poe-platform/safe-bash";
import { createMemoryFileSystem } from "@poe-platform/safe-fs";
import { arraysExtension, readExtension, yesCommands } from "@poe-platform/safe-bash-optional";

const shell = new Shell({
  fs: createMemoryFileSystem(),
  extensions: [arraysExtension(), readExtension({ nonTerminalInput: true })],
}).use(agentCommands()).use(yesCommands());
try {
  const result = await shell.exec("yes ready | head -n 1");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

The package exports `yesCommands`, `cmpCommands`, `ddCommands`, `shufCommands`,
`truncateCommands`, `installCommands`, and `yqCommands`, with corresponding
`create*Command` and `create*Commands` factories. These implement bounded command
profiles, not complete GNU or Bash compatibility. `yqCommands` uses the Mike
Farah profile and requires the optional peer `yaml@2.9.0`; install that peer
explicitly when using yq. Missing YAML produces an explicit command failure.

`arraysExtension`, `jobsExtension`, `mapfileExtension`, `readExtension`, and
`trapExtension` opt into shell features through `Shell`'s `extensions` option.
`createDeviceFileSystem()` creates a separate device filesystem for explicit
mounting. Importing this package does not register tools, install extensions,
or mount devices. Convenience exports `Shell` and `agentCommands` refer to the
installed core peer. Do not mix factories with a second copy of that runtime.

## Configuration

All command plugins accept optional `replace` to replace an existing registration.
Current core defaults already register `cmp`, `shuf`, and `truncate`; pass
`{ replace: true }` when installing these optional variants into `agentCommands()`.
Their other options are:

| Factory | Options |
| --- | --- |
| `yesCommands` | `maxRecordBytes` bounds one output record; `chunkBytes` bounds output writes. |
| `cmpCommands` | `comparisonBlockBytes` controls comparison reads; `limits.maxChunkBytes` and `limits.maxFallbackBytes` bound streamed and fallback input. |
| `ddCommands` | `maxBlockBytes`, `maxBufferBytes`, `maxTransferBytes`, `maxReadOperations`, and `maxArgumentBytes` bound work; `now` injects the clock; `openFile` injects a `DdFileOpener` returning explicit file operations. |
| `shufCommands` | `maxInputBytes` bounds retained input; `maxSampleSize` bounds the sample. |
| `truncateCommands` | `ioBlockSize(path, stat, context)` supplies block-size information; `seekEnd(path, stat, context)` measures nonregular inputs. |
| `installCommands` | `identity.uid` and `identity.gid` provide identity; `resolveUser` and `resolveGroup` resolve names; `chown`, `setMode`, `strip`, and `renameExclusive` inject host operations; `maxFileBytes` bounds files. `securityContext.enabled`, `.apply`, and `.matches` configure explicit security-context operations. |
| `yqCommands` | `limits` can lower `maxInputBytes`, `maxDocumentBytes`, `maxScalarBytes`, `maxNodes`, `maxParserNodes`, `maxDepth`, `maxAliases`, `maxDocuments`, `maxOutputBytes`, and `maxSteps`. |

`readExtension` accepts `nonTerminalInput` for an explicitly nonterminal input
profile. `trapExtension` accepts `signalNames`, a name-to-number map, and
`signalHost`, whose `subscribe(deliver, scope)` returns an unsubscribe function.
`mapfileExtension({ replace: true })` explicitly replaces current core `mapfile`
and `readarray` builtins with the optional variant. Omitting `replace` preserves
duplicate-builtin rejection. The arrays, jobs, and device factories have no
configuration options.
Exported TypeScript types describe callback arguments and return values.

## Environment

This package does not read host process environment variables. Commands use the
explicit shell environment: `POSIXLY_CORRECT` affects option parsing for yes,
cmp, shuf, truncate, and install; `SIMPLE_BACKUP_SUFFIX` and `VERSION_CONTROL`
configure install backups. Yq environment expressions read the named values
from that same shell environment. Shell extensions use their host's variable
bindings, including `IFS` for input splitting.

## Workspace development

From the repository root, build this workspace and its declared dependencies:

```sh
npm run build:workspaces -- --workspace=@poe-code/safe-bash-optional
npm run test:unit --workspace=@poe-code/safe-bash-optional
```

The build accepts no command-line options or package-specific environment
variables. The maintained artifact generator's `--include-optional` option
includes the separate package; its default still prepares only the three core
safe libraries. Publication happens in GitHub Actions.
