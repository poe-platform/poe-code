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
FITS output writes 8-bit or 16-bit grayscale and RGB primary images with bottom-up planes and 2880-byte block padding; alpha is omitted.
Explicit buffer methods still materialize their results. File paths require an explicit
`filesystem` with asynchronous `readFile` and `writeFile` methods (such as safe-fs)
and an asynchronous output method; byte inputs also
support synchronous output. `@poe-code/image-ast/portable` exposes the same `sharp` API alongside codecs and
pixel operations; `compositeImage` accepts an explicit `readFile` capability.
Pixel operations also expose `...Steps` generators, such as `resizeImageSteps`,
for hosts that schedule bounded work between event-loop turns. The synchronous
functions return the same pixel results. Unknown file formats are discarded in bounded
chunks and rejected without whole-file fallback, preserving read failures, cancellation
and cleanup errors for primary inputs and secondary image resources.
`decodeImageToStorage(source, storage, signal, options)` selects a retained raster
decoder and supports raw or generated inputs. TGA input supports uncompressed and
RLE grayscale (8-bit) and true-color images (24-bit RGB or 32-bit RGBA) and indexed images (8/16-bit indices into 24/32-bit palettes), preserving origin and alpha. It shares the source and backing
contracts of the format-specific codecs. `encodeStoredImage(image, storage, signal,
options)` streams the corresponding output and returns final output information.
PSD input reads the composite (`page: 0`) and layers (`page: 1` onward), with raw or RLE-compressed 8/16-bit RGB and grayscale pixels, alpha, page geometry and resolution. PSB, ZIP compression and other PSD color modes are unsupported.

MIFF output preserves indexed PNG colormaps and pixel indices, including duplicate and unused entries, with 8/16-bit samples and None, RLE, Zip or BZip compression. MIFF input accepts these compressed indexed files. MIFF output preserves `renderingIntent`, including intent read from BMP V5 and MIFF input, and each frame’s `orientation` without rotating pixels. Uncompressed DirectClass and indexed PseudoClass MIFF input preserves labels, comments and custom properties in `properties` and retains stored gamma in `gamma` and reports the frame count in `pages`; pass `{ page: 1 }` to select the second frame in buffered or retained decoding. DirectClass MIFF input accepts LZMA-compressed 8-bit and 16-bit RGB/grayscale frames, preserving alpha and low-order sample bits. Each frame retains its disposal method in `disposal`. Each frame retains its MIFF page dimensions and signed offsets in `virtualCanvas`, independently of raster dimensions; ImageMagick paper sizes such as `7x9` resolve to PostScript points (`504x648`). DirectClass input also preserves CIELab, XYZ, HSL and YCbCr components and their `magickColorspace` tag. DirectClass CMYK input retains the four ink channels in `hueSamples` (or `storedHueSamples` in caller storage) separately from RGBA backing pixels and opacity. MIFF output preserves those ink channels and optional alpha at 8 or 16 bits, including compressed output. DirectClass MIFF input preserves extra channel planes in `metaChannels` (or `storedMetaChannels` in caller storage), separately from color and alpha samples. Indexed input expands RGB palettes and per-pixel alpha at 8 or 16 bits. DirectClass input also reads unsigned 32-bit and normalized IEEE 16- or 32-bit floating-point samples, scaled to 16-bit pixel buffers. MIFF decoding and encoding preserve each frame’s primary and white-point coordinates in `chromaticity`, including after pixel transforms. MIFF input retains both resolution axes and units in `resolution`, with `density` in pixels per inch. Both encoders preserve original MIFF frame timing from `delayTicks` and `ticksPerSecond` when provided, both resolution axes, resolution units, and 16-bit MIFF samples and accept `miffDepth: 8 | 16` to select output depth and `miffCompression: "rle"` for run-length compression or `"bzip"` for lossless BZip compression. The default is `"none"`. Set `miffCompression: "zip"` for lossless Zip compression. MIFF output preserves extra grayscale planes in `metaChannels` (or `storedMetaChannels` for retained images), including 16-bit samples; images with extra planes use uncompressed output when RLE is requested because native RLE packets cannot carry them.
OTB on-the-air bitmap input supports byte-padded bilevel rows and both 8-bit and 16-bit dimensions through buffered and retained decoding.
XWD version-7 ZPixmap input supports 8-bit indexed colors and 24/32-bit true-color pixels, including row padding and either pixel byte order, through buffered and retained decoding.
Both encoders accept `format: "otb"` for monochrome on-the-air bitmaps with byte-padded rows and 8-bit or 16-bit dimensions; `.toFormat("otb")` and `.otb` file output select the same encoder. Both encoders accept `format: "sixel"` for terminal SIXEL graphics with a quantized RGB palette and binary transparency; `.toFormat("sixel")` and `.sixel` file output select the same encoder. Both encoders accept `format: "xpm"` for XPM C source with native color names, uppercase hexadecimal colors, and binary transparency, using one character per pixel through 92 palette entries and wider symbols for larger palettes. Set `outputFilename` to derive the C array name from a basename (for example, `app-icon.xpm` becomes `app_icon`); file output supplies its destination automatically, and unnamed buffers use `image`. `format: "xwd"` writes version-7, 24-bit RGB XWD with padded rows, including indexed inputs; alpha is omitted. The sharp API also accepts `.toFormat("xwd")`. `format: "pcx"`, `.toFormat("pcx")`, and `.pcx` file output write version-5 PCX with lossless 8-bit RGB planes, run-length encoding, and inch resolution; alpha is omitted.
Both encoders accept `format: "tga"` for grayscale or RGB/RGBA TGA output. Opaque grayscale images use 8-bit type 3 (uncompressed) or type 11 (RLE); images with alpha retain 32-bit RGBA. Set optional
`tgaCompression: "rle"` or `"none"` to override compression (default: preserve TGA input compression, otherwise uncompressed). The image’s `properties.comment`
is written as the TGA image ID, truncated to 255 UTF-8 bytes. Palette sources with at most 256 colors use indexed type 1 or 9 with 8-bit indices and RGB/RGBA palette entries. TGA output uses the image's `orientation` for its origin, preserving stored sample order; undefined orientation defaults to top-left.
Both `encodeImage` and `encodeStoredImage` accept `format: "apng"` to encode
stacked RGBA frames using `pageHeight`, millisecond delays and a total play count
(`loop: 0` repeats indefinitely).
`tryImageFile` can publish a retained input with `encoded: {source, info}` to copy an
existing encoded snapshot exactly, without re-encoding pixels. Its idempotent
`close()` retires that input before atomic publication; enclosing operations may
keep ownership of shared backing for other pending outputs.
File adapters can use `withImageSource(input, filesystem, signal, callback)` to scope
retained reads, source-version validation and handle cleanup to a supplied filesystem.

