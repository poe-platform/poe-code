# `@poe-code/image-ast`

Zero-dependency image processing AST and pixel pipeline with a `sharp`-compatible API for `@poe-platform/safe-bash` and `@poe-platform/safe-js`.

The main export uses Web Streams and Uint8Array in every runtime, including
Node, browsers and Workers, without Node builtins. Stream cancellation and writable
abort await asynchronous cleanup; `await image.dispose()` explicitly releases stream
resources and reports cleanup failures. With a capable injected filesystem,
unfinished input streams retain encoded chunks in bounded caller-backed storage;
file output, metadata and statistics reuse that snapshot. Clones share its lifetime:
dispose each instance after its last operation, including after writable completion.
Readable output uses the same retained encoders as file output and follows reader
demand. When an `info` listener needs the exact size before the first chunk, encoded
output is retained in caller backing until consumed. Cancellation awaits cleanup.
Explicit buffer methods still materialize their results. File paths require an explicit
`filesystem` with asynchronous `readFile` and `writeFile` methods (such as safe-fs)
and an asynchronous output method; byte inputs also
support synchronous output. `@poe-code/image-ast/portable` exposes the same `sharp` API alongside codecs and
pixel operations; `compositeImage` accepts an explicit `readFile` capability.
Pixel operations also expose `...Steps` generators, such as `resizeImageSteps`,
for hosts that schedule bounded work between event-loop turns. The synchronous
functions return the same pixel results.
`decodeImageToStorage(source, storage, signal, options)` selects a retained raster
decoder and supports raw or generated inputs. It shares the source and backing
contracts of the format-specific codecs. `encodeStoredImage(image, storage, signal,
options)` streams the corresponding output and returns final output information.
`tryImageFile` can publish a retained input with `encoded: {source, info}` to copy an
existing encoded snapshot exactly, without re-encoding pixels. Its idempotent
`close()` retires that input before atomic publication; enclosing operations may
keep ownership of shared backing for other pending outputs.
File adapters can use `withImageSource(input, filesystem, signal, callback)` to scope
retained reads, source-version validation and handle cleanup to a supplied filesystem.
`decodePngToStorage(source, storage, signal)` decodes PNGs through reads and writes
of at most 4 KiB, including wide scanlines and Adam7 interlacing. Supply a
retained byte-range source and backing storage with `allocate`, `read`, and
`write`; the returned `position` addresses packed RGBA pixels in that storage.
`decodeNetpbmToStorage(source, storage, signal)` also accepts all six ASCII/binary
Netpbm variants, including 16-bit samples and comments.
`encodeNetpbmFromStorage(image, storage, signal, format)` streams PPM, PGM or PBM.
`decodeBmpToStorage` and `encodeBmpFromStorage` use bounded palette and row access
for BMP inputs and standard 24-bit BMP output.
`decodeTiffToStorage` reads classic TIFF strips and tiles through caller backing,
including uncompressed, DEFLATE, LZW, PackBits and JPEG data and horizontal prediction.
Shared JPEG tables and strip/tile data are read through bounded logical ranges.
`encodeTiffFromStorage` streams RGBA TIFF pixels with fixed-size header/directory
state, preserving density and orientation.
`decodeHeifToStorage`, `encodeHeifFromStorage`, and `readHeifMetadataFromSource`
use 4 KiB pages and the shared zlib codec for the existing HEIC/HEIF/AVIF
container contract. File inputs, composite sources, metadata and outputs use the
caller's injected safe-fs. Format admission scans compatible brands in bounded
ranges, including brands beyond the initial header. Encoding makes a sizing pass over caller-backed pixels
before emitting the container, so neither compressed output nor box tables need
whole-file buffering. The synchronous byte APIs remain available for in-memory
callers; this does not add native HEVC or AV1 decoding.

