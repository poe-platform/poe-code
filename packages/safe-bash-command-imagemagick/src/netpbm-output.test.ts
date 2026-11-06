import {spawnSync} from "node:child_process";
import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createMagickCommand} from "./index.js";

it.each(["ppm", "pgm"])("preserves 16-bit PNG precision when writing %s", async format => {
  const raw = Buffer.from(format === "ppm" ? "1234456789abcdef13792468" : "123412341234cdefcdefcdef", "hex");
  const png = spawnSync("magick", ["-size", "2x1", "-depth", "16", "-endian", "MSB", "rgb:-", "PNG48:-"], {input: raw});
  expect(png.status).toBe(0);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.png", png.stdout);
  const args = createCommandArguments(["in.png", `out.${format}`]);
  let stderr = "";
  const result = await createMagickCommand().execute({command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  expect(stderr).toBe("");
  expect(result.exitCode).toBe(0);
  const output = Buffer.from(await fs.readFile(`/out.${format}`));
  expect(output).toEqual(Buffer.concat([Buffer.from(`${format === "ppm" ? "P6" : "P5"}\n2 1\n65535\n`), format === "ppm" ? raw : Buffer.from("1234cdef", "hex")]));
  const decoded = spawnSync("magick", [`${format}:-`, "-depth", "16", "-endian", "MSB", "rgb:-"], {input: output});
  expect(decoded.status).toBe(0);
  expect(decoded.stdout).toEqual(raw);
});
