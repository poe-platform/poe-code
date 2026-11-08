set -eu
cd /Users/kjopek/Workspace/safe-bash
scope=tests/integration/agent-bash-coherent-author-20260829
node=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
exec > "$scope/prep-capture/inspection-v2.stdout" 2> "$scope/prep-capture/inspection-v2.stderr"
"$node" --check "$scope/inspect.mjs"
"$node" "$scope/inspect.mjs"