Read type-0 WBMP wireless bitmaps with multi-byte dimensions and byte-padded rows through buffered and storage-backed inputs. Read native SIXEL graphics with RGB or HLS palettes, repeated columns, and six-row bands through buffered and storage-backed inputs. Write level-zero WBMP with `format: "wbmp"`, `.toFormat("wbmp")`, or `.wbmp` file output; both encoders preserve byte-padded monochrome rows and multi-byte dimensions. Read and write XBM C byte arrays with least-significant-bit-first pixels and byte-padded scanlines, including widths that are not multiples of eight. Decoded XBM images retain their white/black palette and 8-bit sRGB representation, including unused colors for palette cycling. XBM width, height, and bitmap identifiers use the output filename with C identifier sanitization. Read legacy X10 short arrays with least-significant-bit-first pixels and 16-bit-padded scanlines. QOI output (`format: "qoi"`) preserves 8-bit RGB and RGBA samples, including colors under fully transparent pixels. Linear RGB output carries the QOI linear-colorspace flag. PSD output (`format: "psd"`) writes an RGB composite and one editable layer, preserving 8-bit or 16-bit samples, alpha, and resolution. Both buffered and storage-backed encoding are supported.

XPM icons support transparent `None` colors, native XPM/X11 names and values (including `green`, `gray`, `grey50`, and spaced names), hexadecimal colors, and multi-character pixel symbols in buffered and filesystem input. Hex colors with a trailing alpha component are accepted as opaque RGB; use `None` for transparency.
ImageMagick TXT pixel enumerations are detected by signature. Explicitly signed tuple components are skipped, shifting later channels left and filling the tail with zero, matching native ImageMagick. TXT headers retain their derived bit depth and sample range, including nonstandard maxima and 32-bit samples, without rounding fractional working samples to 8 bits. Trailing numeric `srgb(...)` annotations override the pixel tuple in the header’s sample units, matching native ImageMagick. HSL, HSV, HSB, HWB, YCbCr, DisplayP3, CMY and Luv input retains its declared colorspace, alpha, and 16-bit samples. RGB, XYZ, CMYK, grayscale, and CIELab input preserves alpha and 16-bit samples; `page` selects an image from concatenated enumerations.

