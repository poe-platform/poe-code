using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "production-portable-search", worker = (
    compatibilityDate = "2025-01-01",
    modules = [(name = "bundle.mjs", esModule = embed "bundle.mjs")]
  ))]
);
