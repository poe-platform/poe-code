# safe-bash

Run shell scripts and command-line tools in your application against an explicit filesystem, without launching a host shell.

## Quickstart

Import from `poe-code/safe-bash` in a Node.js 22+ ESM application. Use a
`poe-code` version that includes this entry point; no separate package is needed.

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "poe-code/safe-bash";

const fs = createMemoryFileSystem();
const encoder = new TextEncoder();
await fs.mkdir("/work");
await fs.writeFile("/work/names.txt", encoder.encode("Ada\nGrace\nAda\n"));
await fs.writeFile("/work/run.sh", encoder.encode(`#!/bin/sh
set -eu
sort names.txt | uniq > names.sorted.txt
printf 'Hello, %s!\\n' "$1"
cat names.sorted.txt
`));

const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
try {
  const result = await shell.exec("sh run.sh reader");
  if (result.exitCode !== 0) throw new Error(result.stderr);
  process.stdout.write(result.stdout);
} finally {
  await shell.dispose();
}
```

Output: `Hello, reader!\nAda\nGrace\n`. The script, input, and generated
`names.sorted.txt` stay in memory. Results contain `exitCode`, `stdout`, `stderr`,
`stdoutBytes`, and `stderrBytes`; use the byte fields for binary output.
Each `exec()` starts fresh shell variables, functions, and working-directory state;
filesystem changes persist in the supplied `fs`.

## Browsers and Workers

Use `poe-code/safe-bash/browser` for a portable Shell with an explicit command
subset. Bundle as ESM with `platform: "browser"` and
`conditions: ["workerd", "worker", "browser"]`; the `browser` condition selects
the canonical portable filesystem. No `nodejs_compat` flag or Node globals are
required. The regular `poe-code/safe-bash` entry remains the Node API.

```ts
import { Shell, browserCommands } from "poe-code/safe-bash/browser";
import { createMemoryFileSystem } from "poe-code/safe-fs/core";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs, limits: { maxCommands: 100, maxOutputBytes: 65536 } })
  .use(browserCommands());
