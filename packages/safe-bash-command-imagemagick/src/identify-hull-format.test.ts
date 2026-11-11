import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const route of ["sync", "buffered", "retained", "identify", "magick"]) {
  it.each([false, true])(`expands hull coordinates with native ordering and trailing spaces (${route}, solid=%s)`, async solid => {
    const bytes = solid
      ? await sharp({ create: { width: 2, height: 1, channels: 3, background: "#406080" } }).png().toBuffer()
      : Buffer.from("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n");
    const path = solid ? "/solid.png" : "/tile.ppm";
    const files = new Map([[path, bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const args = ["-format", "%[convex-hull]|%[minimum-bounding-box]", path];
    let result;
    if (route === "sync") result = runIdentifyCliSync(args, files);
    else if (route === "buffered" || route === "retained") result = await runIdentifyCli(args, route === "buffered" ? files : { filesystem: fs, cwd: "/" });
    else {
      const command = route === "magick" ? createMagickCommand() : createIdentifyCommand();
      const argumentValues = createCommandArguments([...(route === "magick" ? ["identify"] : []), ...args]);
      let stdout = "", stderr = "";
      const status = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      result = { ...status, stdout, stderr };
    }
    expect(result).toEqual({
      exitCode: 0,
      stdout: solid ? "|" : "1,0 2,0 2,1 0,1 1,0 |2,0 2,1 0,1 0,0 ",
      stderr: solid ? "identify: unknown image property '%[convex-hull]'\nidentify: unknown image property '%[minimum-bounding-box]'\n" : ""
    });
  });
}

it("formats a rotated 16-bit hull with ping, case-insensitive names, and repeated properties", async () => {
  const samples = Array.from({ length: 25 }, (_, i) => Math.abs(i % 5 - 2) + Math.abs(Math.floor(i / 5) - 2) <= 2 ? 1 : 0);
  const bytes = Buffer.from(`P2\n5 5\n65535\n${samples.join(" ")}\n`);
  const args = ["-ping", "-format", "%[MINIMUM-BOUNDING-BOX]|%[CONVEX-HULL]|%[convex-hull]", "/diamond.pgm"];
  const hull = "2,0 4,2 2,4 0,2 2,0 ";
  const expected = { exitCode: 0, stdout: `4,2 2,4 0,2 2,0 |${hull}|${hull}`, stderr: "" };
  const files = new Map([["/diamond.pgm", bytes]]), filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/diamond.pgm", bytes);
  expect(runIdentifyCliSync(args, files)).toEqual(expected);
  expect(await runIdentifyCli(args, files)).toEqual(expected);
  expect(await runIdentifyCli(args, { filesystem, cwd: "/" })).toEqual(expected);
});
