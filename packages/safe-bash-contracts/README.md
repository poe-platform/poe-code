# Safe Bash contracts

Canonical byte values, commands, streams and plugin contracts shared by Safe Bash and private command workspaces. Consumers use the public Safe Bash contract exports; this private implementation is bundled into that artifact.

Use these contracts to implement commands that preserve binary arguments and
participate in the shell's streams, allocation limits and invocation cleanup.

- Command definitions, registry and canonical argument carriers.
- Owned byte values with explicit UTF8 presentation and accounted copies.
- Byte streams, output operations, middleware and plugin contracts.
- Filesystem capabilities and errors shared with Safe FS.

```ts
import { createCommandArguments } from "@poe-platform/safe-bash/contracts/command";
import { shellValueFromBytes } from "@poe-platform/safe-bash/contracts/value";

const carrier = createCommandArguments([
  shellValueFromBytes(Uint8Array.of(0xff)),
  shellValueFromBytes(Uint8Array.of(0xfe)),
]);

// Both presentation strings are "�"; the authoritative bytes remain distinct.
console.log(carrier.bytes(0), carrier.bytes(1));
```

Within a handler, use `getCommandArguments(context)` to access the shell-created
carrier. Preserve `carrier.args === context.args`; an equal copy of the argument
strings is not admitted. Shell-created carriers account `bytes()` copies through
the allocation contract captured at creation. Supply an admitted allocation
contract when creating values or carriers yourself, and do not retain
invocation-bound carriers after cleanup. Contracts do not grant ambient
filesystem, network or process access.

The runtime uses TextEncoder, TextDecoder and typed arrays. Browser/workerd
support must be qualified with the complete public artifact and its Safe FS
prerequisites; the private package is not an independently installable product.
