import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const tile = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n");
const solid = new TextEncoder().encode("P3\n2 1\n255\n64 96 128  64 96 128\n");

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  it(`${mode}: rejects undefined FX identifiers while preserving surrounding format text`, async () => {
    const placed = encodeImage({ ...decodeImage(tile), resolution: { x: 100, y: 200, unit: "inch" }, virtualCanvas: { width: 9, height: 7, x: 2, y: 1 } }, { format: "png" }).data;
    const solidPng = encodeImage(decodeImage(solid), { format: "png" }).data;
    for (const [filename, bytes] of [["/tile.ppm", tile], ["/solid.png", solidPng], ["/placed.png", placed]] as const) {
      const fs = new MemoryFileSystem(), files = new Map([[filename, bytes]]);
      await fs.writeFile(filename, bytes);
      for (const [expression, identifier] of [["no_such_variable", "no_such_variable"], ["entropy", "entropy"], ["missing.w", "missing"], ["1 ? 2 : missing", "missing"], ["constructor", "constructor"], ["__proto__", "__proto__"]] as const) {
        const args = ["identify", "-format", `A%[fx:${expression}]Z`, filename];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = "stdout" in result && "stderr" in result ? result : { ...result, stdout, stderr };
        expect(output.exitCode, expression).toBe(1);
        expect(output.stdout, expression).toBe("AZ");
        expect(output.stderr, expression).toContain(identifier);
      }
    }
  });
}

it.each([false, true])("rejects invalid conversion FX without replacing output, retained=%s", async retained => {
  const fs = new MemoryFileSystem(), files = new Map([["/tile.ppm", tile], ["/out.png", tile]]);
  await fs.writeFile("/tile.ppm", tile);
  await fs.writeFile("/out.png", tile);
  const input = retained ? { filesystem: fs, cwd: "/" } : files;
  for (const expression of ["no_such_variable", "entropy"]) {
    const result = await runMagickCli(["/tile.ppm", "-fx", expression, "/out.png"], input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(expression);
    expect(retained ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(tile);
    const formatted = await runMagickCli(["/tile.ppm", "-format", `A%[fx:${expression}]Z`, "info:"], input);
    expect(formatted).toMatchObject({ exitCode: 1, stdout: "AZ" });
    expect(formatted.stderr).toContain(expression);
  }
  expect(await runMagickCli(["identify", "-format", "%[fx:value=value+1;value]|%[fx:value=2;value=value+1;value]|%[fx:entropy=4;entropy]|%[entropy]|%[fx:r]|%[fx:u.r]|%[fx:p{1,0}.g]", "/tile.ppm"], input))
    .toEqual({ exitCode: 0, stdout: "1|3|4|0.92062|1|1|1", stderr: "" });
  const separate = await runMagickCli(["identify", "-format", "%[fx:value=2]A%[fx:value]Z", "/tile.ppm"], input);
  expect(separate).toMatchObject({ exitCode: 1, stdout: "2AZ" });
});
