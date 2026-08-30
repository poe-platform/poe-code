#!/bin/zsh -f
umask 077
set -e
set -o noclobber
exec > '/private/tmp/safe-bash-b35-v3-lfyWzQ/capture/control-startup.stdout' 2> '/private/tmp/safe-bash-b35-v3-lfyWzQ/capture/control-startup.stderr'
exec /usr/bin/env -i HOME='/private/tmp/safe-bash-b35-v3-lfyWzQ/home' TMPDIR='/private/tmp/safe-bash-b35-v3-lfyWzQ/tmp' PATH='/private/tmp/safe-bash-b35-v3-lfyWzQ/empty-path' LC_ALL=C LANG=C TZ=UTC '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node' '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/preexec-v3/controls.mjs' '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/preexec-v3' '{"bytes":12830,"sha256":"8fea1b62502ad77f730e68e89a529b339f22b5cb92e121ec6da88b2a09c2172c"}'
