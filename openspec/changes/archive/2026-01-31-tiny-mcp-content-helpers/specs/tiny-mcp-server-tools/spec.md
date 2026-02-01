# tiny-mcp-server-tools

## MODIFIED Requirements

### Requirement: Tool result formatting

The server SHALL format tool results as MCP CallToolResult with content array. Tool handlers MAY return strings, content helper instances (Image, Audio, File), raw content blocks, or arrays combining these types.

#### Scenario: String result

- **WHEN** tool handler returns `"Hello"`
- **THEN** server responds with `{"content":[{"type":"text","text":"Hello"}]}`

#### Scenario: Text result object (legacy)

- **WHEN** tool handler returns `{ text: "Hello" }`
- **THEN** server responds with `{"content":[{"type":"text","text":"Hello"}]}`

#### Scenario: Image helper result

- **WHEN** tool handler returns `Image.fromBytes(data, "png")`
- **THEN** server responds with `{"content":[{"type":"image","data":"<base64>","mimeType":"image/png"}]}`

#### Scenario: Audio helper result

- **WHEN** tool handler returns `Audio.fromBytes(data, "mp3")`
- **THEN** server responds with `{"content":[{"type":"audio","data":"<base64>","mimeType":"audio/mpeg"}]}`

#### Scenario: File helper result

- **WHEN** tool handler returns `File.fromBytes(data, "video/mp4")`
- **THEN** server responds with `{"content":[{"type":"resource","resource":{"blob":"<base64>","mimeType":"video/mp4","uri":"..."}}]}`

#### Scenario: Mixed array result

- **WHEN** tool handler returns `["Description text", Image.fromBytes(data, "png")]`
- **THEN** server responds with `{"content":[{"type":"text","text":"Description text"},{"type":"image","data":"<base64>","mimeType":"image/png"}]}`

#### Scenario: Raw content block passthrough

- **WHEN** tool handler returns `{ type: "text", text: "raw" }`
- **THEN** server responds with `{"content":[{"type":"text","text":"raw"}]}`

#### Scenario: Multiple content items (legacy)

- **WHEN** tool handler returns `{ content: [{ type: "text", text: "A" }, { type: "text", text: "B" }] }`
- **THEN** server responds with `{"content":[{"type":"text","text":"A"},{"type":"text","text":"B"}]}`
