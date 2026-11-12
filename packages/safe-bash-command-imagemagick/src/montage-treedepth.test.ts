import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Complete RGB8 rasters from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { options: ["-treedepth", "2", "-colors", "12"], colors: 12, hash: "8e9eb505df6cc2b556387a336acfde3c6c8844da4031b17ab9b31ea7bfd1f915" },
    { options: ["-treedepth", "8", "-colors", "12"], colors: 12, hash: "8e9eb505df6cc2b556387a336acfde3c6c8844da4031b17ab9b31ea7bfd1f915" },
    { options: ["-treedepth", "2"], colors: 512, hash: "2ccee45765af113e5bc0e0853166cc3f190c87c23fc4b67ad3eafa45c644280d" },
    { options: [], colors: 512, hash: "2ccee45765af113e5bc0e0853166cc3f190c87c23fc4b67ad3eafa45c644280d" },
  ])(`${mode}: matches native montage pixels for $options`, async ({ options, colors, hash }) => {
    const pixels = Uint8Array.from({ length: 32 * 16 * 3 }, (_, index) => {
      const x = Math.floor(index / 3) % 32, y = Math.floor(index / 96);
      return [(x * 17) % 256, (x * 11 + y * 43) % 256, (255 - x * 13) % 256][index % 3]!;
    });
    const source = Buffer.concat([Buffer.from("P6\n32 16\n255\n"), pixels]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", source);
    const args = ["/in.ppm", ...options, "-tile", "1x1", "-geometry", "+0+0", "-depth", "8", "rgb:-"];
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      output = Buffer.concat(chunks);
    } else {
      const files = new Map([["/in.ppm", source]]);
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(output).toHaveLength(1536);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    expect(new Set(Array.from({ length: 512 }, (_, index) => output.slice(index * 3, index * 3 + 3).join(","))).size).toBe(colors);
  });
}
