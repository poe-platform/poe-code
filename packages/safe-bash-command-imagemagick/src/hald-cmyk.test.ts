import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including the unchanged sRGB control.
for (const mode of ["map", "command"] as const)
it.each([
  { source: "sRGB", cube: "CMYK", output: ["-format", "%[colorspace]/%[channels]", "info:/out"], expected: "CMYK/cmyka 5.0" },
  { source: "sRGB", cube: "CMYK", output: ["-channel", "K", "-separate", "-endian", "MSB", "-depth", "8", "rgb:/out"], expected: "202020393939737373" },
  { source: "sRGB", cube: "CMYK", expected: "bc724b84af5542678c" },
  { source: "CMYK", cube: "sRGB", expected: "90b570a2c7ec294e73" },
  { source: "sRGB", cube: "sRGB", expected: "c56a4093b84042678c" },
])(`${mode}: grades $source through $cube Hald: $expected`, async ({ source, cube, output, expected }) => {
  const files = new Map<string, Uint8Array>([
    ["/a.ppm", Buffer.from("P3\n3 1\n255\n13 31 79 235 153 61 255 0 127\n")],
    ["/h.ppm", Buffer.concat([Buffer.from("P6\n8 8\n255\n"), Buffer.from(Array.from({ length: 192 }, (_, i) => (13 + 37 * i) % 256))])],
    ["/out", Buffer.from("KEEP")],
  ]);
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  const args = ["(", "/a.ppm", "-colorspace", source, ")", "(", "/h.ppm", "-colorspace", cube, ")", "-hald-clut",
    ...(output ?? ["-colorspace", "sRGB", "-endian", "MSB", "-depth", "8", "rgb:/out"])];
  let stdout = "", stderr = "";
  const result = mode === "map" ? await runMagickCli(args, files) : await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
  });
  expect(mode === "map" ? result : { ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const bytes = mode === "map" ? files.get("/out")! : await fs.readFile("/out");
  expect(Buffer.from(bytes).toString(output?.[0] === "-format" ? "utf8" : "hex")).toBe(expected);
});

for (const mode of ["map", "command"] as const)
for (const channel of ["CMYKA", "K", "C", "A"])
it(`${mode}: preserves unselected inks and alpha across Hald chunks (${channel})`, async () => {
  const width = 513;
  const files = new Map<string, Uint8Array>([
    ["/source.pam", Buffer.concat([Buffer.from(`P7\nWIDTH ${width}\nHEIGHT 1\nDEPTH 5\nMAXVAL 255\nTUPLTYPE CMYK_ALPHA\nENDHDR\n`), Buffer.from(Array.from({ length: width * 5 }, (_, i) => [20, 40, 60, 80, 100][i % 5]!))])],
    ["/cube.pam", Buffer.concat([Buffer.from("P7\nWIDTH 8\nHEIGHT 8\nDEPTH 5\nMAXVAL 255\nTUPLTYPE CMYK_ALPHA\nENDHDR\n"), Buffer.from(Array.from({ length: 64 * 5 }, (_, i) => [30, 50, 70, 90, 110][i % 5]!))])],
  ]);
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  expect(await runMagickCli(["/source.pam", "/cube.pam", "-channel", channel, "-hald-clut", "+channel", "-depth", "8", "cmyka:/out"],
    mode === "map" ? files : { filesystem: fs, cwd: "/" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const expected = [20, 40, 60, 80, 100].map((value, i) => channel.includes("CMYKA"[i]!) ? value + 10 : value);
  const output = mode === "map" ? files.get("/out")! : await fs.readFile("/out");
  expect(output).toEqual(Uint8Array.from({ length: width * 5 }, (_, i) => expected[i % 5]!));
});
