import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const tile = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n");

it.each(["sync", "map", "filesystem", "command"])("expands nested properties before formatted FX arithmetic through %s", async route => {
  for (const mode of ["identify", "info"]) {
    for (const [format, expected] of [
      ["%[fx:w*h]", "6"],
      ["%[fx:%[width]*2]", "6"],
      ["%[fx:%[WIDTH]*%[height]]", "6"],
      ["%[fx:%[fx:%[width]+1]*%[height]]", "8"],
      ["%[fx:u[0].w+%[height]]", "5"],
      ["%[fx:%[width]%2]", "1"],
      ["%[fx:%[max]/65535]", "1"],
      ["%[hex:p{%[width]-1,0}]|%[pixel:p{0,%[height]-1}]", "0000FF|srgb(0,0,0)"],
      ["%%[fx:%[width]*2]|%[fx:%[height]*2]", "%[fx:3*2]|4"]
    ] as const) {
      const args = mode === "identify"
        ? ["identify", "-format", format, "/tile.ppm"]
        : ["/tile.ppm", "-format", format, "info:"];
      const files = new Map([["/tile.ppm", tile]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/tile.ppm", tile);
      let result;
      if (route === "sync") result = runMagickCliSync(args, files);
      else if (route === "map") result = await runMagickCli(args, files);
      else if (route === "filesystem") result = await runMagickCli(args, { filesystem: fs, cwd: "/" });
      else {
        const command = createMagickCommand();
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const execution = await command.execute({
          command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...execution, stdout, stderr };
      }
      expect(result, `${mode}: ${format}`).toMatchObject({
        exitCode: 0, stdout: expected, stderr: ""
      });
    }
  }
});

it.each(["%[fx:%[width]*2", "%[fx:%[]*2]"])("rejects malformed nested properties without partial output: %s", async format => {
  const result = await runMagickCli(["identify", "-format", `prefix${format}`, "/tile.ppm"], new Map([["/tile.ppm", tile]]));
  expect(result).toMatchObject({ exitCode: 1, stdout: "" });
  expect(result.stderr).toContain(format.includes("%[]") ? "unknown image property '%[]'" : "unbalanced braces");
});
