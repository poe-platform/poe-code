set -euC
exec > /private/tmp/coherent-b1-r6-window-v2-owner.stdout 2> /private/tmp/coherent-b1-r6-window-v2-owner.stderr
exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/final-admin-r5/entry.mjs "$@"
