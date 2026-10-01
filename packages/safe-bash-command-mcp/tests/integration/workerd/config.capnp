using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "mcp", worker = (
    compatibilityDate = "2025-01-01",
    compatibilityFlags = [],
    modules = [(name = "bundle.mjs", esModule = embed "bundle.mjs")]
  ))]
);
