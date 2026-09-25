# @poe-code/safe-playwright

Private workspace for the injected Playwright controller. The root package exposes
it through `poe-code/safe-playwright` and `poe-code/safe-playwright/adapter`.
See [CONTRACT.md](CONTRACT.md) for commands, lifecycle guarantees and qualification.

## Configuration

`createPlaywrightController({ adapter, limits })` requires a host-owned `adapter`.
`createPlaywrightAdapter(sources)` accepts a map of `chromium`, `firefox` and
`webkit` sources. Each source supplies `acquireBrowser(options)` and optional
`headed` support; acquired resources supply a browser and `release()`.

Browser resources and action duration are unlimited by default. Each optional controller limit must be a positive safe integer and is retained on creation:

| Option                    |  Default |
| ------------------------- | -------: |
| `limits.maxSessions`      | Unlimited |
| `limits.actionTimeoutMs`  | Unlimited |
| `limits.maxTabs`          | Unlimited |
| `limits.maxSnapshotRefs`  | Unlimited |
| `limits.maxArtifactBytes` | Unlimited |

Snapshots have no byte limit. Legacy `limits.maxSnapshotBytes` values are ignored.

`billing` is unsupported and rejected. Invocations provide `args`, `env`, `signal`,
`write(text)` and optional `writeArtifact(bytes, filename)` and `registerCleanup`.
Hosts must dispose the controller and retain responsibility for browser ownership.

## Environment variables

`PLAYWRIGHT_CLI_SESSION` selects the session from the invocation's exported
environment when `--session` or `-s` is absent. The default session is `default`.
The controller does not read the host environment.

## Development

Run `npm run test:unit --workspace=@poe-code/safe-playwright` and
`npm run typecheck --workspace=@poe-code/safe-playwright`.
