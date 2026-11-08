#!/bin/zsh
set -euC
exec > /private/tmp/coherent-b1-public15-20260829-r2.publication.stdout 2> /private/tmp/coherent-b1-public15-20260829-r2.publication.stderr
exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/integration/agent-bash-coherent-author-20260829/stage-b1-final-binding/actual-publication.mjs --publish "$@"
