# Safe Bash contracts

Canonical byte values, commands, streams and plugin contracts shared by Safe Bash and private command workspaces. Consumers use the public Safe Bash contract exports; this private implementation is bundled into that artifact.

Command handlers can read optional `context.argv0` for the zeroth argument identity. `context.command` still selects the command to execute. Pass `argv0` in `context.invoke` options to override this identity, including an empty string; `env -a` / `--argv0` uses this contract. For `sh -c`, it supplies `$0` unless an explicit command-name operand follows the script.
