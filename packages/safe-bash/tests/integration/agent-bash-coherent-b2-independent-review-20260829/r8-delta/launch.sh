set -euC
exec 3>&1
exec > /private/tmp/b2-r8-independent-delta-review.stdout 2> /private/tmp/b2-r8-independent-delta-review.stderr
exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-independent-review-20260829/r8-delta/review.mjs
