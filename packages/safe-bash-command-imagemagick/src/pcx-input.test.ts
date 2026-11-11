import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "../../../tests/fixtures/media/pcx-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35: magick in.ppm -units PixelsPerInch -density 36x72 native.pcx
// P6 input: 3x2, maxval 255, followed by the RGB samples asserted below.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it(`reads native PCX pixels independently of PCX encoding (${mode})`, async () => {
    const input = Buffer.from(fixtures.rgb, "base64"), files = new Map<string, Uint8Array>([["/in.pcx", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pcx", input);
    const args = ["/in.pcx", "-depth", "8", "rgb:/out.raw"];
    if (mode === "command") {
      const arguments_ = createCommandArguments(args);
      let stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect({ ...result, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
    } else {
      expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe("ff000000ff000000ffffee00991177245384");
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it(`reports native PCX resolution (${mode})`, async () => {
    const input = Buffer.from(fixtures.rgb, "base64"), files = new Map<string, Uint8Array>([["/in.pcx", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pcx", input);
    const args = ["/in.pcx", "-format", "%x %y %U", "info:"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
      .toEqual({ exitCode: 0, stdout: "36 72 PixelsPerInch", stderr: "" });
  });
}
