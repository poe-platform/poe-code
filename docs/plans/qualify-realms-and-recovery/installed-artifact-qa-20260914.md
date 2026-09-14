# Installed artifact qualification

Install each exact published version independently into an isolated consumer with
`npm install --ignore-scripts --no-audit --no-fund`. Confirm its package.json version,
registry SHA-512 and SLSA source commit/workflow. Retry missing registry metadata;
do not infer publication from a successful workflow alone. `npm audit signatures`
checks available signatures and attestations after installation.

For scoped SafeFS/Safe Bash, execute this stdin with `node --input-type=module`:

```js
import assert from "node:assert/strict";
import { createMemoryFileSystem, FsError } from "@poe-platform/safe-fs";
import { FsError as CoreError } from "@poe-platform/safe-fs/core";
import { Shell, createStandardCommands } from "@poe-platform/safe-bash";
const fs = createMemoryFileSystem();
await fs.writeFile("/value", new TextEncoder().encode("seven"));
assert.equal(new TextDecoder().decode(await fs.readFile("/value")), "seven");
assert.equal(FsError, CoreError);
await assert.rejects(
  () => fs.readFile("/missing"),
  (e) => e instanceof FsError && e.code === "ENOENT"
);
console.log("safe-fs independent read/write/error identity pass");
const shell = new Shell({ fs, cwd: "/" });
for (const command of createStandardCommands())
  if (["printf", "cat"].includes(command.name)) shell.register(command);
const result = await shell.exec("printf seven | cat");
assert.equal(result.exitCode, 0);
assert.equal(result.stdout, "seven");
console.log("safe-bash independent shell pipeline pass");
```

For SafeJS, execute the [ten-shape graph QA](shared-graph-boundary-audit-20260914.md),
changing only its import to `@poe-platform/safe-js`. Require every original/replay
value to be 7 and each host count to be 1. Repeat under Node and Bun for the wrapper
repair. Run the versioned metadata/rejection fixture against the same installed
entry to verify copied null prototypes, symbols, frozen collections and safe denial.

For root poe-code, repeat the graph and metadata controls through `poe-code/safe-js`,
run `poe-code --version`, and assert that `poe-code/safejs` and `poe-code/safe-js`
export the same `run` function. Record root and scoped outcomes separately.

Probe corrections retained: the first manually reconstructed FS smoke incorrectly
supplied a string where the documented API requires Uint8Array and rejected with
TypeError. After correcting input encoding, an unregistered Shell correctly returned
127 for the missing commands. The final fixture grants only printf/cat explicitly.
Both independently installed 0.1.596 packages pass this corrected fixture. These
probe mistakes are not product defects or passing tests of the invalid invocation.
