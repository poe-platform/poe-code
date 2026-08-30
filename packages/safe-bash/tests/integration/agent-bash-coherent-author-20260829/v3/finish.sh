set -euC
cd /Users/kjopek/Workspace/safe-bash
scope=tests/integration/agent-bash-coherent-author-20260829/v3
node=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
case "$1" in inspect|seal) phase="$1";; *) exit 78;; esac
exec > "$scope/capture/$phase.stdout" 2> "$scope/capture/$phase.stderr"
"$node" --check "$scope/finish.mjs"
"$node" "$scope/finish.mjs" "--$phase"
