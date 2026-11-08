#!/bin/zsh -f
umask 077
set -e
set -o noclobber
exec > '/private/tmp/safe-bash-b35-v4-PLN3cC/future/capture/collector-startup.stdout' 2> '/private/tmp/safe-bash-b35-v4-PLN3cC/future/capture/collector-startup.stderr'
exec /usr/bin/env -i HOME='/private/tmp/safe-bash-b35-v4-PLN3cC/future/home' TMPDIR='/private/tmp/safe-bash-b35-v4-PLN3cC/future/tmp' PATH='/private/tmp/safe-bash-b35-v4-PLN3cC/future/empty-path' LC_ALL=C LANG=C TZ=UTC B35_PRESEAL_BYTES="$1" B35_PRESEAL_SHA256="$2" B35_GRANT_SHA256="$3" B35_REVIEW_SHA256="$4" '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node' '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/preexec-v4/collector.mjs'
