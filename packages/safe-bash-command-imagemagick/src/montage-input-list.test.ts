import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const surround of [false, true])
for (const quoted of ['"two words.ppm"', "'two words.ppm'"])
it(`expands ordered montage filename lists via ${mode}, surrounding inputs: ${surround}, ${quoted}`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  for (const [name, pixel] of [["a.ppm", [255, 0, 0]], ["b.ppm", [0, 255, 0]], ["two words.ppm", [0, 0, 255]]] as const) {
    const bytes = new Uint8Array([...encoder.encode("P6\n1 1\n255\n"), ...pixel]);
    files.set(name, bytes);
    await fs.writeFile("/" + name, bytes);
  }
  const list = encoder.encode(`b.ppm\n${quoted}\na.ppm\nb.ppm\n`);
  files.set("photos.txt", list);
  await fs.writeFile("/photos.txt", list);
  const args = ["-geometry", "1x1+0+0", "-tile", "x1", ...(surround ? ["b.ppm"] : []), "@photos.txt", ...(surround ? ["a.ppm"] : []), "-depth", "8", "rgb:-"];
  let bytes: Uint8Array | undefined, stderr = "", exitCode: number;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const chunks: Uint8Array[] = [];
    const context: CommandContext = {
      command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }, registerCleanup() {}
    };
    exitCode = (await command.execute(context)).exitCode;
    bytes = new Uint8Array(chunks.flatMap(chunk => Array.from(chunk)));
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    ({ exitCode, stderr, stdoutBytes: bytes } = result);
  }
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(Array.from(bytes ?? [])).toEqual([
    ...(surround ? [0, 255, 0] : []), 0, 255, 0, 0, 0, 255, 255, 0, 0, 0, 255, 0, ...(surround ? [255, 0, 0] : [])
  ]);
});

it("charges filename-list bytes before reading listed images", async () => {
  const fs = new MemoryFileSystem(), failure = new Error("list input limit");
  await fs.writeFile("/photos.txt", new TextEncoder().encode("a.ppm\n"));
  await expect(runMontageCli(["@photos.txt", "out.png"], {
    filesystem: fs, cwd: "/", inputBudget: { check(total) { if (total > 5) throw failure; } }
  })).rejects.toBe(failure);
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["photos.txt"]);
});

it("keeps missing-list diagnostics consistent across execution paths", async () => {
  const args = ["@absent.txt", "rgb:-"], files = new Map<string, Uint8Array>();
  const expected = runMontageCliSync(args, files);
  expect(expected.exitCode).toBe(1);
  expect(expected.stderr).toContain("unable to open image '@absent.txt'");
  expect(await runMontageCli(args, files)).toEqual(expected);
  expect(await runMontageCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" })).toEqual(expected);
});
