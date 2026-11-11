import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const destination of ["-", "/result.miff"])
for (const tile of ["2x1", "1x1"])
it.each([
  { options: [], depth: 16 },
  { options: ["-depth", "16"], depth: 16 },
  { options: ["-depth", "8"], depth: 8 },
  { options: ["-depth", "8", "+depth"], depth: 16 }
])(`${mode} ${destination} ${tile}: preserves MIFF depth $options`, async ({ options, depth }) => {
  const files = new Map([
    ["/a.ppm", new TextEncoder().encode("P3\n2 1\n255\n255 0 0 255 0 0\n")],
    ["/b.ppm", new TextEncoder().encode("P3\n1 2\n255\n0 0 255 0 0 255\n")]
  ]);
  const fs = new MemoryFileSystem();
  for (const [name, bytes] of files) await fs.writeFile(name, bytes);
  const args = ["montage", "/a.ppm", "/b.ppm", ...options, "-mode", "Concatenate", "-tile", tile, "-adjoin", `miff:${destination}`];
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  }) : mode === "sync" ? runMagickCliSync(args, files)
    : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
  expect(result.exitCode).toBe(0);
  expect("stderr" in result ? result.stderr : stderr).toBe("");
  const bytes = destination === "-"
    ? mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
    : mode === "command" || mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
  const headers = new TextDecoder().decode(bytes).split("id=ImageMagick").slice(1);
  expect(headers).toHaveLength(tile === "2x1" ? 1 : 2);
  for (const page of headers) expect(page.slice(0, page.indexOf(":\x1a"))).toContain(`depth=${depth}\n`);
  if (tile === "2x1") {
    const image = decodeImage(bytes);
    expect(image).toMatchObject({ width: 3, height: 2 });
    expect(Buffer.from(image.data).toString("hex")).toBe("ff0000ffff0000ff0000ffffffffffffffffffff0000ffff");
  }
});
