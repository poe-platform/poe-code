using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "utf8-literal-search", worker = (
    compatibilityDate = "2025-01-01",
    modules = [(name = "bundle.mjs", esModule = embed "bundle.mjs")]
  ))]
);
