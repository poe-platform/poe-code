import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const directory of ["", "album.v1/"])
it.each([
  { output: ".sheet", columns: 1, names: ["-0", "-1"] },
  { output: "sheet.", columns: 1, names: ["sheet-0", "sheet-1"] },
  { output: ".hidden.png", columns: 1, names: [".hidden-0.png", ".hidden-1.png"] },
  { output: "page-%02d.png", columns: 1, names: ["page-00.png", "page-01.png"] },
  { output: "sheet", columns: 1, names: ["sheet-0", "sheet-1"] },
  { output: ".sheet", columns: 2, names: [".sheet"] },
  { output: "sheet.", columns: 2, names: ["sheet."] },
])(`matches native montage page filenames via ${mode} in '${directory}': $output, $columns columns`, async ({ output, columns, names }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  if (directory) await fs.mkdir(`/${directory}`);
  const args = ["xc:red", "xc:blue", "-tile", `${columns}x1`, "-geometry", "+0+0", `${output.endsWith(".png") ? "" : "PNG:"}${directory}${output}`];
  if (mode === "magick" || mode === "montage") {
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    let stderr = "";
    const context: CommandContext = {
      command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(chunk) { stderr += chunk; } }, registerCleanup() {}
    };
    expect(await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute(context)).toEqual({ exitCode: 0 });
    expect(stderr).toBe("");
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  }
  const buffered = mode === "buffered" || mode === "sync";
  const actualNames = buffered ? [...files.keys()]
    : (await fs.readdir(`/${directory}`)).map(entry => `${directory}${entry.name}`);
  expect(actualNames.sort()).toEqual(names.map(name => `${directory}${name}`).sort());
  for (const [page, name] of names.entries()) {
    const bytes = buffered ? files.get(`${directory}${name}`)! : await fs.readFile(`/${directory}${name}`);
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const image = decodeImage(bytes);
    expect([image.width, image.height]).toEqual([columns, 1]);
    // Native ImageMagick 7.1.2-35 Q16-HDRI: red then blue, with unchanged single-page pixels.
    expect(Buffer.from(image.data).toString("hex")).toBe(columns === 2 ? "ff0000ff0000ffff" : page === 0 ? "ff0000ff" : "0000ffff");
  }
});
