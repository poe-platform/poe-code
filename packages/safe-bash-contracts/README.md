# Safe Bash contracts

Canonical byte values, commands, streams and plugin contracts shared by Safe Bash and private command workspaces. Consumers use the public Safe Bash contract exports; this private implementation is bundled into that artifact.

A command definition may set `fallback: true` to supply a suite default. Dedicated definitions take precedence in either registration order; duplicates of the same kind still require `replace: true`.

Command handlers can read optional `context.argv0` for the zeroth argument identity. `context.command` still selects the command to execute. Pass `argv0` in `context.invoke` options to override this identity, including an empty string; `env -a` / `--argv0` uses this contract. For `sh -c`, it supplies `$0` unless an explicit command-name operand follows the script.

`createBytePipe({ maxObservationWaiters })` bounds pending endpoint observations across both ends of a pipe. It defaults to `Infinity`; use a non-negative safe integer for a finite ceiling. Zero permits immediate probes but disables pending observation waits. Settled or cancelled observations release capacity.
