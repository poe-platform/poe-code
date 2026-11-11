import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: the mask weights only the copied channel.
for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const operation of ["composite", "-composite"] as const)
for (const { compose, masked, hex } of [
  { compose: "CopyRed", masked: true, hex: "656f79558d9746abb5" },
  { compose: "CopyGreen", masked: true, hex: "656f79835f97a150b5" },
  { compose: "CopyBlue", masked: true, hex: "656f79838d69a1ab5a" },
  { compose: "Over", masked: true, hex: "656f79555f6946505a" },
  { compose: "Plus", masked: true, hex: "656f7997a6b5e7fbff" },
  { compose: "CopyRed", masked: false, hex: "0a6f79288d9746abb5" },
  { compose: "CopyGreen", masked: false, hex: "651479833297a150b5" },
  { compose: "CopyBlue", masked: false, hex: "656f1e838d3ca1ab5a" },
]) {
  it(`${route}: ${operation} ${compose} ${masked ? "honors the mask" : "copies without a mask"}`, async () => {
    const files = new Map([
      ["/a.ppm", new TextEncoder().encode("P3\n3 1\n255\n10 20 30 40 50 60 70 80 90\n")],
      ["/b.ppm", new TextEncoder().encode("P3\n3 1\n255\n101 111 121 131 141 151 161 171 181\n")],
      ["/mask.pgm", new TextEncoder().encode("P2\n3 1\n255\n0 128 255\n")],
      ["/out.raw", new TextEncoder().encode("KEEP")],
      ["/side.raw", new TextEncoder().encode("KEEP")],
    ]);
    const fs = createMemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const mask = masked ? ["/mask.pgm"] : [];
    const args = operation === "composite"
      ? ["composite", "-compose", compose, "/a.ppm", "/b.ppm", ...mask, "rgb:/out.raw"]
      : ["/b.ppm", "/a.ppm", ...mask, "-compose", compose, "-composite", "rgb:/out.raw"];
    let stdout = "", stderr = "";
    let exitCode: number;
    if (route === "command") {
      ({ exitCode } = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }));
    } else {
      ({ exitCode, stdout, stderr } = route === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files));
    }
    expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    for (const [path, expected] of [["/out.raw", hex], ["/side.raw", "4b454550"]] as const) {
      const bytes = route === "command" || route === "retained" ? await fs.readFile(path) : files.get(path)!;
      expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    }
  });
}
