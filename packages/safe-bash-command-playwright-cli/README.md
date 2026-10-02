# Playwright CLI for Safe Bash

Run `playwright-cli` in a virtual shell using an explicitly injected browser adapter.
Sessions, profiles, snapshot refs, checkpoints and host capabilities retain the
same identity across the command and controller APIs. Browser operations use
configured limits and cancellation; the command never launches an implicit host browser.

```ts
import { Shell } from '@poe-platform/safe-bash';
import { createMemoryFileSystem } from '@poe-platform/safe-fs/core';
import { createPlaywrightCli } from '@poe-platform/safe-bash/commands/playwright';

const browser = createPlaywrightCli({ adapter: trustedAdapter });
const shell = new Shell({ fs: createMemoryFileSystem() }).use(browser.plugin);
await shell.exec('playwright-cli --help');
await shell.dispose();
```

`trustedAdapter` is supplied by your host. Available operations depend on its
registered abilities. The command is optional and is never installed by default.
Replacement requires `replace: true`; resource limits and supported Node/Cloudflare
profiles remain those of the public controller API.

This internal workspace is bundled through the established Safe Bash exports.
Consumers do not install it separately.
