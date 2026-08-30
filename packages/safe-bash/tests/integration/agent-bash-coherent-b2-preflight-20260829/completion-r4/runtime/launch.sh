#!/bin/zsh
umask 077
set -C
exec > /private/tmp/safe-bash-b2-runtime-r4-01a04d95.outer.raw 2>&1 || exit $?
cd /private/tmp || exit $?
NODE_OPTIONS= NODE_PATH= TMPDIR=/private/tmp TMP=/private/tmp TEMP=/private/tmp HOME=/private/tmp exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /private/tmp/safe-bash-b2-completion-r4-01a04d95/staged/new/outer.mjs "$1" "$2"
