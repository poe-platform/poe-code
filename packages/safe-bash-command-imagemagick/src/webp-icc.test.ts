import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import fixtures from "../../../tests/fixtures/media/webp-icc.json" with { type: "json" };
import { runConvertCli, runIdentifyCli } from "./index.js";

// Independently encoded by ImageMagick/libwebp; PNG is the preservation control.
for (const kind of ["lossless", "lossy", "png"] as const) {
  for (const mode of ["buffered", "retained"] as const) {
    it.each([[], ["-strip"], ["+profile", "icc"], ["+profile", "*"]])(
      `preserves or removes ICC from ${kind} input, ${mode}: %j`, async (...options) => {
        const input = new Uint8Array(Buffer.from(fixtures[kind], "base64"));
        const files = new Map([["/input", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        const context = mode === "buffered" ? files : { filesystem: fs, cwd: "/" };
        expect(await runIdentifyCli(["-format", "%[profiles]", "/input"], context))
          .toEqual({ exitCode: 0, stdout: "icc", stderr: "" });
        expect(await runConvertCli(["/input", ...options, "/output.png"], context))
          .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
        const native = spawnSync("magick", ["identify", "-quiet", "-format", "%[profiles]", "-"], { input: output, encoding: "utf8" });
        expect(native.status, native.stderr).toBe(0);
        expect(native.stdout).toBe(options.length ? "" : "icc");
        if (!options.length) {
          const recovered = spawnSync("magick", ["-", "icc:-"], { input: output });
          expect(recovered.status, recovered.stderr.toString()).toBe(0);
          expect(recovered.stdout).toEqual(Buffer.from(fixtures.icc, "base64"));
        }
      }
    );
  }
}
