set -euC
cd /Users/kjopek/Workspace/safe-bash
scope=tests/integration/agent-bash-coherent-author-20260829/stage-a-loader/v2
case "$1" in plan|seal) entry=prepare; argument="$1";; probe|publish) entry="$1"; argument=none;; *) exit 78;; esac
exec 3>&1
exec > "$scope/capture/$1.stdout" 2> "$scope/capture/$1.stderr"
node=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
"$node" --check "$scope/$entry.mjs"
if [[ "$1" == seal ]]; then "$node" --check "$scope/probe.mjs"; fi
"$node" "$scope/$entry.mjs" "$argument"
print -r -- "$(<$scope/capture/$1.stdout)" >&3
