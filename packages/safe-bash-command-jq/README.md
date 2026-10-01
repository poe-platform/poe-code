# safe-bash-command-jq

Portable Safe Bash command for virtual filesystems.

Run jq filters against JSON in the virtual filesystem, including unary-minus
filters such as `jq -c '-.a'` without an extra `--`. `env` and `$ENV` expose the
Safe Bash command environment, never the host process environment.
