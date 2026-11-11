import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const layout of ["concatenate", "geometry"] as const)
for (const target of ["plain", "numbered", "single", "separate"] as const)
it(`writes MIFF montage pages via ${mode}, ${layout}, ${target}`, async () => {
  const files = new Map([
    ["a.ppm", new TextEncoder().encode("P3\n2 1\n255\n255 0 0 255 0 0\n")],
    ["b.ppm", new TextEncoder().encode("P3\n1 2\n255\n0 0 255 0 0 255\n")]
  ]);
  const filesystem = new MemoryFileSystem();
  for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
  const output = target === "numbered" ? "frame-%02d.miff" : "result.miff";
  const args = ["a.ppm", "b.ppm", ...(layout === "concatenate" ? ["-mode", "Concatenate"] : ["-geometry", "2x2+0+0"]),
    "-tile", target === "single" ? "2x1" : "1x1", ...(target === "separate" ? ["+adjoin"] : []), output];
  let stdout = "", stderr = "";
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: ["montage", ...args], cwd: "/", env: {}, fs: filesystem,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  }) : mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
  expect({ stdout, stderr, ...result }).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
  const retained = mode === "command" || mode === "retained";
  const names = (retained ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()])
    .filter(name => name.endsWith(".miff")).sort();
  expect(names).toEqual(target === "numbered" ? ["frame-00.miff", "frame-01.miff"]
    : target === "separate" ? ["result-0.miff", "result-1.miff"] : ["result.miff"]);
  const outputs = new Map<string, Uint8Array>();
  for (const name of names) outputs.set(name, retained ? await filesystem.readFile(`/${name}`) : files.get(name)!);
  const readback = runMagickCliSync([...names, "-format", "%wx%h:%p/%n;", "info:"], outputs);
  expect(readback).toMatchObject({ exitCode: 0, stderr: "", stdout: target === "single"
    ? layout === "concatenate" ? "3x2:0/1;" : "4x2:0/1;"
    : layout === "concatenate" ? "2x1:0/2;1x2:1/2;" : "2x2:0/2;2x2:1/2;" });
  if (target !== "single") {
    expect(runMagickCliSync([...names, "-format", "%[pixel:p{0,0}];", "info:"], outputs))
      .toMatchObject({ exitCode: 0, stderr: "", stdout: "srgb(255,0,0);srgb(0,0,255);" });
  }
});
