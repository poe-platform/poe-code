# yq command module

`createYqCommand()`, `createYqCommands()`, and `yqCommands({ replace?, limits? })`
use the Mike Farah profile, including in-place editing (`-i`), null input (`-n`),
exit-status checking (`-e`), eval-all (`ea`), pretty printing (`-P`), and indentation (`-I`).
The factories share the implementation exported by `@poe-platform/safe-bash/yq`.
They operate on the virtual filesystem and use Web APIs without Node compatibility.
Install the optional `yaml@2.9.0` peer to evaluate YAML.

Limits default to `Infinity`; configure finite byte, node, alias, depth, output,
or work budgets through `limits` when needed. The legacy restricted query profile
remains available internally at `safe-bash-command-yq/query`.
