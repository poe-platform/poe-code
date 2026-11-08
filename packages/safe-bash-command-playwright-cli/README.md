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
When a host authorizes saved-URL restoration with `tabRestoration: "navigate"`,
URLs load on demand: attaching and listing tabs do not navigate, while selecting
or using a tab loads its saved URL. Unvisited URLs and the selected tab survive
profile checkpoints. An explicit `goto` replaces that tab's saved destination.
Failed or cancelled navigation still follows the host's interrupted-operation
recovery policy; it does not replay other tabs in the background.

Replacement requires `replace: true`; resource limits and supported Node/Cloudflare
profiles remain those of the public controller API.

Controller `dispose()` permanently retires its sessions and shares concurrent
cleanup calls. If it rejects, call it again to retry failed provider lease releases.
Successful releases and checkpoints are not replayed; retries require retaining
the controller instance and do not survive a host restart.

This internal workspace is bundled through the established Safe Bash exports.
Consumers do not install it separately.
