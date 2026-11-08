#!/bin/zsh
set -eu
set -o noclobber
umask 077
exec > /private/tmp/final-coherent-smoke-r4-20260829.outer.stdout 2> /private/tmp/final-coherent-smoke-r4-20260829.outer.stderr
exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/integration/final-smoke-preparation-20260829/runnable-r4/bootstrap.mjs "$@"
