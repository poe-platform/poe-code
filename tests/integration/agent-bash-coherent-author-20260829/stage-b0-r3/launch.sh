set -euC
cd /Users/kjopek/Workspace/safe-bash
exec > /private/tmp/coherent-b0-39-20260829-r3.launch.stdout 2> /private/tmp/coherent-b0-39-20260829-r3.launch.stderr
: "${B0_ROOT_GO:?fresh explicit ROOT authorization required}"
exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/integration/agent-bash-coherent-author-20260829/stage-b0-r3/bootstrap.mjs --run "$1" "$2" "$3"
