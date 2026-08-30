set -euC
exec 3>&1
exec > /private/tmp/b1-r6-window-v2-preparation.stdout 2> /private/tmp/b1-r6-window-v2-preparation.stderr
exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/b1-r6-window-v2/bind.mjs
