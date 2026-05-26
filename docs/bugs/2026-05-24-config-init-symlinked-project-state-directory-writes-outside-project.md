# `config init` follows a symlinked project-state directory and writes outside the project

## Summary

The `poe-code utils config init` command creates the project configuration at `<project>/.poe-code/config.json` without checking whether `.poe-code` resolves inside the project. If the project's `.poe-code` directory is a symbolic link to an external location, the command reports successful in-project initialization while creating `config.json` outside the project.

## Reproduction

From the repository root, initialize configuration in a disposable project whose poe-code state directory points externally:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/home" "$probe/outside"
ln -s "$probe/outside" "$probe/project/.poe-code"

(
  cd "$probe/project"
  HOME="$probe/home" "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" utils config init
)

find "$probe/outside" -maxdepth 1 -type f -print -exec cat {} \;

nl -ba src/cli/commands/config.ts | sed -n '92,116p'
nl -ba packages/poe-code-config/src/inspect.ts | sed -n '45,68p'
nl -ba packages/poe-code-config/src/store.ts | sed -n '181,191p'
```

## Observed Behavior

The command displays the expected textual project path but the created empty config file is located in the external symlink target:

```text
Created project config at <probe>/project/.poe-code/config.json
<probe>/outside/config.json
{}
```

`resolveProjectConfigPath()` joins the working directory with `.poe-code/config.json`; `executeConfigInit()` passes that path to `initProjectConfig()`, which creates its parent and writes the file without canonical containment checks.

## Expected Behavior

Project configuration initialization should create state only in a canonical `.poe-code` directory owned by the selected project. The command should reject a symlinked project-state directory that resolves outside the project rather than presenting an external write as project-local initialization.

## Impact

A crafted project checkout can cause a routine initialization command to create or overwrite `config.json` in an arbitrary user-writable external directory. The misleading success message obscures the location actually modified and violates the project state boundary.
