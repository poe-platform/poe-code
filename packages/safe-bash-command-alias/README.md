# alias

Manage shell aliases with `alias`. Safe Bash enables expansion with `shopt -s expand_aliases`.

`createAliasCommand({ aliases, limits })` accepts a shell-owned alias map. Argument and retained alias bytes are bounded.
