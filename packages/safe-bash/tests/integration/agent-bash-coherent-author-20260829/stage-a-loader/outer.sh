set -euC
cd /Users/kjopek/Workspace/safe-bash
scope=tests/integration/agent-bash-coherent-author-20260829/stage-a-loader
case "$1" in prepare|probe|publish) phase="$1";; *) exit 78;; esac
exec 3>&1
exec > "$scope/capture/$phase.stdout" 2> "$scope/capture/$phase.stderr"
node=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
"$node" --check "$scope/$phase.mjs"
"$node" "$scope/$phase.mjs"
print -r -- "$(<$scope/capture/$phase.stdout)" >&3
