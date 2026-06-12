# Toolcraft guide

This is the source guide for the task-oriented documentation page emitted at `dist-site/docs/index.html`.

## First command

Install `toolcraft` (the `S` schema builders ship with it), define a command with its schema and handler together, add it to a root group, and pass that root to the runtime you need.

## Mental model

Command definitions own contracts. Runtime adapters own transport. A handler should not parse argv, speak JSON-RPC, or know whether it was called by a human, an agent, or application code.

1. Define params, secrets, services, requirements, output, and the handler.
2. Compose commands into groups and one root tree.
3. Expose the root through CLI, MCP, or SDK adapters.
4. Govern risky operations with preconditions and human approval.

## Runtime surfaces

- CLI: `runCLI`
- MCP: `runMCP`
- SDK: `createSDK`
- OpenAPI generation: `toolcraft-openapi`

## Safety

Declare secrets, inject services at the runtime boundary, add machine-checkable preconditions, require human approval for destructive actions, and limit scope per runtime.

## Migration

Wrap existing scripts incrementally. Move input parsing to the command contract, call the existing function from the handler, and keep old entrypoints until their callers have moved.

## Package guides

- `packages/toolcraft/README.md`
- `packages/toolcraft-schema/README.md`
- `packages/toolcraft-openapi/README.md`
- `packages/toolcraft-codemode/README.md`

## Configuration

The landing-page package exposes no runtime environment variables. Command-specific environment variables and configuration are documented by the package that owns them.
