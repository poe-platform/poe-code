# safe-bash

Run shell scripts and familiar command-line tools inside TypeScript applications,
using a filesystem you choose rather than a host shell.

| Task | API |
| --- | --- |
| Run scripts or pipelines | `shell.exec(...)` |
| Get text or bytes | `stdout` / `stderr`, `stdoutBytes` / `stderrBytes`, `exitCode` |
| Add tools or storage | Plugins and an explicit filesystem |

## Quickstart

Requires **Node.js 22+**, ESM, and a built checkout; see availability below.
In an already provisioned checkout, run `npm run build`, save this as
`example.mts` inside the repository, then run `node --import tsx example.mts`.

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
  console.log(result.stdout);
  if (result.exitCode !== 0) throw new Error(result.stderr);
} finally {
  await shell.dispose();
}
```

Output: `Hello, reader!\nAda\nGrace\n`. The script, input, and generated
`names.sorted.txt` stay in memory. `sh` launches no host process.

## Tool card

`Shell` handles script syntax, variables, loops, functions, and redirections.
**`agentCommands()` adds these 79 tools**, not networking or JavaScript execution:

| Default bundle | Commands |
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

**Restricted:** `which` searches virtual paths; `timeout` cancels cooperatively.
**Not included:** Git commands, `npm`, `npx`, or fallback to host executables.
Repository Git operations used to develop poe-code are unaffected.

### Opt-in tools

- **curl:** `networkCommands()` requires `authorize`; optional `transport` supports
  mocks. Without it, requests use real HTTP(S). Authorization runs on every hop;
  URL allowlisting is not DNS pinning.
  [Policy and limits](src/commands/network/README.md#host-contract).
- **node:** `nodeCommands()` requires a trusted provider/engine adapter; no engine
  loads implicitly.
  [Restricted Node profile](src/commands/node/README.md).
- **safejs:** `safeJsCommands()` requires injected runtime hooks, separately from
  Node.
  [Runtime options](src/commands/safejs/types.ts).

## Settings and boundaries

- Supply `fs`, `cwd`, `env`, and `limits` to `Shell`; `exec` also accepts `stdin`,
  output sinks, and `signal`. Host environment variables are not inherited.
  Use byte result fields for binary output.
  [All shell options](src/shell/types.ts).
- Always dispose in `finally`. Command-family limits are separate budgets, not
  one total-memory cap. [Bundle configuration](src/plugins/index.ts).
- Memory, rooted host, S3-compatible, WebDAV, mounts, and overlays are available.
  Host/remote access requires explicit configuration.
  [Filesystem guide](../safe-fs/README.md).

This is **not full Bash, Node, or utility parity**. Commands support bounded
subsets. Trusted host JavaScript, plugins, and providers are **not sandboxed**;
limits and cooperative cancellation do not provide host isolation or total-memory
guarantees. Enabling real storage or networking intentionally grants capabilities.

## Testing

Build and test with the workspace JavaScript/TypeScript dependencies; no GNU
binaries, native tool profiles, provisioning scripts or calibration lanes are
required. Existing captured output fixtures remain plain regression data. Pure
live-native comparisons are retired, not reported as passing compatibility tests.

## Test output

With `CI=true`, successful tests use concise progress and summaries; failures
retain names, stacks, diagnostics, stdout and stderr. Local defaults are unchanged.
For verbose package output use `CI=false npm run test:unit`; select Node's
reporter with `npm test -- --test-reporter=spec` (or `tap`). For root Vitest,
run `npm run test:unit -- --reporter=verbose --silent=false` from the repository root.

## Availability

**August 31, 2026:** npm `poe-code@13.0.10` does not yet export this API.
Use a built monorepo checkout with the public `poe-code/safe-bash` import;
the private `virtual-bash` workspace is not a standalone package to install.
