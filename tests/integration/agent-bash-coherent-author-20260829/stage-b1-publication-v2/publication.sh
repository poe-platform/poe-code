#!/bin/zsh
set -euC
exec > /private/tmp/coherent-b1-publication-v2-20260829.startup.stdout 2> /private/tmp/coherent-b1-publication-v2-20260829.startup.stderr
exec /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/integration/agent-bash-coherent-author-20260829/stage-b1-publication-v2/publish.mjs "$@"
