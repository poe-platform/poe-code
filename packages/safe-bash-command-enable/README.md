# enable

Manage shell builtins with `enable -n NAME` to disable, `enable NAME` to restore,
and `enable -a` to list enabled and disabled builtins. `enable` lists enabled
builtins; `enable -n` lists disabled ones. `-p` prints without changing state.

Safe-bash supplies the builtin inventory and shell-local disabled set. Disabled
builtins use normal executable lookup; subshells inherit their own copy of the
disabled set. Loading native shared-library builtins is unsupported.

The private package exports `createEnableCommand`, `createEnableCommands`, and
`enableCommands`, with optional argument, output, and builtin-count limits.
