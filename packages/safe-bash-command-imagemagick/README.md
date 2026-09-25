# `safe-bash-command-imagemagick`

ImageMagick (`magick`, `convert`, `mogrify`, `composite`, `montage`, `identify`) command-line tools for `safe-bash`, powered by `@poe-code/image-ast`.

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
| `magick` / `convert` | Left-to-right image stack pipeline supporting `xc:`/`canvas:`/`label:` generators, `-resize` (`!`, `>`, `<`, `^`, `%`, `@`), `-crop`, `-extent`, `-border`, `-shave`, `-trim`, `-rotate`, `-flip`, `-flop`, `-auto-orient`, `-negate`, `-grayscale`, `-colorspace`, `-modulate`, `-gamma`, `-level`, `-normalize`, `-threshold`, `-tint`, `-colorize`, `-blur`, `-sharpen`, `-median`, `-draw`, `-annotate`, `( ... )` substacks, `-clone`, `-swap`, `-delete`, `-composite`, `-flatten`, `-append`, `+append`, and stdin/stdout pipes (`-`, `png:-`). |
| `mogrify` | In-place batch transformation (`-resize`, `-quality`, `-strip`, `-rotate`, etc.) or format/directory conversion via `-format` and `-path`. |
| `composite` | Overlay composition with `-gravity`, `-geometry WxH+X+Y`, `-compose`, and `-dissolve` / `-blend`. |
| `montage` | Contact-sheet grid generation with `-tile MxN`, `-geometry WxH+X+Y`, `-background`, and `-border` / `-bordercolor`. |
| `identify` | Image metadata and statistics inspection (`-ping`, `-format`, `-verbose`). |
