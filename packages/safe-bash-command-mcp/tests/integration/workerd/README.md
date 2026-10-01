The fixture checks remote schema discovery and command invocation with both
host-owned authenticated fetch and a host-owned OAuth provider. Run it against
the built or packaged MCP entry, bundling with esbuild's `workerd`, `worker` and
`import` conditions and keeping `node:*` external. Place `bundle.mjs` and
`config.capnp` together under the repository's `out` directory, then run:

```sh
node_modules/workerd/bin/workerd test out/4116/config.capnp
```

The configuration deliberately uses compatibility date `2025-01-01` and only
`nodejs_compat`. The transport needs `node:stream`; the bundle must not import
desktop OAuth, auth-store, `node:os`, `node:fs` or `node:child_process`.
