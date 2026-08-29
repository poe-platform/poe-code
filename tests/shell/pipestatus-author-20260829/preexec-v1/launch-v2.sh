#!/bin/zsh
set -eu
set -C
exec >/private/tmp/safe-bash-pipestatus-actual-78-v1.startup.stdout 2>/private/tmp/safe-bash-pipestatus-actual-78-v1.startup.stderr
NODE=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
BOOTSTRAP=/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/preexec-v1/BOOTSTRAP-v2.sha256
: ${PIPE_BOOTSTRAP_SHA:?exact ROOT-bound bootstrap manifest hash required}
zmodload zsh/stat
zstat -H nodeStat -- "$NODE"
[[ -f "$NODE" && ! -L "$NODE" && ${nodeStat[size]} == 112989184 ]] || exit 78
zstat -H bootStat -- "$BOOTSTRAP"
[[ -f "$BOOTSTRAP" && ! -L "$BOOTSTRAP" && ${bootStat[size]} -le 32768 ]] || exit 78
/usr/bin/shasum -a 256 "$NODE" "$BOOTSTRAP" >/private/tmp/safe-bash-pipestatus-actual-78-v1.node.sha256
{ IFS=' ' read -r digest ignored; IFS=' ' read -r bootstrapDigest ignored; } </private/tmp/safe-bash-pipestatus-actual-78-v1.node.sha256
[[ "$digest" == 5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011 ]] || exit 78
[[ "$bootstrapDigest" == "$PIPE_BOOTSTRAP_SHA" ]] || exit 78
/usr/bin/shasum -a 256 -c "$BOOTSTRAP"
: ${PIPE_SEAL:?exact sealed path required} ${PIPE_SEAL_BYTES:?exact size required} ${PIPE_SEAL_SHA256:?exact hash required} ${PIPE_GRANT:?ROOT grant required} ${PIPE_GRANT_BYTES:?exact size required} ${PIPE_GRANT_SHA256:?exact hash required}
exec "$NODE" /Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/preexec-v1/outer.mjs
