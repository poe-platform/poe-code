# MCP Package Size Reduction Plan

## Problem

The install size increased from ~2MB to ~15MB after adding MCP support, primarily due to:
- `@modelcontextprotocol/sdk` - 4.96MB
- `zod` - 4.14MB (dependency of MCP SDK)

## Solution

Replace the MCP SDK with a minimal custom implementation for production while keeping the SDK as a dev dependency for testing.

## Implementation Status

### Completed

1. **Created minimal MCP server** (`src/cli/mcp-minimal.ts`)
   - Implements JSON-RPC 2.0 over stdio
   - Handles: `initialize`, `tools/list`, `tools/call`, `ping`
   - Exports `MinimalMcpServer` class and `schema` helpers
   - Supports custom streams via `connect(streams?: McpStreams)`

2. **Updated mcp-server.ts**
   - Replaced zod schemas with plain TypeScript objects
   - Uses `MinimalMcpServer` instead of SDK's `McpServer`
   - Removed `StdioServerTransport` - handled internally by minimal server

3. **Created mcp-server-entry.ts**
   - Standalone entry point for running MCP server (for subprocess testing)
   - Initializes credentials and client before starting server

4. **Updated package.json**
   - Removed `@modelcontextprotocol/sdk` from dependencies
   - Removed `zod` from dependencies
   - Added `@modelcontextprotocol/sdk` to devDependencies (for testing)

### Remaining Work

1. **Update integration tests** (`tests/integration/mcp-server.test.ts`)
   - Current test uses subprocess spawning which requires credentials
   - Options:
     a. Use SDK's `Client` + `InMemoryTransport` with a transport adapter
     b. Use linked PassThrough streams with `MinimalMcpClient`
     c. Split tests: protocol tests (no API) vs integration tests (with API)

2. **Verify build passes**
   ```bash
   npm run build
   npm run test
   npm run lint
   ```

3. **Verify package size reduction**
   ```bash
   npm pack --dry-run
   # or
   npx cost-of-modules
   ```

## Test Strategy

### Protocol Tests (No API calls)
- `tools/list` - verify tool definitions
- `initialize` - verify protocol handshake
- Schema validation

### Integration Tests (Require credentials)
- `tools/call` with generate_text, generate_image, etc.
- Run via `npm run test:integration`

## Files Modified

- `src/cli/mcp-minimal.ts` - NEW - minimal MCP server
- `src/cli/mcp-server.ts` - Updated to use minimal server
- `src/cli/mcp-server-entry.ts` - NEW - standalone entry point
- `tests/integration/mcp-server.test.ts` - Needs update for new architecture
- `package.json` - Dependencies reorganized

## Expected Size Savings

| Before | After |
|--------|-------|
| ~15MB  | ~2MB  |

Savings: ~13MB (removing ~9MB of SDK + zod from production bundle)
