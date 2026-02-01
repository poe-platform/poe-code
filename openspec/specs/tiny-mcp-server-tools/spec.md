## ADDED Requirements

### Requirement: Tool registration with fluent API

The server SHALL provide a `.tool()` method that registers tools and returns the server for chaining.

#### Scenario: Register single tool
- **WHEN** `server.tool("greet", "Say hello", schema, handler)` is called
- **THEN** the tool is registered and server is returned for chaining

#### Scenario: Register multiple tools
- **WHEN** `server.tool("a", ...).tool("b", ...).tool("c", ...)` is called
- **THEN** all three tools are registered

### Requirement: Tools list response

The server SHALL respond to `tools/list` requests with all registered tools in MCP format.

#### Scenario: List tools with one registered
- **WHEN** server has one tool "greet" registered and receives `tools/list` request
- **THEN** server responds with `{"tools":[{"name":"greet","description":"...","inputSchema":{...}}]}`

#### Scenario: List tools with none registered
- **WHEN** server has no tools registered and receives `tools/list` request
- **THEN** server responds with `{"tools":[]}`

### Requirement: Tool call execution

The server SHALL execute the registered handler when receiving a `tools/call` request.

#### Scenario: Call tool with valid arguments
- **WHEN** server receives `{"method":"tools/call","params":{"name":"greet","arguments":{"name":"World"}}}`
- **THEN** server executes the "greet" handler with `{name:"World"}` and returns the result

#### Scenario: Call non-existent tool
- **WHEN** server receives `tools/call` for tool "unknown"
- **THEN** server responds with error indicating tool not found

### Requirement: Tool result formatting

The server SHALL format tool results as MCP CallToolResult with content array. Tool handlers MAY return strings, content helper instances (Image, Audio, File), raw content blocks, or arrays combining these types.

#### Scenario: String result
- **WHEN** tool handler returns `"Hello"`
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

### Requirement: Schema definition helper

The package SHALL export a `defineSchema()` function that creates JSON Schema from TypeScript-like declarations.

#### Scenario: Required string field
- **WHEN** `defineSchema({ name: { type: "string", description: "User name" } })` is called
- **THEN** it returns `{ type: "object", properties: { name: { type: "string", description: "User name" } }, required: ["name"] }`

#### Scenario: Optional field
- **WHEN** `defineSchema({ count: { type: "number", optional: true } })` is called
- **THEN** it returns `{ type: "object", properties: { count: { type: "number" } }, required: [] }`

#### Scenario: Mixed required and optional
- **WHEN** `defineSchema({ a: { type: "string" }, b: { type: "number", optional: true } })` is called
- **THEN** it returns schema with `required: ["a"]` (not including "b")

### Requirement: Schema type inference

The `defineSchema()` function SHALL infer TypeScript types from the schema definition.

#### Scenario: Type inference for handler
- **WHEN** a tool is registered with `defineSchema({ name: { type: "string" } })`
- **THEN** the handler's `args` parameter is typed as `{ name: string }`

#### Scenario: Optional type inference
- **WHEN** a tool is registered with `defineSchema({ count: { type: "number", optional: true } })`
- **THEN** the handler's `args` parameter is typed as `{ count?: number }`

### Requirement: Tool handler error handling

The server SHALL catch exceptions from tool handlers and return them as tool errors.

#### Scenario: Handler throws error
- **WHEN** tool handler throws `new Error("Something went wrong")`
- **THEN** server responds with `{"content":[{"type":"text","text":"Error: Something went wrong"}],"isError":true}`

#### Scenario: Handler returns rejected promise
- **WHEN** tool handler returns `Promise.reject(new Error("Async failure"))`
- **THEN** server responds with `{"content":[{"type":"text","text":"Error: Async failure"}],"isError":true}`