Lossless animated WebP inputs expose `pages`, millisecond `delay` values and `loop` metadata. Use `page` to decode a frame, including its canvas offset and disposal. Buffered and storage-backed decoders support the same frame selection.

ICO and CUR inputs decode PNG entries and uncompressed 1/4/8/24/32-bit DIB entries with transparency, including native DIB dimensions above 256 pixels. Set `page` to select a directory entry; metadata reports the directory count as `pages`.

ICO output supports 1–512 pixel dimensions and preserves RGBA transparency in 32-bit DIB entries. `encodeImage` accepts `icoPages` for multiple entries; `encodeStoredImage` accepts `storedIcoPages` and streams rows from caller storage.

`decodePngToStorage(source, storage, signal)` decodes PNGs through reads and writes
of at most 4 KiB, including wide scanlines and Adam7 interlacing. Supply a
retained byte-range source and backing storage with `allocate`, `read`, and
`write`; the returned `position` addresses packed RGBA pixels in that storage.
PNG readers discard ancillary chunks with invalid checksums; `decodeWarnings`
reports the discarded chunks without failing the decode.
`decodeNetpbmToStorage(source, storage, signal)` accepts P1–P7
Netpbm images, including PAM alpha, 16-bit samples and comments. PAM also accepts ImageMagick’s four-byte sample extension for MAXVAL above 65535. Binary P5/P6 inputs with MAXVAL above 65535 use four-byte big-endian samples. Fractional scaled samples retain Q16-HDRI precision for pixel expressions and effective-depth queries. Fractional scaled samples retain Q16-HDRI precision for pixel expressions and effective-depth queries. Buffered and retained metadata and decoding report source depth from MAXVAL in `bitsPerSample`, independently of the sample storage width. Binary P5/P6/P7 maxima from 128 through 255 and 32768 through 65535 preserve stored 8-bit and 16-bit values, respectively, matching ImageMagick; other maxima and ASCII samples are scaled, retaining 16-bit precision when needed. Frame detection follows ImageMagick: binary frames must be directly adjacent. For plain P2/P3, the final sample consumes its delimiter and the rest of the following line is discarded, so two LFs between frames preserve both; one LF stops after the first frame. P1 discards the remainder of the final sample line without consuming a delimiter first.
Radiance HDR output (`format: "hdr"`) writes linear RGBE samples without alpha, using planar scanlines for widths from 8 to 32767 pixels. OpenEXR output (`format: "exr"`) writes uncompressed float32 RGB or RGBA scanlines. OpenEXR scanline input supports uncompressed, RLE, ZIPS, ZIP and PIZ RGB/RGBA or grayscale channels, preserving negative and above-white samples for PFM output. Tiled, multipart, deep and other compression modes are rejected. Radiance RGBE and XYZE (`.hdr`) input supports flat pixels and planar RLE, preserves float samples, and matches native ImageMagick’s 16-bit PNG colors. XYZE channels are transformed from XYZ to sRGB for image output. Flat pixels containing `01 01 01` are read literally; truncated rasters are rejected. PFM input reads the declared byte order and bottom-to-top rows, preserving unclamped float32 samples for PFM round trips and 16-bit precision for PNG output. `encodeImage` and `encodeStoredImage` also write PFM (`format: "pfm"`): normalized big-endian float32 RGB or grayscale samples, with bottom-to-top rows and no alpha.

