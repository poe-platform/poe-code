set -euC
exec 3>&1
exec > /private/tmp/b1-admin-owner-r1-outer.stdout 2> /private/tmp/b1-admin-owner-r1-outer.stderr
exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/admin-owner-r1/prepare.mjs
