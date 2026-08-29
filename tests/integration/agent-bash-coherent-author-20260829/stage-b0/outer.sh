set -euC
cd /Users/kjopek/Workspace/safe-bash
scope=tests/integration/agent-bash-coherent-author-20260829/stage-b0
case "$1" in inspect|prepare|controls|seal) entry="$1";; *) exit 78;; esac
exec 3>&1
exec > "$scope/capture/$entry.stdout" 2> "$scope/capture/$entry.stderr"
node=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
"$node" --check "$scope/$entry.mjs"
"$node" "$scope/$entry.mjs"
print -r -- "$(<$scope/capture/$entry.stdout)" >&3
