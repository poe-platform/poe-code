# Terminal MCP CLI admission

Both terminal MCP bins previously started their stdio servers regardless of command-line arguments, including --help and invalid options. They also started as an import side effect. The PNG entrypoint regressions failed all three admission checks before implementation.

Parse the minimal supported help option before starting stdio. Return failure for unknown options or positional arguments. Emit usage only on stderr and keep default server startup silent. Keep entrypoint imports inert so callers and in-memory tests can invoke the CLI explicitly.

Validate both entrypoints with mocked transport startup, maintained builds, and ad hoc help/error screenshots from built artifacts.
