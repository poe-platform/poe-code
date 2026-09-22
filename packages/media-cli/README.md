# media-cli

JavaScript frontends for FFmpeg, ffprobe and ImageMagick, with explicit bindings
to remote native execution. This workspace is private and is not a separately
published npm package. The public poe-code facades support the shell adapter
and portable engine; server APIs are available only under Node conditions.

```ts
import { Shell, MemoryFileSystem } from 'poe-code/safe-bash';
import { createRemoteMediaCommands } from 'poe-code/safe-bash/commands/media';

const shell = new Shell({ fs: new MemoryFileSystem(), env: {} });
shell.use(createRemoteMediaCommands(remoteSettings));
try {
  const result = await shell.exec('ffprobe -version');
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

`remoteSettings` must identify an authenticated HTTPS service, pinned native build
and admitted namespace. The host owns native isolation and filesystem mediation;
connecting an HTTP transport alone does not make shell files available remotely.
No virtual command starts a local native process as a fallback.

## Exports

Root package routes are `poe-code/media`, `poe-code/media/server` and
`poe-code/safe-bash/commands/media`. Workspace development uses these equivalents:

- `@poe-code/media-cli`: portable parsers, shims, dependency resolver,
  streaming engine and canonical filesystem composition.
- `@poe-platform/safe-bash/commands/media`: explicit shell plugin and remote commands.
- `@poe-platform/safe-bash/commands/media/settings`: configuration capture without transport startup.
- `@poe-code/media-cli/server`: Node-only media deployment and explicit service
  bootstrap. Importing it does not start a listener or native process.

Discovery is advisory. Original argv and native executables remain authoritative
for diagnostics, media processing, late dependencies and partial effects.
`DependencyResolver` accepts already observed content; it does not read stdin,
open input files or fetch network resources.

## Configuration

`createRemoteMediaCommands` takes these settings:

| Option | Default / requirement | Purpose |
| --- | --- | --- |
| `service` | Required | Authenticated HTTPS origin |
| `authToken` | Required | Explicit credential; never placed in native argv |
| `buildDigest` | Required | Pinned native build identity |
| `resource` | Required | Namespace binding: `namespaceId`, `logicalRoot`, `rights`, `grantId`, `profile` |
| `replace` | `false` | Deliberately replace colliding registered commands |
| `limits` | Service ceilings | Narrow native job, handle, argv, transfer, replay and callback bounds |
| `provider` | Omitted | Explicit `module` with optional `options`; exports `createMediaProvider(settings)` |
| `fetch` | `globalThis.fetch` | Inject authenticated transport |
| `descriptors` | `[]` | Explicit admitted native descriptor mappings |
| `grants` | `[]` | Host-issued resource rights and bounds |
| `stdin` | Stream | Explicit native stdin binding |
| `onControl` | Omitted | Host handler `(control, context, remote)` for resource callbacks and additional channels; `remote.respond(result)` answers the delivered callback with invocation-owned transport |
| `onOutputChannel` | Omitted | Bind a remotely opened writable channel to a borrowed host sink |
| `onProgress` | Omitted | Awaited upload/download byte events outside native output |
| `signalStatus` | Omitted | Host shell projection of confirmed signal-only termination |

The provider returns `fetch`, optional `execute(request)` and optional `dispose()`.
An injected executor receives the invocation's scoped filesystem, byte arguments,
exported environment, streams, descriptors, signal and cleanup registrar.

`mediaCommands` accepts either `engine.execute(request)` or explicit `ffmpeg` and/or
`imageMagick` bindings, plus optional `replace`. Bindings declare the pinned `build`,
`grammarRevision`, `argv: 'bytes'`, `lateAccess: 'complete'`, `effects: 'live'` and
`run(invocation)`. ImageMagick additionally accepts `discoveryContext(context)`.
Those declarations require a qualified host implementation; they do not prove it.

`createMediaEngine` requires `bind(request)`, which returns invocation binding
metadata and an executor. `createCanonicalMediaFilesystem` accepts the generic
remote-execution `JobBindingOptions` and requires `retainOutput(object)`.
The host must supply canonical retained objects, authenticated access and complete
native mediation; copied workspaces do not provide live canonical effects.

Resolver options are `cwd`, explicit `budgets` (`nodes`, `bytes`, `depth`, `symlinks`),
optional `link`, `accessible`, `exists`, `directory` and `policy`. Metadata callbacks supply
advisory observations. Protocol policy is explicit and cannot authorize native I/O.
Public TypeScript declarations and the versioned remote-execution schemas describe
the nested resource, descriptor, grant, process and filesystem fields.

The SDK `runBash` and CLI `poe-code bash` share configuration and execution.
SDK `dryRun: true` and CLI `--dry-run` skip execution, file mutations, stdin reads
and remote connections. Supply media settings through `--media-config <json>` or
the explicit `--media-*` options; place native argv after `--`.

## Server

`createMediaDeployment` takes `build`, `executables`, `maxExecutableBytes`,
`inventory`, `maxAssetBytes` and `server`. The server options are documented in
[remote-execution](../remote-execution/README.md). The build receipt pins executable,
library, inventory, resource and policy/config identities before service startup.
Optional injected asset storage provides `open`, `type` and `readlink`.

The executable `server/start.mjs` accepts one absolute operator-module path whose
`configuration` export contains `deployment` and `service`. TLS, authentication,
storage, admission ledger and isolation driver are operator inputs. Build emitted
workspaces before building the Dockerfile's explicit `service` target. The default
Dockerfile target runs disposable native integration tests.

## Environment

Product libraries read no ambient environment variables for credentials,
configuration or provider discovery. Native child environment is explicit
invocation data. `REMOTE_MEDIA_IMAGE_DIGEST` belongs only to the opt-in container
qualification runner and records the tested image identity.

Explicit qualification routes also use these variables:

| Variable | Purpose |
| --- | --- |
| `DOCKER_CONTEXT` | Standard Docker CLI context inherited by `test:container`; otherwise Docker uses its configured context |
| `MEDIA_NETWORK_ORACLE=1` | Enable the native network oracle in `test:native` |
| `MEDIA_ORDERING_DOCKER_CONTEXT` | Required context for the separate selected-ordering native configuration |
| `MEDIA_ORDERING_IMAGE` | Selected base image for ordering comparisons |
| `MEDIA_ORDERING_DELEGATE_IMAGE` | Selected delegate image for ordering comparisons |
| `MEDIA_ORDERING_DIFFERENTIAL_OUTPUT` | Required path for retaining the selected-ordering comparison report |

The selected-ordering route uses `vitest.selected-native.config.ts` and requires
the recorded admission/image evidence. Missing runtime inputs do not count as
passing cases. These variables do not configure the public media commands.

## Validation and limits

Use `npm run test:unit --workspace=@poe-code/media-cli` and the workspace `lint`
command for fast checks. `test:public-consumer`, `test:worker-imports`, `test:native`
and `test:container` qualify their respective consumers or explicit native runs.
Unit tests do not establish deployed provider compatibility. Complete native
filesystem/process behavior, production images and each cloud provider require
their own qualification. Partial effects survive failure; uncertain outcomes
require inspection rather than automatic command replay.
