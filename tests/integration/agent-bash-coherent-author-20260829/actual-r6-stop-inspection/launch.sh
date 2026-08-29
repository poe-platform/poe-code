set -euC
exec 3>&1
exec > /private/tmp/b1-actual-r6-stop-inspection.stdout 2> /private/tmp/b1-actual-r6-stop-inspection.stderr
exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/actual-r6-stop-inspection/inspect.mjs
