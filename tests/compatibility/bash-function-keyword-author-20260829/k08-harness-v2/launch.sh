#!/bin/zsh -f
umask 077
set -e
set -o noclobber
exec > '/private/tmp/safe-bash-k08-author-RAvH2m/future-capture/collector-startup.stdout' 2> '/private/tmp/safe-bash-k08-author-RAvH2m/future-capture/collector-startup.stderr'
exec /usr/bin/env -i HOME='/private/tmp/safe-bash-k08-author-RAvH2m/home' TMPDIR='/private/tmp/safe-bash-k08-author-RAvH2m/tmp' PATH='/private/tmp/safe-bash-k08-author-RAvH2m/empty-path' LC_ALL=C LANG=C TZ=UTC K08_SEAL_BYTES="$1" K08_SEAL_SHA256="$2" K08_GRANT_SHA256="$3" K08_REVIEW_SHA256="$4" '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node' '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/k08-harness-v2/collector.mjs'
