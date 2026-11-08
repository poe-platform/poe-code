# MCP Proxy QA

- [ ] First-run discovery
      Delete `.toolcraft/mcp/` from the project root, run a CLI command that traverses the MCP proxy group, and confirm `stderr` shows discovery progress lines such as `MCP <name>: connecting`, `listing tools`, `found ... tools`, and `wrote ...`. Confirm `<projectRoot>/.toolcraft/mcp/<group-name>.json` is created.
- [ ] Second-run silence
      Run the same command again without deleting the cache. Confirm the command still works and no MCP discovery lines are emitted to `stderr`.
- [ ] Refresh env var
      Set `TOOLCRAFT_MCP_REFRESH=<name>` and rerun the same command. Confirm discovery runs again for that proxy group and the corresponding cache file's modified time is updated.
- [ ] Rename map
      Add `rename: { <upstream>: "sub.renamed" }` to the proxy group, rerun `<command-with-mcp-group> --help`, and confirm the command appears at the renamed path. Invoke the renamed command and confirm it still calls the upstream tool successfully.
- [ ] Recursive `$ref` fallback
      Point the proxy group at a fixture upstream that exposes a recursive tool schema, run `--help`, and confirm the CLI exposes a single `--<name> '<json>'` flag for the recursive input instead of expanding nested flags.
- [ ] Missing `package.json`
      Run the CLI from a directory above any ancestor `package.json` and confirm it fails with the clear cache-path error message: `Could not find package.json above "<cwd>" while resolving MCP cache path.`
- [ ] Visual
      Run `npm run screenshot-poe-code -- <command-with-mcp-group> --help` and confirm the help output uses the same design-system theming and layout as the rest of the CLI.
