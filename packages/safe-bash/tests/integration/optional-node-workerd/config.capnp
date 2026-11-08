using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "optional-node", worker = (
    compatibilityDate = "2026-09-04",
    modules = [(name = "bundle.mjs", esModule = embed "bundle.mjs")]
  ))]
);
