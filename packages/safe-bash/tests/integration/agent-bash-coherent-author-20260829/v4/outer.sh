set -euC
cd /Users/kjopek/Workspace/safe-bash
scope=tests/integration/agent-bash-coherent-author-20260829/v4
node=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
case "$1" in adjudicate|seal) phase="$1";; *) exit 78;; esac
exec 3>&1
exec > "$scope/capture/$phase.stdout" 2> "$scope/capture/$phase.stderr"
trap 'status=$?; print -r -- "OUTER_STATUS phase=$phase status=$status" >&3' EXIT
"$node" --check "$scope/prepare.mjs"
"$node" "$scope/prepare.mjs" "--$phase"
print -r -- "$(<$scope/capture/$phase.stdout)" >&3
