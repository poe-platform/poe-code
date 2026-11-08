using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "python-diagnostics", worker = (
    compatibilityDate = "2026-07-08",
    modules = [(name = "bundle.mjs", esModule = embed "bundle.mjs")]
  ))]
);
