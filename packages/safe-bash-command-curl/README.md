# curl

Run `curl` against an injected virtual filesystem with portable byte streams.

```ts
import { createCurlCommand, curlCommands } from "@poe-platform/safe-bash/commands/curl";

const command = createCurlCommand();
const plugin = curlCommands();
```

Use the command with a `CommandContext`, or install the plugin in a Safe Bash shell. `createCurlCommands()` returns the command definitions without registering them. Limits are optional; omitted quotas are unbounded. Set finite limits for untrusted input.

Requests are denied by default. Supply an `authorize` callback and, when needed, an explicit HTTP `transport`. Authorization applies to every redirect. The default transport uses Fetch. With Fetch, `--connect-timeout` bounds the wait for response headers, including connection setup, upload, and server response delay. It stops before body streaming. Transports with exact connection timing keep native curl's DNS/TCP/TLS-only deadline.

```ts
const authorized = createCurlCommand({
  authorize: ({ url }) => new URL(url).origin === "https://example.com",
  limits: { maxDownloadBytes: 1024 * 1024 },
});
```

Use `--create-dirs` to create output parent directories, including with `--output-dir`.
`-b/--cookie` accepts cookie data or a VFS Netscape cookie file; file cookies honor domain, path, expiry, and HTTPS restrictions.
`--retry-connrefused` includes refused connections, while `--retry-all-errors` retries transfer failures. Both require `--retry`; `--retry-max-time` bounds when another attempt can start. Retrying can repeat output or request side effects.
`-k/--insecure` disables certificate verification only on transports advertising `supportsInsecureTls`, including `createNodeHttpTransport`. Fetch cannot disable TLS verification and reports an error for this option.