try {
  const result = await shell.exec("printf 'hello\\n' > /note; cat /note");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

`browserCommands({ replace?: boolean })` registers **28 commands**: `true`, `false`,
`echo`, `printf`, `pwd`, `basename`, `dirname`, `mkdir`, `touch`, `cp`, `mv`, `rm`,
`rmdir`, `ln`, `readlink`, `realpath`, `ls`, `test`, `[`, `cat`, `head`, `tail`, `wc`,
`tee`, `tr`, `sort`, `uniq`, and `cut`. Replacement defaults to `false`.
`createBrowserCommands()` returns the same definitions for custom registration.

Shell builtins, virtual scripts, pipelines, budgets, cancellation, and disposal
remain available. Inject a canonical filesystem or compose memory/read-only/mount
adapters from `poe-code/safe-fs/core`; filesystem and error identity are shared.
The core's portable `posixPath` exposes `basename`, `dirname`, `extname`, `join`,
and `isAbsolute`. Node-only adapters and command packs are not included;
`[[ … =~ … ]]` explicitly returns status 2. Use the Node entry for regex-worker
commands such as `grep`, `sed`, and `rg`.

## Supported features and commands

### Shell syntax

- Quoting and escapes, variables and positional arguments, parameter expansion,
  `$(command)` and backtick substitution, arithmetic expansion, and pathname globs.
- Pipelines (`|`, `|&`), lists (`;`, `&&`, `||`, `!`), file redirection (`<`, `>`,
  `>>`), descriptor redirection such as `2>&1`, here-documents, and here-strings.
- `if`/`elif`/`else`, `case`, `for name in …`, `while`, `until`, functions,
  groups `{ …; }`, subshells `( … )`, `[[ … ]]`, `(( … ))`, and indexed arrays.
- Virtual script files through `sh`, `bash`, or executable paths; `source`/`.`
  runs a script in the current shell. `set -e`, `set -u`, and `set -o pipefail`
  control failures; `shopt -s dotglob` includes dotfiles in globs.

Shell builtins beyond the tools below: `:`, `cd`, `pushd`, `popd`, `dirs`, `set`,
`shift`, `export`, `local`, `readonly`, `unset`, `read`, `getopts`, `let`, `shopt`,
`exit`, `return`, `break`, `continue`, `command`, `builtin`, `type`, `.`, `source`,
`eval`. `pwd`, `true`, and `false` also work without a command bundle.

### Command bundle

`agentCommands()` registers all **79 commands** below. They operate on the supplied
filesystem and byte streams, not host executables.

| Purpose | Commands |
| --- | --- |
| Browse | `pwd`, `ls`, `tree`, `find`, `du`, `file`, `basename`, `dirname`, `realpath`, `readlink`, `which` |
| Files | `mkdir`, `touch`, `cp`, `mv`, `rm`, `rmdir`, `ln`, `chmod`, `stat`, `mktemp` |
| Filter/search | `cat`, `head`, `tail`, `wc`, `tee`, `cut`, `tr`, `sort`, `uniq`, `sed`, `awk`, `grep`, `rg`, `egrep`, `fgrep` |
| Format/combine | `nl`, `seq`, `rev`, `tac`, `expand`, `unexpand`, `fold`, `strings`, `paste`, `comm`, `join`, `column`, `split` |
| Structured text | `jq`, `html-to-markdown` |
| Bytes/checksums | `base64`, `base32`, `xxd`, `od`, `md5sum`, `sha1sum`, `sha256sum`, `cksum` |
| Archives | `gzip`, `gunzip`, `zcat`, `tar` |
| Script helpers | `echo`, `printf`, `true`, `false`, `test`, `[`, `env`, `printenv`, `xargs`, `expr`, `date`, `sleep`, `timeout` |
| Changes/review | `diff`, `patch`, `apply_patch` |

### Opt-in commands and storage

These plugins are separate from `agentCommands()`; pass them to `shell.use(...)`.

| Command | Plugin and configuration |
| --- | --- |
| `curl` | `networkCommands({ authorize, transport?, limits?, replace? })`: required authorization on every request, redirect, and retry. The default transport makes real HTTP(S) requests; inject `transport` for mocks. [Options and limits](src/commands/network/types.ts). |
| `node` | `nodeCommands({ runtime, limits?, replace? })`: runs JavaScript with an injected SafeJS runtime, virtual files, and shell streams. [Usage and supported subset](src/commands/node/README.md). |
| `safejs` | `safeJsCommands({ runtime, limits?, replace? })`: inject `run`, `createBudget`, `makeFsModule`, and `declareHostOperation` to execute programs. [Runtime contract](src/commands/safejs/types.ts). |

Storage can be in memory, a rooted host directory, S3-compatible storage, or WebDAV,
with read-only wrappers, mounts, and overlays. Choose and configure it explicitly;
see the [filesystem guide](../safe-fs/README.md).

### Run JavaScript with SafeJS

Plug SafeJS into `node`; nothing starts a native Node.js subprocess or loads a
runtime automatically. The same runtime object can also power `safeJsCommands`.

```ts
import { Shell, agentCommands, createMemoryFileSystem, nodeCommands } from "poe-code/safe-bash";
import { Budget, run, makeFsModule, declareHostOperation } from "poe-code/safe-js";

const fs = createMemoryFileSystem();
await fs.writeFile("/transform.js", new TextEncoder().encode(`
  import { writeFile } from "fs";
  const text = await process.stdin.readText();
  await writeFile("/result.txt", text.toUpperCase());
  console.log(process.argv[2]);
`));

const shell = new Shell({ fs }).use(agentCommands()).use(nodeCommands({
  runtime: {
    run, makeFsModule, declareHostOperation,
    createBudget: options => new Budget(options),
  },
}));

try {
  const result = await shell.exec("printf 'hello\\n' | node /transform.js done; cat /result.txt; node -p '1 + 2'");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

Output: `done\nHELLO\n3\n`.

`node -e SOURCE` evaluates a program; `node -p EXPRESSION` prints an expression.
`node FILE`, `node -`, and bare `node` accept virtual-file or stdin source.
Programs get `console`, virtual `process.argv`, `process.env`, `process.cwd()`,
`process.exitCode`, and shell streams. Await `process.stdout.write(text)` and
`process.stderr.write(text)`; read input with `process.stdin.readText()` or
`readBytes(size?)`. These are bounded async helpers, not native Node streams.

Import async filesystem functions from `"fs"`, or use
`const fs = require("node:fs/promises")`. SafeJS imports use bare module names:
`import … from "node:fs/promises"` is not supported. There is no synchronous fs,
package/local-module loading, `process.exit()`, or native module fallback.
Pass `limits` for source/input/output bytes, timeout, and interpreter budgets;
see [defaults and configuration](src/commands/node/README.md#configuration).

## Add a command

A `CommandDefinition` has a name and an `execute(context)` handler. This example
adds `file-bytes`, which reports a virtual file's size without reading its contents:

```ts
import {
  Shell, agentCommands, createMemoryFileSystem, resolvePath, writeText,
  type CommandDefinition,
} from "poe-code/safe-bash";

const fileBytes: CommandDefinition = {
  name: "file-bytes",
  async execute({ args, cwd, fs, stdout, stderr, signal }) {
    if (args.length !== 1) {
      await writeText(stderr, "Usage: file-bytes FILE\n");
      return { exitCode: 2 };
    }
    const stat = await fs.stat(resolvePath(cwd, args[0]!), { signal });
    await writeText(stdout, `${stat.size}\n`);
    return { exitCode: 0 };
  },
};

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
shell.use({
  name: "file-tools",
  setup(host) { host.commands.register(fileBytes); },
});
try {
  const result = await shell.exec("printf 'hello\\n' > message.txt; file-bytes message.txt | cat");
  if (result.exitCode !== 0) throw new Error(result.stderr);
  process.stdout.write(result.stdout);
} finally {
  await shell.dispose();
}
```

Output: `6\n`. For a single command, use `shell.register(fileBytes)` instead of a
plugin. Duplicate names fail unless registration explicitly sets `{ replace: true }`.
Handlers receive `args`, `stdin`, `stdout`, `stderr`, `cwd`, `env`, `fs`, and `signal`;
return `{ exitCode }` with an integer from 0–255, await writes, and pass the signal to I/O.
Use `context.invoke` to call another command with literal arguments rather than
interpolating shell source. [Command contract](src/contracts/command.md).

`shell.use(middleware)` wraps command dispatch for logging or policy checks;
middleware must await or return `next()`. Plugins can also register filesystem
factories and provide a `dispose()` hook. [Plugin contract](src/contracts/plugin.ts).
For SafeJS host integration, `makeSafeJsShellModule` exposes shell execution and
`makeSafeJsFsModule` adapts the filesystem through injected runtime hooks.
[Integration contracts](src/integrations/safejs/index.ts).

## Options

### Shell and execution

| `new Shell(...)` option | Behavior |
| --- | --- |
| `fs` | Required filesystem; no implicit host access. |
| `cwd` | Initial virtual directory; defaults to `/`. |
| `env` | Initial exported variables; defaults to an empty map, with `PWD` set from `cwd`. No host environment inheritance. |
| `commands` | Existing `CommandRegistry`; defaults to an empty registry. |
| `limits` | Resource limits listed below. |

`exec(source, options)` can override `fs`, `cwd`, and `limits`, and merge `env` for
one execution. `stdin` accepts a string, `Uint8Array`, or async byte source;
`stdout`/`stderr` accept byte sinks. Results still buffer output when sinks are
provided. Pass an `AbortSignal` as `signal` to cancel. [Option types](src/shell/types.ts).

| Limit | Default |
| --- | --- |
| `maxInputBytes` | 32 MiB per redirected input (`<`), independent of output; applies to buffered and streaming reads. |
| `maxOutputBytes` | 16 MiB |
| `maxCommands`, `maxLoopIterations` | 10,000 each |
| `maxSubstitutionDepth` | 64 |
| `maxSourceBytes` | 1 MiB |
| `maxExpansionFields` | 10,000 |
| `maxExpansionBytes` | 16 MiB |
| `pipeHighWaterMark` | 64 KiB |

Always call `dispose()` when finished. Shell failures normally produce an exit
code and stderr; limit violations, cancellation, and host failures can reject `exec()`.

### Command configuration

`agentCommands()` accepts `replace` (default `false`), an `execute` fallback for
nested command dispatch, and `regex` worker limits. Per-family options are
`text`, `structured`, `search`, `diffPatch`, `metadata`, `archive`, `tableText`,
`streamInspection`, `streamFormat`, `split`, `timeEnv`, `tree`, `file`, `column`,
`htmlToMarkdown`, `du`, `expr`, `which`, `timeout`, and `applyPatch`.
Use the [typed options and linked family interfaces](src/plugins/index.ts) for
their individual limits and hooks, including clocks and schedulers. Family budgets
are separate from shell limits; `replace` applies across the entire bundle.

### Environment variables

There are no package-specific runtime environment switches. Supply these through
`env` or set/export them inside a script; they refer to the virtual environment:

| Variables | Effect |
| --- | --- |
| `HOME`, `CDPATH`, `PWD`, `OLDPWD` | Home expansion, directory search, current and previous directory. The shell maintains `PWD`/`OLDPWD` on directory changes. |
| `PATH` | Virtual script lookup and `which`; never a host executable search. |
| `IFS` | Field splitting and `read`; defaults to space, tab, and newline. |
| `LC_ALL`, `LC_CTYPE`, `LC_COLLATE`, `LANG` | Character and collation behavior where supported; locale support varies by command. |
| `TMPDIR` | `mktemp` directory; defaults to `/tmp`, which must exist in the VFS. |
| `TZ` | `date` timezone; otherwise `timeEnv.defaultTimeZone` (default `UTC`). |
| `QUOTING_STYLE` | `stat` filename quoting: `literal`, `shell-always`, or `shell-escape-always`. |

`getopts` starts with `OPTIND=1` and `OPTERR=1`, updates `OPTIND`/`OPTARG`, and
honors changes made in the script. `PIPESTATUS` exposes pipeline stage statuses.
`curl` does not read proxy variables, host credentials, `.curlrc`, or `.netrc`.

## Limitations

- This is a Bash-like interpreter, not full Bash or POSIX certification. No
  background jobs/job control, `trap`, `exec`, process substitution, brace expansion,
  associative arrays, or C-style `for ((…))` loops. `shopt` supports only `dotglob`.
- Utilities implement subsets of their native counterparts' flags and behavior.
  There is no `git`, `npm`, `npx`, or fallback to installed host programs.
  The opt-in `node` command is not a general Node.js runtime.
- Plugins, filesystem adapters, and runtime providers are trusted host JavaScript,
  not sandboxed code. Real storage and network plugins grant real access; URL
  allowlisting alone does not pin DNS or prevent access to private addresses.
- Cancellation is cooperative, including `timeout`; it cannot undo completed
  effects or stop uncooperative host work. Limits do not bound total process memory.
