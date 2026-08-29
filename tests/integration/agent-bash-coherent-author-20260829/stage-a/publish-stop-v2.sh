set -euC
cd /Users/kjopek/Workspace/safe-bash
scope=tests/integration/agent-bash-coherent-author-20260829/stage-a
exec 3>&1
exec > "$scope/capture/publish-stop-v2.stdout" 2> "$scope/capture/publish-stop-v2.stderr"
node=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
"$node" --check "$scope/publish-stop.mjs"
"$node" "$scope/publish-stop.mjs"
print -r -- "$(<$scope/capture/publish-stop-v2.stdout)" >&3
