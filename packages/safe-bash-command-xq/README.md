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

`xq` converts XML elements, attributes (`@name`), repeated children, and text
(`#text`) to JSON, then applies a jq filter. It supports stdin, virtual files,
`-r`, `-c`, `--arg`, and filter files (`-f`). DTDs and XML output are unsupported;
filters and filenames must be valid, lossless UTF-8. XML input is decoded and
parsed incrementally, so parser limits can stop further reads immediately. XML nodes and repeated-child groups use a shared 1 MiB page cache backed by the
supplied filesystem; JSON conversion feeds jq in bounded chunks. Large inputs need
an external backing provider, since a memory filesystem retains its contents in
RAM. jq query values, individual XML tokens, and parser ancestry still remain in
memory, so this is not yet a bounded-memory guarantee for arbitrary queries.

Pass `limits` to bound input/output bytes, filter bytes, XML depth/nodes/attributes,
query steps, and results. Limits are opt-in; omitted limits retain the existing
unbounded defaults. Set `replace: true` to replace an existing registration.
The command uses the supplied filesystem and cancellation signal in Node,
browser, and workerd profiles. It is bundled with Safe Bash; no separate command
package installation is needed.
