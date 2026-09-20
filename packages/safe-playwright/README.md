# @poe-code/safe-playwright

Private workspace for the injected Playwright controller. The root package exposes
it through `poe-code/safe-playwright` and `poe-code/safe-playwright/adapter`.
See [CONTRACT.md](CONTRACT.md) for commands, lifecycle guarantees and qualification.

## Configuration

`createPlaywrightController({ adapter, limits })` requires a host-owned `adapter`.
`createPlaywrightAdapter(sources)` accepts a map of `chromium`, `firefox` and
`webkit` sources. Each source supplies `acquireBrowser(options)` and optional
`headed` support; acquired resources supply a browser and `release()`.

Optional controller limits are positive safe integers, retained on creation:

| Option                    |  Default |
| ------------------------- | -------: |
| `limits.maxSessions`      |        4 |
| `limits.actionTimeoutMs`  |    30000 |
| `limits.maxTabs`          |       16 |
| `limits.maxSnapshotBytes` |   262144 |
| `limits.maxSnapshotRefs`  |     1000 |
| `limits.maxArtifactBytes` | 16777216 |

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