`encodePngFromStorage(image, storage, signal)` produces bounded PNG chunks
under downstream backpressure. The caller owns source and storage cleanup.
`transformStoredImage(image, storage, operation, signal)` applies flips, crops,
right-angle rotations and EXIF orientation in small tiles, plus bounded color,
alpha, gamma, threshold, normalization and metadata operations. Canvas extension,
affine transforms, arbitrary rotation, median filtering, trimming, convolution,
Gaussian blur, sharpening, local contrast enhancement (CLAHE), dilation and erosion
also keep raster data in caller storage. For compositing, Boolean operations and channel joins, supply
a `StoredImageResources` resolver as the fifth `transformStoredImage`
argument; it returns decoded images in the same caller-owned storage. PNG, Netpbm, BMP, GIF, JPEG and supported TIFF file
operands and composite overlays use the parent filesystem with retained reads and version checks.
Raw operands support every sample depth in bounded chunks, and created overlays
(including deterministic Gaussian noise) generate directly into caller storage.
Composite placement, tiling and blend modes use fixed pixel caches. Text overlays
scan style ranges and generate bounded pixel chunks in caller storage. Explicit SVG
byte resources use caller-backed raster pages through `decodeSvgToStorage(bytes, storage, signal, options)`;
SVG metadata uses bounded header ranges through `readSvgMetadataFromSource(source, signal, options)`,
including long dimension tokens. `decodeSvgSourceToStorage(source, storage, signal, options)`
reads SVG syntax in bounded ranges and stores path points, text, nested transforms,
and raster pages in caller backing. File inputs and composite resources use this path
automatically. PDF file rendering uses caller-backed input, images and page tiles through `tryPdfDecode`; the same path serves composite resources and transformed metadata. PDF paths, shading and nested captures still have the shared engine’s memory requirements.
Combined resize/blur/sharpen/convolution stages share premultiplied alpha and gamma handling.
`resizeStoredImage(image, storage, options, signal)` supports all resize fits,
gravity, entropy/attention crops, background canvases and image pages.
PNG/PPM/PGM/PBM/BMP/TIFF/GIF/JPEG/WebP/PDF `.toFile()`
conversions with these operations and `.resize()` use the backed codecs automatically when the
supplied filesystem supports retained reads, working storage, and atomic
streaming or retained staged publication. Explicit byte inputs, raw files/bytes and
previously cached files also use this retained output path; cached resource
snapshots remain valid. Symlink destinations stream through guarded retained staging when supported, preserving the link and target hardlink aliases and rejecting concurrent retargeting. Joined file, byte and generated inputs use caller backing for
file output, statistics and metadata, preserving alignment, spacing and animation layout. Generated text and color/noise images
use the same retained output path, and text metadata avoids rendering a pixel canvas.
These input formats also support
streaming TIFF, GIF, JPEG, WebP, PDF and raw output. PDF output streams compressed RGB and transparency from caller-backed pixels. `encodeRawFromStorage` preserves
raw channel/depth conversion and original high-depth samples in caller storage. `encodeGifFromStorage` uses a fixed palette, bounded
pixel caches and pull-driven owned data subblocks, including animated frames.
`decodeGifToStorage` retains LZW input, animation canvases and frame delays in caller
storage, including page selection, interlacing and disposal. Async GIF output reads
those retained delays without a frame-count-sized array.
`decodeWebpToStorage` retains RIFF metadata, VP8L pixels, transforms and Huffman groups
in caller storage with fixed input and word caches.
`encodeWebpFromStorage` scans alpha and emits owned lossless WebP chunks from caller storage.
`encodeJpegFromStorage` emits bounded 8×8 blocks
from caller storage with the same quality, density and EXIF semantics as the
buffered encoder. `decodeJpegToStorage` reads baseline and progressive JPEGs with
bounded input pages and caller-backed coefficients and component planes.
`resampleStoredImage(image, storage, {width, height, kernel}, signal)` resamples
backed RGBA pixels with bounded caches, including alpha and all resize kernels.
Optional explicit scales must round to the requested output dimensions.
`computeStoredImageStats(image, storage, signal)` scans caller-backed pixels for
channel extrema, entropy, sharpness and dominant color using fixed histograms and
a bounded pixel cache, without allocating a grayscale canvas. Async `.stats()`
uses the same retained decoding and transform pipeline when a capable filesystem
is supplied, including file resources, raw data and generated images. Set
`workingDirectory` to select scratch storage in that filesystem; it defaults to
the output directory for `.toFile()`, the input directory for file `.stats()` and `.metadata()`, or
`.` for byte/generated `.stats()`. Scratch handles close on success, failure and
cancellation. Async file statistics do not implicitly cache whole input files;
synchronous statistics require an explicit buffered input.
`readImageMetadataFromSource(source, signal, options, storage?)` inspects PNG, JPEG, WebP, BMP,
Netpbm and raw metadata without rendering pixels. GIF metadata retains frame delays
in caller storage, available through `storedDelay.length` and asynchronous `storedDelay.at(index)`. The PNG, JPEG and WebP readers are
also available individually. TIFF inspection uses the optional caller backing storage
to preserve full decode validation with bounded memory. File `.metadata()` for these formats
uses retained reads and caller-backed transforms, including source version checks
and handle cleanup. PDF metadata uses caller-backed input and indexes without rasterizing pages; the same adapter serves Sips and identify queries. Raw metadata needs only the retained file size. These reads do
not implicitly cache the file for later operations. Use `await image.inspectMetadata(async metadata => { /* read metadata.storedDelay here */ })`
with the injected filesystem to keep lazy metadata resources scoped to your callback.
`.metadata()` preserves its explicit delay-array convenience result. Explicit buffer outputs keep
their existing snapshot behavior.
Use an external backing provider
for large images; memory-backed storage still retains the pixels in RAM.

Input pixel limits are disabled by default; set `limitInputPixels` to a positive
integer to enforce a limit, or `Infinity` to explicitly disable it.

```ts
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";

const filesystem = new MemoryFileSystem();
await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" }, filesystem })
  .png().toFile("/input.png");
await sharp("/input.png", { filesystem }).resize(16, 16).toFile("/output.png");
```

## Features

- **Zero Native Dependencies**: Pure TypeScript PNG, JPEG (baseline/progressive DCT + EXIF), WebP, iPhone HEIC / HEIF / AVIF (ISOBMFF `ftyp`/`meta`/`pitm`/`iprp`/`ipco`/`ispe`/`pixi`/`irot`/`iref`/`iloc`/`Exif`), GIF, Netpbm (`PPM`/`PGM`/`PBM`), BMP, and TIFF codecs, plus PDF and SVG rasterization via `@poe-code/pdf-ast`.
- **Declarative Operation AST**: `.rotate()`, `.resize()` (`cover`, `contain`, `fill`, `inside`, `outside` with Lanczos-3, Mitchell, bilinear, and nearest kernels), `.extract()`, `.trim()`, `.extend()`, `.composite()`, `.modulate()`, `.grayscale()`, `.blur()`, `.sharpen()`, `.threshold()`, `.metadata()`, and `.stats()`.
