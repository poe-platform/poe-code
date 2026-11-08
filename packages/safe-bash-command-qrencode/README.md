# QR codes in your virtual filesystem

Generate QR codes from text, binary streams, or virtual files without a native
executable or network access. Use `qrencodeCommands()` from
`@poe-platform/safe-bash/commands/qrencode`, or select `qrencode` through
`optionalCommands({ commands: ["qrencode"] })`.

```ts
import { Shell, createMemoryFileSystem, standardCommands, qrencodeCommands } from "@poe-platform/safe-bash";

const fs = createMemoryFileSystem();
const shell = new Shell({ fs }).use(standardCommands()).use(qrencodeCommands());
await shell.exec("printf 'https://example.org' | qrencode -o /link.png");
const png = await fs.readFile("/link.png");
await shell.dispose();
```

| Task | Command |
| --- | --- |
| PNG image | `qrencode -s 6 -d 144 -o /code.png 'Hello'` |
| Transparent PNG | `qrencode -t PNG32 --background=FFFFFF00 -o /code.png 'Hello'` |
| SVG or EPS | `qrencode -t SVG -o /code.svg 'Hello'` |
| Terminal display | `qrencode -t UTF8 'Hello'` |
| File input | `qrencode -8 -r /payload.bin -o /code.png` |
| Micro QR | `qrencode --micro -t ASCII 12345` |
| Structured append | `qrencode -S -v 2 -r /message -o /part.png` |

Formats: `PNG`, `PNG32`, `SVG`, `EPS`, `ASCII`, `ASCIIi`, `UTF8`, `UTF8i`,
`ANSI`, `ANSI256`, and `ANSIUTF8`. `-o -` writes bytes to stdout for pipelines
or redirection. Without `-o`, output also goes to stdout. Terminal formats use
one character pair or half-block per module; `-s` scales raster and vector output.

QR versions 1–40 support error correction `-l L|M|Q|H`, with `-v` selecting
the minimum version (`0` or `auto` chooses automatically). `--strict-version`
prevents growth. Micro QR versions 1–4 support their standard subset of levels
and modes; level H and structured append are unavailable for Micro QR.

Numeric and alphanumeric segments are selected automatically. Text uses UTF-8
bytes; `-8` preserves all input bytes in Byte mode, and `-k` interprets eligible
Shift-JIS pairs in Kanji mode. `-i` folds ASCII lowercase to uppercase unless
`-8` is selected. Structured append requires `-v` and a filename, creates up to
16 numbered files (`part-01.png`, …), and preserves parity and sequence headers.

Use `-m` for the quiet zone (default 4 modules; Micro QR 2), `-s` for module
size (default 3), `-d` for PNG DPI (default 72), and `--foreground` /
`--background` for six- or eight-digit hexadecimal colors. SVG and PNG retain
alpha; EPS uses RGB. PNG uses the shared `@poe-code/image-ast` encoder.

Factories `createQrencodeCommand` and `createQrencodeCommands` accept the same
options as the plugin. `QrencodeCommandsOptions.limits` configures positive
integer `maxInputBytes` (default 113,424), `maxOutputBytes` (16 MiB), and
`maxMemoryBytes` (64 MiB). QR capacity imposes an additional per-symbol limit.
Limits account for input, encoding workspace, and output staging; output files
also participate in Shell output budgets. Input collection and segmentation
observe cancellation. The memory limit is an allocation admission estimate,
not a process RSS limit.

This is a private workspace exposed through safe-bash; it is not installed as a
separate npm package.
