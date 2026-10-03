# factor

Run `factor` against your Safe Bash virtual filesystem, with streaming I/O and configurable resource limits. Enable only the commands your application needs.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { factorCommands } from "@poe-platform/safe-bash/commands/factor";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(factorCommands());
const result = await shell.exec("factor --help");
```

The module also exports `createFactorCommand`, its command-list factory, and typed options and limits.

Factor unsigned 64-bit integers, including large primes and semiprimes, exactly. Use `factor -h 18446744073709551615` to print repeated factors as powers. Larger integers remain accepted, but may require slow trial division. Hosts can set `limits.maxWork`, `limits.maxBufferedBytes`, and a BigInt `limits.maxValue` to bound computation and memory; cancellation interrupts ongoing factorization.
