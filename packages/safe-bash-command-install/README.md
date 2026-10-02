# install

Copy files into a Safe Bash virtual filesystem with permissions, parent directory
creation, timestamp preservation, comparison, and simple or numbered backups.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { installCommands } from "@poe-platform/safe-bash/install";

const fs = createMemoryFileSystem();
await fs.writeFile("/source", new TextEncoder().encode("hello\n"));
const shell = new Shell({ fs }).use(installCommands({
  limits: { maxFileBytes: 1024 * 1024 },
}));
try {
  await shell.exec("install -D -m 640 /source /app/config");
} finally {
  await shell.dispose();
}
```

The public module also exports `createInstallCommand`, `createInstallCommands`,
`InstallCommandsOptions`, and `InstallLimits`. The `/commands/install` public
subpath provides the same factories. Registration collisions require explicit
`replace: true`.

`limits.maxFileBytes` and the legacy `maxFileBytes` option constrain each file;
when both are supplied, the smaller limit applies. Both default to `Infinity`.
Shell output budgets also account for bytes written to destination files.

Ownership lookup, ownership changes, stripping, security contexts, mode policy,
and exclusive rename can use explicit host hooks. Unsupported capabilities fail
explicitly; the command never invokes a native install or strip executable.
Filesystem permissions and cancellation remain enforced. This is a supported
virtual-filesystem profile, not a claim of full GNU install parity.

This implementation is bundled into Safe Bash. No separate command package
installation is required.