`encodeNetpbmFromStorage(image, storage, signal, format, depth?, ascii?)` streams PAM, PPM, PGM or PBM. Netpbm encoders write `properties.comment` as header comment lines without changing pixel samples. PAM preserves RGB alpha and CMYK/CMYK_ALPHA ink samples, keeping black ink separate from alpha, and always uses binary samples. PPM and PAM default to the image’s declared sample depth (up to 16 bits), falling back to the pixel buffer depth. For PAM, PPM and PGM, an optional depth from 1 to 32 sets MAXVAL and scales samples; binary depths 17–32 use four-byte big-endian samples (the ImageMagick extension). `encodeImage` and `encodeStoredImage` expose this as `netpbmDepth`. Set `ascii` (or `netpbmAscii` on encode options) to emit P3/P2/P1 text instead of binary P6/P5/P4. Generic `pnm` output keeps color images in binary P6 even when `netpbmAscii` is set; grayscale and bilevel images still use P2/P1. Plain PPM/PGM use MAXVAL 255 for depths 1–8 and 65535 for depths 9–32, scaling samples to that range.
`decodeBmpToStorage` and `encodeBmpFromStorage` use bounded palette and row access
for BMP and standalone DIB inputs (including 32-bit channel masks and optional alpha) and BMP output selected with `bmpFormat: "bmp2" | "bmp3" | "bmp4"` (default: `bmp3`). Use `bmpFormat: "dib"` for a standalone DIB with a 40-byte bitmap header and no BMP file header. BMP2 uses a 12-byte CORE header, BMP3 a 40-byte header, and BMP4 a 124-byte header with alpha support and embedded source ICC profiles. Set `bmpRenderingIntent` to `"Saturation"`, `"Relative"`, `"Perceptual"` or `"Absolute"` to select the BMP4 rendering intent (default: Perceptual). Set `bmp3Alpha: true` to preserve alpha in BMP3 output. BMP3/BMP4 preserve independent horizontal and vertical resolution; untagged inputs keep zero resolution. Use `bmpSubtype: "RGB565" | "RGB555"` for opaque 16-bit pixels or `"ARGB4444" | "ARGB1555"` for 16-bit pixels with alpha. These subtypes use channel masks in BMP3/BMP4 (BMP3 alpha subtypes use a 56-byte header). Set `bmpCompression: "rle"` for BI_RLE8 indexed BMP3/BMP4 output, or `"none"` for uncompressed indexed output.
`decodeTiffToStorage` reads classic TIFF and BigTIFF strips and tiles through caller backing,
including uncompressed, DEFLATE, LZW, PackBits, CCITT Group 3/4 and JPEG data and horizontal prediction. CCITT input supports Group 3 mixed rows, EOL fill bits, either bit order and independent strips; uncompressed fax extension mode is unsupported.
Shared JPEG tables and strip/tile data are read through bounded logical ranges. CIELab TIFF input converts signed color components to sRGB. Full-resolution YCbCr TIFF input with default BT.601 coefficients converts to RGB.
TIFF input reports the page count and accepts a zero-based `page` option, preserving each page’s dimensions and metadata. Palette TIFF input with 8-bit or 16-bit indices resolves the ColorMap to RGB.
TIFF input preserves alpha and additional sample planes as `metaChannels` (or `storedMetaChannels` with caller backing). Integer 16-bit TIFF input retains every sample bit when converted to PNG, including signed samples interpreted as unsigned bit patterns.
`encodeTiffFromStorage` and `encodeImage` accept `tiffPlanar: true` for separate channel planes (default: contiguous samples), except with JPEG compression. Each TIFF page includes a `PageNumber` tag with its zero-based index and the page count; `tiffScene` sets the starting index. They accept `tiffRowsPerStrip` to control TIFF strip height. Set `tiffFillOrder: "lsb"` for least-significant-bit-first storage (default: `"msb"`); this reverses encoded strip or tile bytes except for JPEG streams. Use `tiffTile: {width: 32, height: 16}` for tiled output; tile dimensions must be positive multiples of 16. `encodeTiffFromStorage` streams TIFF pixels with a header and strip directory
state, preserving resolution axes, units, and orientation. Untagged images omit resolution tags unless encoder `density` is supplied. Set `tiffFloatDepth: 16`, `32`, or `64` on encode options for normalized IEEE floating-point samples (incompatible with JPEG compression). Use `tiffIntegerDepth: 8`, `16`, or `32` for integer samples and `tiffSigned: true` for signed sample metadata; 8-bit input samples scale to the full output range. TIFF output supports `none` (default),
`lzw`, `deflate`, `packbits`, and `jpeg`: use `.tiff({compression: "lzw"})`
or `tiffCompression` on encode options. LZW and Deflate use horizontal prediction for 8- and 16-bit integer samples. Set `tiffPredictor: 1` (or `.tiff({predictor: "none"})`) to disable it, or `tiffPredictor: 2` (`predictor: "horizontal"`) to request it explicitly. Compressed file output uses caller-backed
scratch storage. Set `tiffAlpha` to `associated`, `unassociated` (default), or `unspecified` to select extra-sample metadata; associated output multiplies all samples by alpha to match ImageMagick. CMYK TIFF preserves stored ink samples as four separated channels, plus optional alpha, and can share a file with RGB pages. JPEG TIFF uses three color channels and discards alpha; CMYK with JPEG compression is unsupported.
`decodeHeifToStorage`, `encodeHeifFromStorage`, and `readHeifMetadataFromSource`
use 4 KiB pages and the shared zlib codec for the existing HEIC/HEIF/AVIF
container contract. File inputs, composite sources, metadata and outputs use the
caller's injected safe-fs. Format admission scans compatible brands in bounded
ranges, including brands beyond the initial header. Encoding makes a sizing pass over caller-backed pixels
before emitting the container, so neither compressed output nor box tables need
whole-file buffering. The synchronous byte APIs remain available for in-memory
callers; this does not add native HEVC or AV1 decoding.

