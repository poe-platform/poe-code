# mcp-content-helpers

## ADDED Requirements

### Requirement: Image helper class

The package SHALL export an `Image` class for creating ImageContent from various sources.

#### Scenario: Image from URL

- **WHEN** `await Image.fromUrl("https://example.com/photo.png")` is called
- **THEN** the URL is fetched and an Image instance is created with the data and detected MIME type

#### Scenario: Image from bytes with format

- **WHEN** `Image.fromBytes(uint8Array, "png")` is called
- **THEN** an Image instance is created with MIME type `image/png`

#### Scenario: Image from base64

- **WHEN** `Image.fromBase64(base64String, "image/jpeg")` is called
- **THEN** an Image instance is created with the provided MIME type

#### Scenario: Image to content block

- **WHEN** `image.toContentBlock()` is called on an Image instance
- **THEN** it returns `{ type: "image", data: "<base64>", mimeType: "<mime>" }`

### Requirement: Audio helper class

The package SHALL export an `Audio` class for creating AudioContent from various sources.

#### Scenario: Audio from URL

- **WHEN** `await Audio.fromUrl("https://example.com/sound.mp3")` is called
- **THEN** the URL is fetched and an Audio instance is created with the data and detected MIME type

#### Scenario: Audio from bytes with format

- **WHEN** `Audio.fromBytes(uint8Array, "wav")` is called
- **THEN** an Audio instance is created with MIME type `audio/wav`

#### Scenario: Audio from base64

- **WHEN** `Audio.fromBase64(base64String, "audio/mpeg")` is called
- **THEN** an Audio instance is created with the provided MIME type

#### Scenario: Audio to content block

- **WHEN** `audio.toContentBlock()` is called on an Audio instance
- **THEN** it returns `{ type: "audio", data: "<base64>", mimeType: "<mime>" }`

### Requirement: File helper class

The package SHALL export a `File` class for creating EmbeddedResource from various sources.

#### Scenario: File from URL with binary content

- **WHEN** `await File.fromUrl("https://example.com/video.mp4")` is called
- **THEN** the URL is fetched and a File instance is created with the data and detected MIME type

#### Scenario: File from bytes

- **WHEN** `File.fromBytes(uint8Array, "video/mp4")` is called
- **THEN** a File instance is created with the provided MIME type

#### Scenario: File from text

- **WHEN** `File.fromText("hello world", "text/plain")` is called
- **THEN** a File instance is created that will produce TextResourceContents

#### Scenario: File to content block - binary

- **WHEN** `file.toContentBlock()` is called on a File with binary MIME type (e.g., `video/mp4`)
- **THEN** it returns EmbeddedResource with BlobResourceContents containing base64 blob

#### Scenario: File to content block - text

- **WHEN** `file.toContentBlock()` is called on a File with text MIME type (e.g., `text/plain`)
- **THEN** it returns EmbeddedResource with TextResourceContents containing decoded text

### Requirement: MIME type detection via magic bytes

The package SHALL export a `fileTypeFromBuffer()` function that detects MIME type from file content using magic byte signatures. The API SHALL be compatible with the `file-type` package for easy replacement.

#### Scenario: Detect PNG from magic bytes

- **WHEN** `fileTypeFromBuffer(pngData)` is called with data starting with `89 50 4E 47`
- **THEN** it returns `{ mime: "image/png", ext: "png" }`

#### Scenario: Detect JPEG from magic bytes

- **WHEN** `fileTypeFromBuffer(jpegData)` is called with data starting with `FF D8 FF`
- **THEN** it returns `{ mime: "image/jpeg", ext: "jpg" }`

#### Scenario: Detect MP4 from magic bytes

- **WHEN** `fileTypeFromBuffer(mp4Data)` is called with data containing `ftyp` at offset 4
- **THEN** it returns `{ mime: "video/mp4", ext: "mp4" }`

#### Scenario: Unknown file type

- **WHEN** `fileTypeFromBuffer(unknownData)` is called with unrecognized magic bytes
- **THEN** it returns `undefined`

### Requirement: MIME type detection in helpers

The content helpers SHALL use magic bytes as the primary MIME detection method, with Content-Type header as fallback for `fromUrl()`.

#### Scenario: Detect type from content in fromUrl

- **WHEN** `Image.fromUrl("https://example.com/image")` is called and content has PNG magic bytes
- **THEN** the MIME type is detected as `image/png` regardless of URL or headers

#### Scenario: Fallback to Content-Type header

- **WHEN** `File.fromUrl(url)` is called and magic bytes are unrecognized but Content-Type is `application/pdf`
- **THEN** the MIME type is `application/pdf`

#### Scenario: Explicit MIME overrides detection

- **WHEN** `Image.fromBytes(data, "image/webp")` is called with PNG data but explicit MIME
- **THEN** the MIME type is `image/webp` (explicit wins)

### Requirement: URL fetch error handling

The `fromUrl()` methods SHALL throw descriptive errors when fetch fails.

#### Scenario: HTTP 404 error

- **WHEN** `Image.fromUrl("https://example.com/notfound.png")` is called and server returns 404
- **THEN** an error is thrown with message containing the URL and status code

#### Scenario: Network error

- **WHEN** `Image.fromUrl("https://invalid.example/image.png")` is called and network fails
- **THEN** an error is thrown with message describing the network failure

### Requirement: Content blocks conversion utility

The package SHALL export a `toContentBlocks()` function that normalizes tool return values.

#### Scenario: Convert string

- **WHEN** `toContentBlocks("Hello")` is called
- **THEN** it returns `[{ type: "text", text: "Hello" }]`

#### Scenario: Convert Image instance

- **WHEN** `toContentBlocks(imageInstance)` is called
- **THEN** it returns `[imageInstance.toContentBlock()]`

#### Scenario: Convert array of mixed types

- **WHEN** `toContentBlocks(["Hello", imageInstance, audioInstance])` is called
- **THEN** it returns array with TextContent, ImageContent, and AudioContent

#### Scenario: Pass through raw content block

- **WHEN** `toContentBlocks({ type: "text", text: "raw" })` is called
- **THEN** it returns `[{ type: "text", text: "raw" }]`
