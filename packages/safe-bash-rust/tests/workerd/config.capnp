using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "safe-bash", worker = (
    compatibilityDate = "2025-01-01",
    modules = [
      (name = "shell.mjs", esModule = embed "../shell.mjs"),
      (name = "@poe-code/safe-bash-rust", esModule = embed "../../dist/workerd.js"),
      (name = "@poe-code/safe_bash_rust.wasm", wasm = embed "../../dist/safe_bash_rust.wasm"),
      (name = "@poe-code/stream-adapter.wasm", wasm = embed "../../dist/stream-adapter.wasm")
    ]
  ))]
);
