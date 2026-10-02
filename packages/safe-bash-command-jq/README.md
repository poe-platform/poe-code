# safe-bash-command-jq

Portable Safe Bash command for virtual filesystems.

Run jq filters against JSON in the virtual filesystem, including unary-minus
filters such as `jq -c '-.a'` without an extra `--`. `env` and `$ENV` expose the
Safe Bash command environment, never the host process environment.

This private implementation ships inside Safe Bash; no separate installation is
needed. Use the public command export to register jq explicitly:

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { jqCommands } from "@poe-platform/safe-bash/commands/jq";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(jqCommands({
  limits: { maxSteps: 10000, maxOutputBytes: 4096 }
}));
try {
  const result = await shell.exec("jq -c '.items[]'", { stdin: '{"items":[1,2]}' });
  console.log(result.stdout); // 1\n2\n
} finally {
  await shell.dispose();
}
```

Streaming JSON, raw/slurped input, variables, virtual filter/module files and
compact, sorted or raw output use the existing bounded jq profile. This is a jq
subset. The public facade also exports `createJqCommand`, `createJqCommands`,
`JqCommandsOptions` and `JqLimits`; legacy structured-command imports remain valid.
