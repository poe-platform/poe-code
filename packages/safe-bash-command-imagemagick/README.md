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

## Available Commands

| Command | Highlights |
| --- | --- |
| `magick` / `convert` | Left-to-right image stack pipeline supporting `xc:`/`canvas:`/`gradient:`/`radial-gradient:`/`pattern:checkerboard`/`label:` generators, `-resize` (`!`, `>`, `<`, `^`, `%`, `@`), `-crop`, `-extent`, `-border`, `-shave`, `-splice`, `-chop`, `-roll`, `-trim`, `-rotate`, `-flip`, `-flop`, `-auto-orient`, `-shear`, `-distort` (`SRT`, `Perspective`, `Affine`, `Barrel`), `-swirl`, `-implode`, `-wave`, `-shadow`, `-vignette`, `-negate`, `-grayscale`, `-colorspace`, `-sepia-tone`, `-solarize`, `-posterize`, `-colors`, `-modulate`, `-gamma`, `-level`, `-normalize`, `-threshold`, `-tint`, `-colorize`, `-opaque`/`+opaque`, `-transparent`/`+transparent`, `-evaluate`, `-function`, `-clut`, `-fx`, `-blur`, `-sharpen`, `-median`, `-edge`, `-emboss`, `-charcoal`, `-draw` (`rectangle`, `roundRectangle`, `circle`, `ellipse`, `line`, `point`, `polygon`, `polyline`, `bezier`, `path`, `text`), `-annotate`, `( ... )` substacks, `-clone`, `-swap`, `-delete`, `-morph`, `-composite`, `-flatten`, `-append`, `+append`, `[0-2]` scene selectors, `out-%d.png` multi-frame output, and stdin/stdout pipes (`-`, `png:-`). |
| `mogrify` | In-place batch transformation (`-resize`, `-quality`, `-strip`, `-rotate`, etc.) or format/directory conversion via `-format` and `-path`. |
| `composite` | Overlay composition with `-gravity`, `-geometry WxH+X+Y`, `-compose`, and `-dissolve` / `-blend`. |
| `montage` | Contact-sheet grid generation with `-tile MxN`, `-geometry WxH+X+Y`, `-background`, and `-border` / `-bordercolor`. |
| `compare` | Perceptual and pixel diffing (`-metric AE\|MAE\|MSE\|RMSE\|PAE\|PSNR\|SSIM\|DSSIM\|NCC`), `-fuzz` tolerance, `-highlight-color`, `-lowlight-color`, and visual diff output. |
| `identify` | Image metadata and statistics inspection (`-ping`, `-format`, `-verbose`). |
