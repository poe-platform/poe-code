import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [
  5000, 5000, 5000, 0, 10000, 10001, 10000, 0, 32767, 32767, 32767, 32768,
  50000, 16000, 38000, 32768, 10001, 10000, 10000, 65535,
];
const header = new TextEncoder().encode("P7\nWIDTH 5\nHEIGHT 1\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n");
const input = new Uint8Array(header.length + pixels.length * 2);
input.set(header);
const samples = new DataView(input.buffer, header.length);
pixels.forEach((value, index) => samples.setUint16(index * 2, value));
const format = "%[colorspace] %[fx:u.r] %[fx:u.g] %[fx:u.b] %[fx:u.a]";

// ImageMagick 7.1.2-35 Q16-HDRI scalar output and decoded PNG64 RGBA samples.
const cases = [
  { space: "HSL", operations: ["-channel", "A", "-negate"], expected: "HSL 0.583333 0.503937 0.501961 0.498039" },
  { space: "HSL", operations: ["-channel", "RGB", "-negate"], expected: "HSL 0.416667 0.496063 0.498039 0.501961" },
  { space: "HSL", operations: ["+negate"], expected: "HSL 0.583333 0.503937 0.501961 0.501961" },
  { space: "CMYK", operations: ["-channel", "A", "-negate"], expected: "CMYK 0.666667 0.333333 0 0.498039" },
  { space: "HSL", operations: ["-negate"], expected: "HSL 0.416667 0.496063 0.498039 0.498039" },
  { space: "HSV", operations: ["-channel", "R", "-negate"], expected: "HSV 0.416667 0.666667 0.752941 0.501961" },
  { space: "Lab", operations: ["-negate"], expected: "CIELab 0.477879 0.499585 0.654883 0.498039" },
  { space: "XYZ", operations: ["-negate"], expected: "XYZ 0.806528 0.796666 0.472262 0.498039" },
  { space: "YCbCr", operations: ["-negate"], expected: "YCbCr 0.544342 0.332161 0.645898 0.498039" },
  { space: "HSL", operations: [], expected: "HSL 0.583333 0.503937 0.501961 0.501961" },
  { space: "Lab", operations: [], expected: "CIELab 0.522121 0.500415 0.345117 0.501961" },
  { space: "sRGB", operations: ["-negate"], expected: "sRGB 0.74902 0.498039 0.247059 0.498039" },
].map(({ space, operations, expected }) => ({
  args: ["xc:#4080c080", "-colorspace", space, ...operations, "+channel", "-format", format, "info:/out"], expected,
}));
cases.push(
  { args: ["/in.pam", "-colorspace", "HSL", "-negate", "-colorspace", "sRGB", "PNG64:/out"],
    expected: "ffffd8efd8efffffb1dfb1dfffffffffffff000100017fffbbc690f042687fffffffb1dfb1df0000" },
  { args: ["/in.pam", "-colorspace", "HSL", "-colorspace", "sRGB", "PNG64:/out"],
    expected: "138813881388000027102711271000007fff7fff7fff8000c3503e8094708000271127102710ffff" },
);

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each(cases)(`${mode}: matches native working channels for $args`, async ({ args, expected }) => {
    const files = new Map([["/in.pam", input], ["/out", new TextEncoder().encode("KEEP")]]);
    const fs = createMemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} },
      stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect(args.at(-1)!.startsWith("info:") ? new TextDecoder().decode(output)
      : Array.from(decodeImage(output).data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
  });
}
