import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixture from "../../../tests/fixtures/media/sixel-fixture.json" with { type: "json" };

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it(`decodes a native SIXEL graphic and reports its raster (${mode})`, async () => {
    const bytes = new TextEncoder().encode(fixture.sixel);
    const files = new Map<string, Uint8Array>([["/native.sixel", bytes]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/native.sixel", bytes);
    const args = ["/native.sixel", "-depth", "8", "-write", "rgb:/out.raw", "-format", "%wx%h:%k", "info:"];
    if (mode === "command") {
      const arguments_ = createCommandArguments(args);
      let stdout = "", stderr = "";
      const result = await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect({ ...result, stdout, stderr }).toMatchObject({ exitCode: 0, stdout: "256x128:227", stderr: "" });
    } else {
      expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "256x128:227", stderr: "" });
    }
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
    expect(createHash("sha256").update(output).digest("hex")).toBe(fixture.rgbSha256);
  });
}
