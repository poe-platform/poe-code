#!/bin/zsh
umask 077
set -C
exec > /private/tmp/safe-bash-b2-runtime-r7.outer.raw 2>&1 || exit $?
cd /private/tmp || exit $?
NODE_OPTIONS= NODE_PATH= TMPDIR=/private/tmp TMP=/private/tmp TEMP=/private/tmp HOME=/private/tmp exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r7/staged/new/outer.mjs "$1" "$2"
