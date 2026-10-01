# Media commands

Register explicit media bindings with `mediaCommands({ engine })` from
`@poe-platform/safe-bash/commands/media`. The plugin preserves byte arguments,
virtual filesystem context, streams, cancellation, and collision checks.

`createMediaCommands(options)` returns command definitions; `createMediaCommand(options,
name)` selects one (default `ffmpeg`). `mediaCommands()` can register without a
host binding, but execution then fails with a configuration diagnostic. It never
starts a native process or connects implicitly. Existing remote service options
and provider resource limits remain available through `createRemoteMediaCommands`.

`runBash({ media })` from `@poe-platform/safe-bash/execution` replaces the default
portable commands with your explicitly supplied media bindings. Pass
`media.replace: false` to reject collisions. Without media configuration,
`runBash` keeps the portable commands and never connects to a remote media service.

The reusable media parser and native bridge remain in the media engine package.
