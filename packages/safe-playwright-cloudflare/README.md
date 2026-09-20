# Cloudflare Playwright for safe-bash

Run the standard `playwright-cli` commands against Cloudflare Browser Run, with
native JavaScript, browser networking, uploads, snapshots, generated action code,
bounded screenshots/PDFs/traces, and isolated Worker Loader `run-code` execution.
The implementation ships through `@poe-platform/safe-bash/playwright/cloudflare`.
Cloudflare dependencies stay outside the portable shell and CLI entrypoints.

```ts
import { createPlaywrightCli } from "@poe-platform/safe-bash/playwright";
import { createCloudflarePlaywrightAdapter } from "@poe-platform/safe-bash/playwright/cloudflare";

const adapter = createCloudflarePlaywrightAdapter(
  env.BROWSER,
  undefined,
  { ownerId: authenticatedOwnerKey, loader: env.BROWSER_RUN_CODE_LOADER },
  { maxStorageBytes: 2 * 1024 * 1024 }
);
const cli = createPlaywrightCli({ adapter, limits: { maxSessions: 2, maxTabs: 8 } });
```

Provide a Browser Run binding and install exactly `@cloudflare/playwright@1.3.6`
in the Worker host. Enable `nodejs_compat` and a Worker Loader binding. The public
types target Worker projects using TypeScript's `Bundler` module resolution and
Cloudflare Workers types. `run-code` reports an unavailable binding if no loader
is supplied; other browser commands remain available.
Pass one function accepting `page`, for example
`playwright-cli run-code 'async (page) => { return await page.title(); }'`.
Compilation syntax errors retain their original detail and include this example;
corrected code can run in the same session.

The host constructs the trusted `ownerId` and scopes each CLI instance to one
authenticated user/agent. Session aliases, `-s`, and `PLAYWRIGHT_CLI_SESSION`
select sessions inside that owner's instance. The library never constructs an
authenticated owner key, routes Durable Objects, admits owners, stores profiles,
or schedules automatic persistence.

An optional second argument supplies `loadState(session, signal)`. Explicit
`contextOptions.storageState`, including an empty state, overrides that callback.
The fourth argument bounds storage restoration bytes; its default is 2 MiB.
Portable profile APIs always require explicit host byte and tab limits.

```ts
import {
  parseBrowserProfile,
  checkpointBrowserProfile,
  restoreBrowserProfile
} from "@poe-platform/safe-bash/playwright";

const limits = { maxBytes: 2 * 1024 * 1024, maxTabs: 8 };
const persistence = {
  async restore({ name, signal }) {
    const bytes = await hostProfiles.load(name, signal);
    if (!bytes) return;
    const profile = parseBrowserProfile(bytes, limits);
    // The host checks expiry and whether this profile is resumable.
    return restoreBrowserProfile({ adapter, profile, limits, name, signal });
  },
  async checkpoint(session, signal) {
    const bytes = await checkpointBrowserProfile(session, limits, signal);
    await hostProfiles.save(session.name, bytes, signal);
  },
  async delete(name, signal) {
    await hostProfiles.remove(name, signal);
  }
};
const persistentCli = createPlaywrightCli({ adapter, persistence });
```

`encodeBrowserProfile` and `parseBrowserProfile` serialize and validate portable
storage state, ordered tab URLs, selection, context options, session configuration,
and optional expiry metadata. Cloudflare checkpoints also retain provider-qualified
dynamic context/page emulation, timeouts, and init scripts through the same
state-transfer implementation used for `run-code` reconnect. An incompatible
adapter rejects unsupported settings. Restoration allocates blank tabs in order,
preserves selection, and returns an initializer to the standard controller, which
installs configuration before provider settings. Saved URLs are replayed only with
explicit `tabRestoration: 'navigate'`; replay can repeat action endpoints.
Failed allocation releases the acquired lease. After adoption, the
controller owns failed-initialization retirement. Checkpoints settle isolated
storage-reader cleanup before returning bytes, including closed-origin IndexedDB.
Live-context `state-load` retains tab identity, DOM, and sessionStorage.

After an interrupted owner, use `persistentCli.inspectRecovery({ name })` to
inspect retained-page, saved-storage, and unavailable outcomes without restoring
or navigating. Supply metadata-only `persistence.inspectRecovery` and durable
`recordOperation` callbacks to retain operation correlation across owner resets.
An operation left `running` has an unknown outcome; do not replay its effects.
Call `restoreBrowserProfile({ adapter, profile, limits, name, signal, recovery: true })`
and adopt the result with `restoreSession({ name, acquire: async () => restored })`
to import storage into one inert page. Inspection continues to report lost live
page state. Saved URLs, initPage modules, and provider runtime scripts are not
replayed; the original DOM and in-flight JavaScript cannot be reconstructed.

Browser acquisitions retain one owned provider session and its physical sockets.
Release is idempotent and shares deletion with Worker retirement. Ordinary guest
script errors retain the session; cancellation, deadlines, and resource failures
retire it. Browser traffic, redirects, fetch/request APIs, WebSockets, and workers
remain enabled. Remote downloads report unsupported artifact retrieval through
the existing command result; CLI help is unchanged.

Native-provider bridges for context state, retained page CDP identities, utility
world snapshots, and trace files are isolated in this workspace and qualified
against `@cloudflare/playwright@1.3.6`. The build refuses a different version for
native code generation. It ships the minified guest and action-generator assets
with license notices, so hosts do not rebundle provider internals. Updating the
provider requires rerunning native and Worker conformance and installed-archive
verification. Chromium conformance uses Miniflare 4.20260708.1 with compatibility
date 2026-07-08; transport fault tests use the consumer's 2025-01-01 compatibility
profile with explicitly enabled Node modules.

For local native fixtures, use esbuild and run each browser scenario in a fresh
host subprocess when recreating Miniflare runtimes is unstable. Bun's own bundler
has a separate first-build incompatibility with unused peer Electron assets in
the qualified versions. See the [runtime qualification](docs/runtime-qualification.md)
for the tested versions, restart results and diagnostic boundaries.

Structured snapshots support at most 128 frames, including the main frame.
Larger trees reject with `Browser snapshot frame limit exceeded` before native
snapshot work starts.

The reusable implementation and conformance cases were ported from Poe's
agent-tool-service at `a03e2c70269656d767e775848e69e30254f27217`. Consumer persistence
and owner-manifest implementations appear only as test fixtures; they are excluded
from published artifacts. The adapter and portable profiles own the reusable
lifecycle used by those fixtures.