`encodePngFromStorage(image, storage, signal)` produces bounded PNG chunks
under downstream backpressure. Pass `{ pngInterlace: true }` as the fourth argument
for Adam7 PNG output; `encodeImage` and `encodePngImage` accept the same option.
Opaque grayscale PNG output uses 1, 2, or 4 bits when its eight-bit samples fit exactly; explicit PNG depths and alpha output keep their requested layout.
The caller owns source and storage cleanup.
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
automatically. PDF file rendering uses caller-backed input, images and page tiles through `tryPdfDecode`; source and content numbers use bounded spelling scratch, including long leading zeros and exponents; ignored or rejected keywords also retain only bounded prefixes; the same path serves composite resources and transformed metadata. Inline and named PDF replacement text stays in that backing, including indirect property maps and string references. Optional-content layer lists and their membership indexes also use caller backing while preserving visibility policies and annotations. PDF paths, shading and nested captures still have the shared engine’s memory requirements.
Combined resize/blur/sharpen/convolution stages share premultiplied alpha and gamma handling.
`resizeStoredImage(image, storage, options, signal)` supports all resize fits,
gravity, entropy/attention crops, background canvases and image pages.
PNG/PPM/PGM/PBM/BMP/TIFF/GIF/MNG/JPEG/WebP/PDF `.toFile()`
conversions with these operations and `.resize()` use the backed codecs automatically when the
supplied filesystem supports retained reads, working storage, and atomic
streaming or retained staged publication. Explicit byte inputs, raw files/bytes and
previously cached files also use this retained output path; cached resource
snapshots remain valid. Symlink destinations stream through guarded retained staging when supported, preserving the link and target hardlink aliases and rejecting concurrent retargeting. Joined file, byte and generated inputs use caller backing for
file output, statistics and metadata, preserving alignment, spacing and animation layout. Generated text and color/noise images
use the same retained output path, and text metadata avoids rendering a pixel canvas.
MNG input reads full-canvas PNG frames, frame delays, terminal delay and loop counts, including page selection. Object operations and partial-frame MNG animations return an unsupported-format error.
These input formats also support
streaming TIFF, GIF, JPEG, WebP, PDF and raw output. PDF output streams compressed RGB and transparency from caller-backed pixels. `encodeRawFromStorage` preserves
raw channel/depth conversion and original high-depth samples in caller storage. `encodeGifFromStorage` uses a source-derived palette with a bounded 32K-bin color histogram, bounded
pixel caches and pull-driven owned data subblocks, including animated frames.
`decodeGifToStorage` retains LZW input, animation canvases and frame delays in caller
storage, including page selection, interlacing and disposal. Async GIF output reads
those retained delays without a frame-count-sized array. GIF encoding accepts `gifInterlace: true` for four-pass interlaced frames and
`transparentColor: { r, g, b }` to select the transparent palette color without changing opacity. Solid-color GIFs use their image color for exposed canvas when no background is specified; explicit and inherited backgrounds take precedence.
`decodeWebpToStorage` retains RIFF metadata, VP8L pixels, transforms and Huffman groups
in caller storage with fixed input and word caches.
Set `smartSubsample: true` (also available in `.webp()`) for sharp RGB-to-YUV conversion in lossy WebP; lossless output is unaffected. Set `webpExact: false` in WebP encoding options to discard hidden RGB at zero alpha; the library preserves it by default.
`encodeWebpFromStorage` scans alpha and emits owned lossless WebP chunks from caller storage. Set `lossless: false` with `quality` to encode lossy VP8 with exact alpha. Set `effort` from 0 to 6 (default 4), also available in `.webp()`, to trade encoding work for smaller VP8 output without changing decoded pixels. Lossy encoding buffers one RGBA frame and the encoded output in memory; storage transfers remain limited to 4 KiB. Buffered and storage-backed WebP output preserve the original ICC profile bytes, animation frames with `pageHeight`, millisecond delays and loop counts.
WebP input decodes lossy VP8, including VP8X/ALPH transparency, and lossless VP8L. Buffered and storage-backed readers retain embedded ICC profiles as `icc`, including on selected animation frames.
Lossy decoding uses in-memory encoded and pixel working buffers, including for file
inputs; storage transfers remain limited to 4 KiB. Invalid or unsupported WebP
image data is rejected instead of replaced with black pixels.
`encodeJpegFromStorage` emits bounded 8×8 blocks
from caller storage with the same quality, density and EXIF semantics as the
buffered encoder. JPEG output preserves source resolution or an explicit encoder `density`; untagged images use unitless 1×1 JFIF density. Set `jpegDctMethod` to `integer`, `float`, or `fastest` (default)
to select the forward discrete cosine transform. Set `jpegOptimizeCoding: true` to build smaller Huffman tables
from image frequencies without changing decoded pixels; this adds a bounded-memory
pass over the pixels. Set `jpegRestartInterval` to an MCU interval from 0 to 65535
(default 0, disabled) to emit restart markers. Set `jpegArithmeticCoding: true` for arithmetic entropy coding (SOF9, or SOF10 with progressive output), including restart markers. The arithmetic encoder is based in part on the work of the Independent JPEG Group (see [license](LICENSE.jpeg)). Arithmetic output requires an arithmetic-capable decoder; the built-in decoder currently reads Huffman JPEGs. Set `jpegProgressive: true` on encode options, or use
`.jpeg({ progressive: true })`, for progressive JPEG output. Grayscale images use one JPEG component and two progressive scans; color images use three components and four scans. The scans preserve
the baseline coefficients and decoded pixels; file output rereads bounded pixel
blocks instead of buffering the image coefficients. `decodeJpegToStorage` reads baseline and progressive JPEGs with
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
Netpbm and raw metadata without rendering pixels. GIF metadata exposes per-frame ICC profiles as `icc` and opaque application payloads in `gifApplications`, keyed by their 11-byte identifiers, and preserves them on GIF output. GIF metadata retains frame delays
in caller storage, available through `storedDelay.length` and asynchronous `storedDelay.at(index)`. The PNG, JPEG and WebP readers are
also available individually. CMYK JPEG decoding retains original ink samples in `hueSamples` (or `storedHueSamples` for caller-backed storage), alongside the RGBA display pixels. JPEG output with `space: "cmyk"` converts RGBA backing pixels into four Adobe CMYK components. JPEG and PNG rewrites retain EXIF profiles, including camera, author and date tags, while updating orientation and resolution. PNG metadata and decoded images expose an optional `backgroundColor` from the file's `bKGD` chunk as 8-bit RGBA. TIFF inspection uses the optional caller backing storage
to preserve full decode validation with bounded memory. File `.metadata()` for these formats
uses retained reads and caller-backed transforms, including source version checks
and handle cleanup. PDF metadata uses caller-backed input and indexes without rasterizing pages; `tryPdfMetadata` backs selected source resource values in supplied storage, or owns a four-page cache on the injected filesystem when storage is omitted. Backends with only retained staging and reads use immutable merged page runs, preserving their existing filesystem authority and bounded caches. PDF decoding uses its supplied pixel storage for these values; the same adapter serves Sips and identify queries. Raw metadata needs only the retained file size. These reads do
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

PHM output (`format: "phm"`) writes binary16 RGB or grayscale samples in bottom-to-top order, without alpha. It inherits the input byte order unless overridden with `endian: "lsb"` or `endian: "msb"`, defaulting to big-endian; little-endian output uses a negative scale in the header. PFM and PHM output preserve every supplied Netpbm page in order, with separate headers and rasters for each frame. PFM and PHM output serialize `properties.comment` as `#` header lines without altering the raster. Concatenated PFM and PHM input exposes the frame count in `metadata().pages`; use `{ page: index }` to read an individual frame, including frames with different dimensions. PHM input decodes portable half-float RGB (`PH`) and grayscale (`Ph`) maps, decoding 16-bit samples and displaying bottom-to-top stored rows in their original image order.

Read three-plane, 8-bit RGB PCX images, including RLE compression, padded scanlines, and independent horizontal and vertical DPI. Read RGB and RGBA QOI images with lossless 8-bit samples, including colors under fully transparent pixels. QOI input reads the first complete image and ignores bytes after its valid end marker. Read farbfeld images with lossless big-endian 16-bit RGBA samples, including hidden RGB under transparent pixels, through buffered and storage-backed inputs.
