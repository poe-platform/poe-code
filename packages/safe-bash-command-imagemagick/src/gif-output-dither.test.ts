import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  for (const animated of [false, true]) {
    for (const split of [false, true]) {
      it.each([undefined, "Riemersma", "FloydSteinberg", "None", "+dither"])(
        `writes the selected GIF dithering method ${mode}, split=${split}, animated=${animated} (%s)`,
        async (method) => {
          const pixels = Uint8Array.from([40, 41, 42, 43, 44, 45].flatMap((v) => [v, v, v, 255]));
          const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 4 } })
            .png({ palette: false })
            .toBuffer();
          const files = new Map([["/in.png", input]]),
            filesystem = new MemoryFileSystem();
          await filesystem.writeFile("/in.png", input);
          const copy = split ? "/copy-%d.gif" : "/copy.gif",
            out = split ? "/out-%d.gif" : "/out.gif";
          const args = [
            "/in.png",
            ...(animated ? ["/in.png"] : []),
            "-repage",
            "12x9+4+3",
            ...(method === "+dither" ? [method] : method ? ["-dither", method] : []),
            "-write",
            copy,
            out
          ];
          const result =
            mode === "command"
              ? await createMagickCommand().execute({
                  command: "magick",
                  args: createCommandArguments(args).args,
                  cwd: "/",
                  env: {},
                  fs: filesystem,
                  stdin: (async function* () {})(),
                  signal: new AbortController().signal,
                  stdout: { async write() {} },
                  stderr: { async write() {} }
                })
              : mode === "sync"
                ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
          expect(result.exitCode).toBe(0);
          for (const path of split
            ? ["/copy-0.gif", "/out-0.gif", ...(animated ? ["/copy-1.gif", "/out-1.gif"] : [])]
            : [copy, out]) {
            const output =
              mode === "retained" || mode === "command"
                ? await filesystem.readFile(path)
                : files.get(path)!;
            for (let page = 0; page < (animated && !split ? 2 : 1); page++) {
              const image = decodeImage(output, { page, coalesce: false });
              const expected =
                method === "None" || method === "+dither"
                  ? [40, 41, 42, 43, 44, 45]
                  : method === "FloydSteinberg"
                    ? [40, 40, 40, 40, 45, 45]
                    : [40, 40, 40, 40, 44, 44];
              expect(Array.from(image.data).filter((_, i) => i % 4 === 0)).toEqual(expected);
              expect(image.virtualCanvas).toEqual({ width: 12, height: 9, x: 4, y: 3 });
            }
          }
        }
      );
    }
  }
}

it.each([false, true])(
  "captures dithering at each write without changing input pixels (retained=%s)",
  async (retained) => {
    const pixels = Uint8Array.from([40, 41, 42, 43, 44, 45].flatMap((v) => [v, v, v, 255]));
    const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 4 } })
      .png({ palette: false })
      .toBuffer();
    const files = new Map([["/in.png", input]]),
      filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const result = await runMagickCli(
      [
        "/in.png",
        "-write",
        "/riemersma.gif",
        "-dither",
        "FloydSteinberg",
        "-write",
        "/floyd.gif",
        "+dither",
        "/none.gif"
      ],
      retained ? { filesystem, cwd: "/" } : files
    );
    expect(result.exitCode).toBe(0);
    for (const [path, expected] of [
      ["/riemersma.gif", [40, 40, 40, 40, 44, 44]],
      ["/floyd.gif", [40, 40, 40, 40, 45, 45]],
      ["/none.gif", [40, 41, 42, 43, 44, 45]]
    ] as const) {
      const output = retained ? await filesystem.readFile(path) : files.get(path)!;
      expect(Array.from(decodeImage(output).data).filter((_, i) => i % 4 === 0)).toEqual(expected);
    }
  }
);
