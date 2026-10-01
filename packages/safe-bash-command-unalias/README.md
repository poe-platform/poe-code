# unalias

Manage shell aliases with `unalias`. Safe Bash enables expansion with `shopt -s expand_aliases`.

`createUnaliasCommand({ aliases, limits })` accepts a shell-owned alias map. Argument and retained alias bytes are bounded.
