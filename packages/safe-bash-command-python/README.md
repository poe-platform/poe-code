# Python for Safe Bash

Run Python commands against your shell's virtual filesystem, with explicit runtime,
package, and host-service configuration through Safe Bash's public exports.

```ts
import { Shell } from "@poe-platform/safe-bash";
import { pythonExecutorCommands } from "@poe-platform/safe-bash/commands/python/executor";

const shell = new Shell({ fs });
shell.use(pythonExecutorCommands({ createExecutor }));
const result = await shell.exec('python3 -c "print(42)"');
```

Provide `fs` and a trusted `createExecutor` for your application. Executor, JSPI,
worker, and Docker profiles retain their own runtime prerequisites. Runtime assets
and package provisioning remain explicitly configured; JavaScript interoperability
does not isolate untrusted Python from its host.

- `python` and `python3`: inline code, stdin, modules, and VFS scripts.
- Executor pooling, cancellation, cleanup, and bounded filesystem replies.
- Package provisioning with cache and manifest support.
- Optional shell and LLM host capabilities.

Use `PythonCommandsOptions` to configure limits, runtime providers, and packages.
Existing default command behavior and registration collision rules are unchanged.
This package is internal and bundled into Safe Bash; consumers use the public
Safe Bash paths above, including `/commands/python/node`, `/worker`, and `/docker`.
