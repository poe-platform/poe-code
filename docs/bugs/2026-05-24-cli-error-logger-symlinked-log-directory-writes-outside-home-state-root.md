# CLI error logger follows a symlinked log directory and writes outside the home-state root

## Summary

The CLI constructs its persistent failure log path beneath `$HOME/.poe-code/logs` but does not verify that this directory remains inside the poe-code home-state boundary. If `$HOME/.poe-code/logs` is a symbolic link, any command error causes the logger to create or append `errors.log` in the symlink target outside `$HOME/.poe-code`.

## Reproduction

From the repository root, point the CLI log directory at a disposable external directory and trigger a deterministic validation failure:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code/logs"

set +e
(
  cd "$probe/project"
  HOME="$probe/home" "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run runtime build --runtime host
)
exit_code=$?
set -e

printf 'exit_code=%s\n' "$exit_code"
ls -ld "$probe/home/.poe-code/logs"
find "$probe/outside" -maxdepth 1 -type f -print -exec sed -n '1,8p' {} \;

nl -ba src/cli/bootstrap.ts | sed -n '18,73p'
nl -ba src/cli/error-logger.ts | sed -n '43,233p'
```

## Observed Behavior

The failing command exits nonzero and creates its diagnostic file in the external symlink target rather than beneath a real log directory owned by poe-code:

```text
exit_code=1
<probe>/home/.poe-code/logs -> <probe>/outside
<probe>/outside/errors.log
[2026-05-24T18:20:44.175Z] ERROR: Host runtime has no template to build. Pass --runtime e2b or --runtime docker, or set "runtime": { "type": "..." } in .poe-code/config.json.
Context: {"component":"main","argv":[...],"operation":"CLI execution"}
Stack trace:
ValidationError: Host runtime has no template to build. ...
```

`createCliMain()` selects `<home>/.poe-code/logs` as the log directory and logs every thrown non-silent error. `ErrorLogger.ensureLogDirectory()` and `writeEntry()` use normal filesystem writes at the joined path, so an existing directory symlink is followed transparently.

## Expected Behavior

The CLI should refuse to write diagnostic files through symbolic-link components or otherwise guarantee that error logs stay within the intended `$HOME/.poe-code/logs` storage boundary. Error handling must not redirect persistent writes into unrelated locations through a user-state symlink.

## Impact

An attacker or corrupted local state able to create `$HOME/.poe-code/logs` as a symbolic link can redirect failure diagnostics, stack traces, request context, and future log rotations to arbitrary writable directories accessible to the user. This can overwrite or append sensitive diagnostic material outside poe-code's designated state location.
