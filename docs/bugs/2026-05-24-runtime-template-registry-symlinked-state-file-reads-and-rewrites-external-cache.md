# Runtime template registry follows a symlinked state file and reads or rewrites an external cache

## Summary

The exported runtime template registry persists cached template entries in `<home>/.poe-code/state/templates.json`, but it does not reject an existing symbolic link at that file path. If `templates.json` points to an external JSON file, ordinary `put()`, `list()`, and `remove()` operations read and rewrite the external cache.

## Reproduction

From the repository root, create a disposable home whose template-state file points to an external JSON document, then update and remove an entry through the exported state manager:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code/state" "$probe/outside"
printf '{"docker":{},"e2b":{}}\n' > "$probe/outside/templates.json"
ln -s "$probe/outside/templates.json" "$probe/home/.poe-code/state/templates.json"

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { createStateManager } from "file://$PWD/packages/poe-code-config/src/state/index.ts";

const state = createStateManager("$probe/home");
await state.templates.put("docker", {
  hash: "hash-probe",
  image: "img",
  runtime_type: "docker",
  dockerfile_path: "Dockerfile",
  built_at: "2026-05-24T00:00:00.000Z"
});
console.log("afterPut=" + await readFile("$probe/outside/templates.json", "utf8"));
console.log("listed=" + JSON.stringify(await state.templates.list("docker")));
await state.templates.remove("docker", "hash-probe");
console.log("afterRemove=" + await readFile("$probe/outside/templates.json", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/home/.poe-code/state/templates.json"

nl -ba packages/poe-code-config/src/state/templates.ts | sed -n '25,92p'
```

## Observed Behavior

The registry follows the symlinked state file, adds the cached template entry to the external document, reads it back in listings, and rewrites the external file again when the entry is removed:

```text
<probe>/home/.poe-code/state/templates.json -> <probe>/outside/templates.json
afterPut={
  "docker": {
    "hash-probe": {
      "hash": "hash-probe",
      "image": "img",
      ...
    }
  },
  "e2b": {}
}
listed=[{"hash":"hash-probe","image":"img",...}]
afterRemove={
  "docker": {},
  "e2b": {}
}
```

`createTemplateRegistry()` constructs the state file textually under the selected home. `updateState()` reads the current document and writes replacement JSON at that path under a file lock, while `list()` reads it; no canonical-boundary check excludes a symlinked state file.

## Expected Behavior

Runtime template cache persistence should only access a canonical state file within `<home>/.poe-code/state`. A symbolic link escaping that location should be rejected before reading or rewriting external cache content.

## Impact

An attacker or corrupted local state can redirect runtime template cache reads and writes into an unrelated writable JSON file. This permits external state injection into runtime template discovery and unexpected replacement of data outside poe-code's designated state directory.
