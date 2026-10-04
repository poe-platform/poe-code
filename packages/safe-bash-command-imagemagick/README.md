# `safe-bash-command-imagemagick`

ImageMagick (`magick`, `convert`, `mogrify`, `composite`, `montage`, `compare`, `identify`) command-line tools for `safe-bash`, powered by `@poe-code/image-ast`.

## Quickstart

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { imagemagickCommands } from "@poe-platform/safe-bash/commands/imagemagick";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(imagemagickCommands());

await shell.exec("magick -size 120x80 xc:#3b82f6 -resize 50% /banner.png");
const info = await shell.exec("magick identify -format '%m %wx%h' /banner.png");
console.log(info.stdout); // PNG 60x40
```

Output parent directories must already exist, including directories selected with `mogrify -path`.

Async `runIdentifyCli(args, { filesystem, cwd, stdin, stdout, stderr })` uses the supplied filesystem for retained input and scratch storage. Ordinary raster metadata and verbose statistics use bounded reads and caller-backed pixels; streamed stdin is retained once for repeated `-` operands. Optional output sinks receive bounded UTF-8 chunks as each input finishes and apply backpressure before the next input is read. Without sinks, the SDK returns the collected output strings. Custom metadata, statistical properties and pixel expressions share retained inspection; expressions read only the samples they reference. Async `runCompareCli(args, { filesystem, cwd, stdin, stdout })` also retains raster inputs and diff pixels in caller backing, streams encoded stdout to the optional sink, and safely publishes diff files. PDF raster input is passed to the shared file adapter with the same filesystem and pixel storage. Generated labels and captions use the same caller-backed SVG renderer; gradients, checkerboards and tiled patterns generate bounded pixel chunks directly into caller backing. Tiled conversion preserves final-frame selection and reads patterns through a bounded row cache. Async `runConvertCli`, `runMogrifyCli`, `runCompositeCli`, `runMontageCli` and `runMagickCli` accept the same filesystem input with optional stdout/stderr sinks. Conversion retains resize, flip/flop, orientation, rotation, gamma, grayscale, blur/sharpen, crop, extent, shave, trim, median, splice, chop, roll, border/frame and pointwise color operations (including negation, contrast, levels, modulation, thresholding, tint, alpha modes, color matrices, opacity, evaluate and function) in caller backing, preserving frame selection and guarded output publication. Intermediate writes retain encoded snapshots for later reads and defer publication until the pipeline finishes, preserving overwritten targets and cancellation. Remapping retains its bounded palette and Float32 error-diffusion state through caller-backed caches, preserving dithering and alpha. Flood fill keeps traversal and visited state in caller backing behind a fixed page cache. Drawing retains direct shapes and SVG overlays in caller backing and blends bounded pixel chunks. Text annotation rasterizes glyphs into bounded pixel chunks, preserving density, gravity, offsets and alpha blending. Multi-image `-fx` expressions read demanded samples through bounded caller-backed caches and write pixel chunks, preserving channel masks and local assignments. Shadow and vignette effects stream bounded source/output spans, with shadow blur retaining its intermediate canvas in caller backing. Shear, swirl, implode, wave and distortion share bilinear sampling through bounded caller-backed caches. Morphology and neighborhood statistics use sliding four-channel histograms and bounded source caches, including rectangular median windows and compound filters. Convolution, edge/emboss and charcoal/sketch filters share bounded RGB row-span processing with unchanged alpha. Normalization, equalization, auto-level and auto-gamma collect fixed-size channel histograms before applying bounded pixel lookups. Mogrify batches reuse the same conversion path for each target, including in-place writes and format/directory outputs, with cumulative input accounting. Frame selection, nested stacks, cloning, duplication, reordering, append, flatten and composite keep pixels and frame metadata in caller storage. Animated GIFs and numbered scenes use bounded encoding and deferred publication. Text, info and histogram output stream to optional sinks, and text files use guarded publication; histogram counts stay in caller backing. Composite SDK and command entry points share this retained conversion path, including blend modes, placement and cumulative input limits. Montage snapshots inputs once in caller storage and renders selected frames, resized thumbnails, borders and contact sheets through bounded pixel spans and metadata caches. Color lookup, channel separation/combination, frame interpolation and sequence evaluation also use caller-backed stacks and bounded pixel kernels. Median evaluation preserves stable frame order using fixed-size radix histograms. Transpose/transverse, raised borders and layer aliases use the same retained path; query and missing-input diagnostics use bounded admission probes. Unknown image formats are discarded in bounded chunks before reporting the existing diagnostic, preserving read failures and cancellation. Filesystems without the required retained capabilities currently use buffered compatibility paths.

`identify -format` and `magick ... -format FORMAT info:` support literal `%%`,
geometry (`%g`, `%P`), compression (`%C`, `%Q`), and named properties including
`%[channels]`, `%[width]`, `%[height]`, `%[depth]`, `%[bit-depth]`, `%[opaque]`,
`%[type]`, `%[size]`, and `%[standard-deviation]`. Use `%[hex:p{0,0}]` for an
uppercase RGB or RGBA hex value, or `%[fx:EXPRESSION]` and `%[pixel:EXPRESSION]`
for calculated values. Named properties are case insensitive. Filenames and
escaped percent signs are inserted literally; pixel statistics are calculated
only when requested. Statistics use the command's 0–255 RGB sample scale.

## Available Commands

| Command | Highlights |
| --- | --- |
| `magick` / `convert` | Left-to-right image stack pipeline supporting `xc:`/`canvas:`/`gradient:`/`radial-gradient:`/`pattern:checkerboard`/`label:`/`tile:filename` generators, `-resize` (`!`, `>`, `<`, `^`, `%`, `@`), `-crop`, `-extent`, `-border`, `-shave`, `-splice`, `-chop`, `-roll`, `-trim`, `-rotate`, `-flip`, `-flop`, `-auto-orient`, `-shear`, `-distort` (`SRT`, `Perspective`, `Affine`, `Barrel`), `-swirl`, `-implode`, `-wave`, `-shadow`, `-vignette`, `-negate`, `-grayscale`, `-colorspace`, `-sepia-tone`, `-solarize`, `-posterize`, `-colors`, `-modulate`, `-gamma`, `-level`, `-normalize`, `-threshold`, `-tint`, `-colorize`, `-opaque`/`+opaque`, `-transparent`/`+transparent`, `-evaluate`, `-function`, `-clut`, `-fx`, `-blur`, `-sharpen`, `-median`, `-edge`, `-emboss`, `-charcoal`, `-draw` (`rectangle`, `roundRectangle`, `circle`, `ellipse`, `line`, `point`, `polygon`, `polyline`, `bezier`, `path`, `text`), `-annotate`, `( ... )` substacks, `-clone`, `-swap`, `-delete`, `-morph`, `-composite`, `-flatten`, `-append`, `+append`, `[0-2]` scene selectors, `out-%d.png` multi-frame output, and stdin/stdout pipes (`-`, `png:-`). |
| `mogrify` | In-place batch transformation (`-resize`, `-quality`, `-strip`, `-rotate`, etc.) or format/directory conversion via `-format` and `-path`; read settings such as `-density` apply before decoding. |
| `composite` | Overlay composition with `-gravity`, `-geometry WxH+X+Y`, `-compose`, and `-dissolve` / `-blend`. |
| `montage` | Contact-sheet grid generation with `-tile MxN`, `-geometry WxH+X+Y`, `-background`, and `-border` / `-bordercolor`. |
| `compare` | Perceptual and pixel diffing (`-metric AE\|MAE\|MSE\|RMSE\|PAE\|PSNR\|SSIM\|DSSIM\|NCC`), `-fuzz` tolerance, `-highlight-color`, `-lowlight-color`, and visual diff output. Metrics go to stderr; identical images return 0 and differing images return 1 (with `-fuzz` tolerance or an explicit `-dissimilarity-threshold`). |
| `identify` | Image metadata and statistics inspection (`-ping`, `-format`, `-verbose`). |

The workspace entrypoint exports `imagemagickCommands()` for plugin registration,
`createImagemagickCommands()` for the command collection, and
`createImagemagickCommand()` for a single command. Each accepts an optional
`ImagemagickCommandsOptions` object; existing factory names remain available.
`createImagemagickCommand` is the `createMagickCommand` factory; the collection
includes all seven tools registered by the ImageMagick plugin.

Configure `limits: { maxInputBytes: 16 * 1024 * 1024 }` to bound cumulative file and stdin input. Caller-provided input budgets also receive cumulative read totals; output is accounted separately. `ImagemagickLimits` is exported for typed configuration; omitted limits default to `Infinity`. Long-running command loops and image generation and pixel transforms yield to timers and cancellation, including Workers with frozen clocks.
