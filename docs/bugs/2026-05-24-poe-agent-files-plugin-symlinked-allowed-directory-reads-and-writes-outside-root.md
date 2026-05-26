# Poe Agent files plugin follows a symlinked allowed directory and reads or writes outside its root

## Summary

The Poe Agent `filesPlugin()` restricts tool paths lexically to `cwd` or configured `allowedPaths`, but does not validate canonical filesystem containment. If a directory below an allowed root is a symbolic link to an external location, `read_file` reads external content and `edit_file` creates or overwrites external files while displaying project-local paths.

## Reproduction

From the repository root, create an allowed project directory containing a symlink to an external directory and invoke the plugin's exported tools directly:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/outside"
printf 'outside secret\n' > "$probe/outside/secret.txt"
ln -s "$probe/outside" "$probe/project/linked"

cat > "$probe/repro.mts" <<EOF
import filesPlugin from "file://$PWD/packages/poe-agent/src/plugins/poe-agent-plugin-files.ts";

const plugin = filesPlugin({ cwd: "$probe/project" });
const read = plugin.tools.find((tool: any) => tool.name === "read_file") as any;
const edit = plugin.tools.find((tool: any) => tool.name === "edit_file") as any;

console.log("read=" + JSON.stringify(await read.call({ path: "linked/secret.txt" })));
console.log(await edit.call({ command: "overwrite", path: "linked/new.txt", file_text: "written outside\\n" }));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/linked"
find "$probe/outside" -maxdepth 1 -type f -print -exec sed -n '1,4p' {} \;

nl -ba packages/poe-agent/src/plugins/plugin-args.ts | sed -n '94,110p'
nl -ba packages/poe-agent/src/plugins/poe-agent-plugin-files.ts | sed -n '61,116p;159,213p'
```

## Observed Behavior

Both tools accept paths that are lexically inside the project but resolve through the directory symlink outside the allowed root:

```text
<probe>/project/linked -> <probe>/outside
read="outside secret\n"
Overwrote file: linked/new.txt
<probe>/outside/new.txt
written outside
```

`resolveAllowedPath()` uses only `path.resolve()` and `path.relative()` against the configured lexical allowed roots. The subsequent `readFile()`, `mkdir()`, and `writeFile()` calls follow the symlink target without checking its canonical location.

## Expected Behavior

Poe Agent file tools should enforce canonical containment beneath their configured allowed roots. A symlinked descendant escaping an allowed directory should be rejected for both reads and edits.

## Impact

An agent granted file access to a project can read or modify files outside that authorized tree whenever the project contains a suitable symlink. Because tool responses label operations with project-local paths, this can also obscure that external content was accessed or overwritten.
