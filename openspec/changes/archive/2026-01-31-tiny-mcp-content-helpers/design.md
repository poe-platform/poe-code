## Context

The `@poe-code/tiny-mcp-server` package provides a minimal MCP server implementation with zero runtime dependencies. Tool handlers currently return strings or raw content blocks. When returning rich media (images, audio, video), developers must manually:

1. Fetch the media from a URL
2. Convert to base64
3. Detect/specify MIME type
4. Construct the correct MCP content block structure

FastMCP (Python) solves this with `Image`, `Audio`, and `File` helper classes that handle conversion automatically. This design adapts that pattern for TypeScript with the addition of `fromUrl()` factory methods—a critical feature for API-driven workflows where media is returned as URLs.

## Goals / Non-Goals

**Goals:**

- Ergonomic API for returning images, audio, and files from MCP tools
- `fromUrl()` factory method that fetches and encodes in one call
- `fromBytes()` and `fromBase64()` for when data is already available
- Automatic MIME type detection from URLs and format hints
- Smart text vs binary handling for `File` (matching FastMCP behavior)
- Zero runtime dependencies (use built-in `fetch`, `btoa`)

**Non-Goals:**

- Streaming support (entire content must fit in memory)
- Path-based loading (`fromPath()`) — this is a server package, not filesystem-oriented
- Annotations support (can add later if needed)
- Custom fetch options (headers, timeout) — keep API simple

## Decisions

### 1. Three Helper Classes: Image, Audio, File

**Decision:** Provide `Image`, `Audio`, and `File` classes mirroring FastMCP's design.

```typescript
Image.fromUrl(url)   → ImageContent
Audio.fromUrl(url)   → AudioContent
File.fromUrl(url)    → EmbeddedResource (text or blob based on MIME)
```

**Rationale:** Matches the MCP content type taxonomy. Video uses `File` since MCP has no `VideoContent`.

**Alternatives considered:**
- Single `Media` class with type parameter → less discoverable, harder to type
- Functions instead of classes → classes provide better namespacing and instance methods

### 2. Factory Methods: fromUrl, fromBytes, fromBase64

**Decision:** Each helper has three static factory methods:

```typescript
// Fetch from URL (async)
static async fromUrl(url: string): Promise<Image>

// From raw bytes + format hint
static fromBytes(data: Uint8Array, format: string): Image

// From pre-encoded base64
static fromBase64(base64: string, mimeType: string): Image
```

**Rationale:**
- `fromUrl()` is the most common case (Poe API returns URLs)
- `fromBytes()` for when you have buffer data
- `fromBase64()` for when data is already encoded (avoids double-encoding)

**Alternatives considered:**
- Constructor overloading → TypeScript doesn't support true overloading, factory methods are cleaner
- Omit `fromUrl()` → user feedback: this is a must-have

### 3. MIME Type Detection

**Decision:** Detect MIME type using magic bytes (file signatures) as the primary method:

1. **Magic bytes** (most reliable) - inspect first bytes of content
2. **Content-Type header** (for `fromUrl`) - fallback when magic bytes inconclusive
3. **Explicit parameter** - user override always wins
4. **Error** if still unknown - don't guess

