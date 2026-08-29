set -euC
cd /Users/kjopek/Workspace/safe-bash
scope=tests/integration/agent-bash-coherent-author-20260829/v2
node=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
case "$1" in inspect|compose|details|seal) phase="$1";; *) exit 78;; esac
exec > "$scope/capture/$phase.stdout" 2> "$scope/capture/$phase.stderr"
"$node" --check "$scope/prepare.mjs"
"$node" "$scope/prepare.mjs" "--$phase"
