# Safe Bash Node

Run JavaScript in QuickJS with the same safe-fs filesystem and command registry as your safe-bash shell. Guest code receives virtual Node APIs; it cannot load native Node modules or start host processes.

```ts
import { Shell, createMemoryFileSystem, standardCommands } from '@poe-platform/safe-bash';
import { nodeCommands } from '@poe-platform/safe-bash/commands/node/quickjs';

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(standardCommands())
  .use(nodeCommands());
const result = await shell.exec(`node -e 'const fs = require("fs"); fs.writeFileSync("/answer", "42"); console.log(require("child_process").execSync("cat /answer", {encoding:"utf8"}));'`);
console.log(result.stdout); // 42
```

| Capability | Supported interface |
| --- | --- |
| JavaScript | QuickJS ECMAScript, `node -e`, `node -p`, virtual script files, stdin scripts, `--` |
| CommonJS | `require` with explicit relative/absolute filenames; JavaScript and JSON modules, cached per invocation |
| Files | `fs.readFileSync`, `writeFileSync`, `existsSync`, `statSync`, `mkdirSync`; `node:fs` alias |
| Processes | `child_process.execSync` through safe-bash `sh -c`; `execFileSync` through literal safe-bash dispatch; `encoding` option |
| Data | `Buffer.from`, `alloc`, `isBuffer`, UTF-8 text and byte arrays |
| Paths | POSIX `resolve`, `join`, `dirname`, `basename`, `extname`; `node:path` alias |
| I/O | `console.log`, `console.error`, `process.stdout.write`, `process.stderr.write` |
| Context | Virtual `process.argv`, `process.env`, `process.cwd()`, `process.exitCode` |

This is a synchronous CommonJS profile, not the full Node.js runtime. ESM, npm resolution, native addons, timers, asynchronous filesystem/process APIs and event-loop execution are unsupported. Pending promise jobs cause failure. Text encodings other than UTF-8 are rejected. Filesystem permissions and remote access come from the shell's configured safe-fs provider; no ambient host filesystem is installed. `execFileSync` arguments are passed literally, without shell interpolation. Nonzero child status throws an error with `status` and `stdout`.

Each invocation owns a fresh QuickJS WASM instance. `nodeCommands({ limits, replace })` configures finite positive budgets: `memoryBytes` (32 MiB guest heap), `sourceBytes` (1 MiB including loaded modules), `fileBytes` (4 MiB per data operation), `outputBytes` (1 MiB for command output or captured child output), `operations` (1,000 bridge calls), and `timeoutMs` (5,000). The deadline interrupts guest computation and signals filesystem and child operations; host providers must cooperate with cancellation. These are guest/operation budgets, not a host process RSS limit. Use `replace: true` when intentionally replacing an existing Node command.

The private workspace also exports `createNodeCommand`, `createNodeCommands`, `NodeCommandsOptions` and `NodeLimits`.
