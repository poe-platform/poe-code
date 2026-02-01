## Why

MCP tools returning rich media (images, audio, video) currently require manual base64 encoding, MIME type detection, and content block construction. A set of ergonomic helper classes (`Image`, `Audio`, `File`) would provide a clean API for returning media from tools, including the ability to fetch directly from URLs—a common pattern when working with APIs like Poe that return media URLs.

## What Changes

- Add `Image` class with static factory methods (`fromUrl`, `fromBytes`, `fromBase64`) that converts to `ImageContent`
- Add `Audio` class with same pattern that converts to `AudioContent`
- Add `File` class for arbitrary files (including video) that converts to `EmbeddedResource` with smart text/binary detection
- Add internal `toContentBlocks()` converter that handles the tool return type union
- Extend tool handler return type to accept helpers alongside raw strings and content blocks

## Capabilities

### New Capabilities

- `mcp-content-helpers`: Image, Audio, and File helper classes for ergonomic rich media returns from MCP tools

### Modified Capabilities

- `tiny-mcp-server-tools`: Extend tool handler return type to accept content helpers

## Impact

- **Package**: Adds `src/content/` directory to `@poe-code/tiny-mcp-server`
- **Dependencies**: None (zero runtime dependencies maintained)
- **API**: Tool handlers can return `Image`, `Audio`, `File` in addition to strings
- **Prerequisite**: Requires `tiny-mcp-server` core to be implemented first