```typescript
// src/content/mime.ts
//
// Minimal magic bytes detection for common media types.
// This can be replaced with `file-type` package (https://npm.im/file-type)
// if more comprehensive detection is needed. The API is designed to be
// compatible: fileTypeFromBuffer(data) returns { mime: string } | undefined

export interface FileTypeResult {
  mime: string;
  ext: string;
}

export function fileTypeFromBuffer(data: Uint8Array): FileTypeResult | undefined {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
    return { mime: "image/png", ext: "png" };
  }
  // JPEG: FF D8 FF
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  // GIF: 47 49 46 38 (GIF8)
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return { mime: "image/gif", ext: "gif" };
  }
  // WEBP: 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP)
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    return { mime: "image/webp", ext: "webp" };
  }
  // MP3: FF FB or FF FA (MPEG audio) or 49 44 33 (ID3 tag)
  if ((data[0] === 0xFF && (data[1] === 0xFB || data[1] === 0xFA)) ||
      (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33)) {
    return { mime: "audio/mpeg", ext: "mp3" };
  }
  // WAV: 52 49 46 46 ... 57 41 56 45 (RIFF...WAVE)
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x41 && data[10] === 0x56 && data[11] === 0x45) {
    return { mime: "audio/wav", ext: "wav" };
  }
  // OGG: 4F 67 67 53 (OggS)
  if (data[0] === 0x4F && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
    return { mime: "audio/ogg", ext: "ogg" };
  }
  // MP4: ... 66 74 79 70 (ftyp box, offset varies)
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    return { mime: "video/mp4", ext: "mp4" };
  }
  // WEBM: 1A 45 DF A3 (EBML header)
  if (data[0] === 0x1A && data[1] === 0x45 && data[2] === 0xDF && data[3] === 0xA3) {
    return { mime: "video/webm", ext: "webm" };
  }
  // M4A: MP4 container with audio - check for M4A brand
  // ftyp followed by M4A brand at offset 8
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70 &&
      data[8] === 0x4D && data[9] === 0x34 && data[10] === 0x41) {
    return { mime: "audio/mp4", ext: "m4a" };
  }
  return undefined;
}
```

**Rationale:** Magic bytes are the most reliable detection method - they work regardless of URL structure or server configuration. This enables `fromBytes(data)` to work without requiring a format parameter for common media types. The API matches `file-type` package for easy swap-in if more comprehensive detection is needed later.

**Alternatives considered:**
- URL extension detection → unreliable, many URLs don't have extensions
- Content-Type header only → servers often lie or return `application/octet-stream`
- Use `file-type` package → adds dependency, but can be swapped in later if needed

### 4. File: Text vs Binary Detection

**Decision:** `File.toContentBlock()` returns `TextResourceContents` for text MIME types, `BlobResourceContents` for binary.

```typescript
if (mimeType.startsWith("text/") || mimeType === "application/json") {
  // Decode as UTF-8, return TextResourceContents
} else {
  // Base64 encode, return BlobResourceContents
}
```

**Rationale:** Matches FastMCP behavior. Text content is more useful unencoded for LLM consumption.

### 5. Tool Return Type Union

**Decision:** Extend tool handler return type to accept helpers:

```typescript
type ToolReturn =
  | string                              // → TextContent
  | Image | Audio | File                // → converted via toContentBlock()
  | ContentBlock                        // → as-is
  | Array<string | Image | Audio | File | ContentBlock>;  // → multiple blocks
```

**Rationale:** Simple cases stay simple (`return "Hello"`), rich cases are ergonomic (`return Image.fromUrl(url)`).

### 6. Conversion Pipeline

**Decision:** Add `toContentBlocks()` function that normalizes any `ToolReturn` to `ContentBlock[]`:

```typescript
function toContentBlocks(result: ToolReturn): ContentBlock[] {
  if (typeof result === "string") {
    return [{ type: "text", text: result }];
  }
  if (result instanceof Image) {
    return [result.toContentBlock()];
  }
  if (result instanceof Audio) {
    return [result.toContentBlock()];
  }
  if (result instanceof File) {
    return [result.toContentBlock()];
  }
  if (Array.isArray(result)) {
    return result.flatMap(toContentBlocks);
  }
  return [result]; // Already a ContentBlock
}
```

**Rationale:** Single point of conversion, called by the server's tool execution handler.

## Risks / Trade-offs

**[Large media in memory]** → Video files can be large. Base64 adds 33% overhead. Mitigation: Document size limits; streaming is a non-goal for v1.

**[Network errors in fromUrl]** → Fetch can fail. Mitigation: Let errors propagate; tool handlers can catch if needed. Clear error messages.

**[No custom fetch options]** → Can't set headers, timeout, etc. Mitigation: Users can fetch themselves and use `fromBytes()`. Keep core API simple.

**[MIME detection heuristics]** → URL might not have extension, Content-Type might be wrong. Mitigation: Allow explicit MIME override in all methods; document detection order.
