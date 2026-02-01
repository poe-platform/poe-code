# Tasks

## 1. MIME Detection

- [x] 1.1 Create `src/content/mime.ts` with `fileTypeFromBuffer()` function
- [x] 1.2 Implement magic byte detection for images (PNG, JPEG, GIF, WEBP)
- [x] 1.3 Implement magic byte detection for audio (MP3, WAV, OGG, M4A)
- [x] 1.4 Implement magic byte detection for video (MP4, WEBM)
- [x] 1.5 Export `FileTypeResult` interface matching `file-type` package API
- [x] 1.6 Write tests for `fileTypeFromBuffer()` with real file signatures

## 2. Image Helper

- [x] 2.1 Create `src/content/image.ts` with `Image` class
- [x] 2.2 Implement `Image.fromUrl()` with fetch and magic byte detection
- [x] 2.3 Implement `Image.fromBytes()` with optional explicit MIME
- [x] 2.4 Implement `Image.fromBase64()` with required MIME
- [x] 2.5 Implement `Image.toContentBlock()` returning `ImageContent`
- [x] 2.6 Write tests for Image helper (all factory methods + toContentBlock)

## 3. Audio Helper

- [x] 3.1 Create `src/content/audio.ts` with `Audio` class
- [x] 3.2 Implement `Audio.fromUrl()` with fetch and magic byte detection
- [x] 3.3 Implement `Audio.fromBytes()` with optional explicit MIME
- [x] 3.4 Implement `Audio.fromBase64()` with required MIME
- [x] 3.5 Implement `Audio.toContentBlock()` returning `AudioContent`
- [x] 3.6 Write tests for Audio helper

## 4. File Helper

- [x] 4.1 Create `src/content/file.ts` with `File` class
- [x] 4.2 Implement `File.fromUrl()` with fetch and MIME detection
- [x] 4.3 Implement `File.fromBytes()` with required MIME
- [x] 4.4 Implement `File.fromText()` with optional MIME (default text/plain)
- [x] 4.5 Implement `File.fromBase64()` with required MIME
- [x] 4.6 Implement `File.toContentBlock()` with text vs binary detection
- [x] 4.7 Write tests for File helper (including text/binary detection)

## 5. Content Conversion

- [x] 5.1 Create `src/content/convert.ts` with `toContentBlocks()` function
- [x] 5.2 Handle string → TextContent conversion
- [x] 5.3 Handle Image/Audio/File → respective content blocks
- [x] 5.4 Handle arrays with mixed types
- [x] 5.5 Handle raw ContentBlock passthrough
- [x] 5.6 Write tests for `toContentBlocks()` conversion

## 6. Server Integration

- [x] 6.1 Update `ToolReturn` type to include content helpers
- [x] 6.2 Integrate `toContentBlocks()` into tool call handler
- [x] 6.3 Write integration tests for tool handlers returning content helpers

## 7. Exports

- [x] 7.1 Create `src/content/index.ts` barrel export
- [x] 7.2 Export `Image`, `Audio`, `File`, `toContentBlocks` from main index
- [x] 7.3 Export `fileTypeFromBuffer`, `FileTypeResult` from main index
- [x] 7.4 Verify package builds successfully
- [x] 7.5 Verify all tests pass
