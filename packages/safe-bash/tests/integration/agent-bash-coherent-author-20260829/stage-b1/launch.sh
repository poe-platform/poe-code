set -euC
cd /Users/kjopek/Workspace/safe-bash
exec > /private/tmp/coherent-b1-public15-20260829-r1.launch.stdout 2> /private/tmp/coherent-b1-public15-20260829-r1.launch.stderr
: "${B1_ROOT_GO:?fresh explicit ROOT authorization required}"
exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/integration/agent-bash-coherent-author-20260829/stage-b1/bootstrap.mjs --run "$1" "$2" "$3"
