# safe-bash-command-sponge

Collect a pipeline before writing its output with `sponge` inside
`@poe-platform/safe-bash`. `maxBufferedBytes` defaults to `Infinity`; set a finite
value to limit retained input. Explicit `Infinity` disables the quota.
