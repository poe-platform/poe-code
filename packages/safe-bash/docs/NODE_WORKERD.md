# Optional node command in workerd

`@poe-platform/safe-js/workerd` supplies the bounded interpreter for the optional
`node` command. This profile requires workerd's Node compatibility APIs. It was
tested with workerd 2026-09-04 and compatibility date `2026-09-04`, where
`nodejs_compat` is enabled by default. It is not a general browser runtime.

Use these public exports:

```js
import { Shell } from "@poe-platform/safe-bash";
import { nodeCommands } from "@poe-platform/safe-bash/commands/node";
import { createMemoryFileSystem } from "@poe-platform/safe-fs/core";
import {
  run, Budget, makeFsModule, declareHostOperation,
} from "@poe-platform/safe-js/workerd";

const runtime = {
  run, makeFsModule, declareHostOperation,
  createBudget: options => new Budget(options),
};

export default {
  async fetch() {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(nodeCommands({ runtime, limits: {
      maxSourceBytes: 65536, maxInputBytes: 65536, maxOutputBytes: 65536,
      timeoutMs: 5000, maxSteps: 100000, maxCallDepth: 128,
      stringLength: 1048576, arrayLength: 100000, dataSize: 16777216,
    } }));
    try {
      const result = await shell.exec(`node -e '
        const fs = require("node:fs/promises");
        await fs.writeFile("/result", "virtual output");
        console.log(await fs.readFile("/result", "utf8"));
      '`);
      return new Response(result.stdout + result.stderr, {
        status: result.exitCode === 0 ? 200 : 500,
      });
    } finally { await shell.dispose(); }
  },
};
```

Install matching published versions of the three packages. Bundle the application
as an ES module with Node platform resolution and the **workerd condition only**:

```sh
npx esbuild worker.mjs --bundle --platform=node --conditions=workerd \
  --format=esm --target=es2022 --outfile=bundle.mjs
```

Deploy the resulting module without rebundling it under browser conditions, to a
Worker using the compatibility date above. The root `safe-bash` workerd condition
selects the portable shell; the runtime's filesystem bridge uses Node
compatibility APIs with the supplied VFS adapter. Adding `browser` to the
dependency-resolution conditions selects different filesystem exports and is
not this supported build profile. Default Wrangler/browser bundling is not
qualified by this procedure. No application interpreter shim is required.

The command supports `node -e`, `node -p`, VFS script files, and asynchronous
`fs` imports or `require("fs/promises")` / `require("node:fs/promises")`.
Supply the filesystem through `Shell`; do not use this profile's `makeFsModule`
without an adapter. Ambient host filesystem access, synchronous native `fs`,
native module loading, and npm are outside this profile.

Pass an `AbortSignal` to `shell.exec` to cancel execution. The original reason is
preserved, including falsey reasons. Completed VFS effects remain; subsequent
guest work is stopped. `dataSize`, `stringLength`, and `arrayLength` bound
interpreter-managed data, not total workerd process RSS. The step, call-depth,
source, input, output, and deadline limits remain active. Captured host
DOMExceptions expose their native numeric code only on platforms with a trusted
DOMException code getter; workerd does not provide that getter.

The default preset does not register `node`, `safejs`, or `op`. Installing this
plugin registers only `node`. On a Node host, the worker-thread provider is
available explicitly from
`@poe-platform/safe-bash/commands/node/host`; it is excluded from Worker/browser
resolution and from the ordinary `commands/node` module graph.

The installed-package acceptance fixture is
`tests/integration/optional-node-workerd/worker.mjs`. Its native `workerd test`
run checks VFS I/O, individual budget axes, runaway refusal, overlapping
executions, cancellation with late host completion, subsequent recovery, and
default-preset exclusions. Follow the repository's
`docs/plans/issue-699-worker-node.md` for artifact validation.
