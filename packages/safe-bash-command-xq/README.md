# xq

Use this command with virtual files and configurable resource limits.

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { xqCommands } from "@poe-platform/safe-bash/commands/xq";

const fs = createMemoryFileSystem();
await fs.writeFile("/sample.xml", new TextEncoder().encode("<root>ok</root>"));
const shell = new Shell({ fs }).use(xqCommands());
const result = await shell.exec("xq '.root' /sample.xml");
await shell.dispose();
```

Also available: `createXqCommand`, `createXqCommands`, and typed options and limits.
