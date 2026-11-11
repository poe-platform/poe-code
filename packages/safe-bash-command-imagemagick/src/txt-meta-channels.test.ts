import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
  it.each([
    { after: [] as string[], options: [] as string[], fx: "red=>meta0", color: "#234567", depth: "8", expected: "1,255,srgb\n0,0: (35,69,103,35)  #234567  srgb(35,69,103)\n" },
    { after: [] as string[], options: [] as string[], fx: "red=>meta0,green=>meta1", color: "#234567", depth: "8", expected: "2,255,srgb\n0,0: (35,69,103,35,69)  #234567  srgb(35,69,103)\n" },
    { after: [] as string[], options: [] as string[], fx: "red=>meta0,green=>meta1", color: "#23456780", depth: "16", expected: "2,65535,srgba\n0,0: (8995,17733,26471,32896,8995,17733)  #2323454567678080  srgba(35,69,103,0.501961)\n" },
    { after: [] as string[], options: ["-colorspace", "CMYK"], fx: "red=>meta0", color: "#234567", depth: "8", expected: "1,255,cmyk\n0,0: (168,84,0,152,168)  #A8540098  cmyk(168,84,0,152)\n" },
    { after: ["-colorspace", "Gray"], options: [], fx: "red=>meta0", color: "#234567", depth: "8", expected: "1,255,gray\n0,0: (64,35)  #404040  gray(64)\n" },
  ])(`writes extra channel counts and samples through ${mode}: $color $fx depth=$depth`, async ({ after, options, fx, color, depth, expected }) => {
    const argv = [`xc:${color}`, ...options, "-channel-fx", fx, ...after, "-depth", depth, "txt:-"];
    const stdoutExpected = `# ImageMagick pixel enumeration: 1,1,${expected}`;
    if (mode !== "command") {
      const files = new Map<string, Uint8Array>();
      const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
      expect(result).toMatchObject({ exitCode: 0, stdout: stdoutExpected, stderr: "" });
      return;
    }
    const args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({
      command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
      signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: stdoutExpected, stderr: "" });
  });
}

it("streams meta samples across chunk boundaries to TXT files and stdout", async () => {
  const filesystem = new MemoryFileSystem();
  const result = await runConvertCli([
    "-size", "4097x1", "gradient:#234567-#abcdef", "-channel-fx", "red=>meta0,green=>meta1",
    "-depth", "8", "-write", "txt:/copy.txt", "txt:-"
  ], { filesystem, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  expect(new TextDecoder().decode(await filesystem.readFile("/copy.txt"))).toBe(result.stdout);
  const lines = result.stdout.trimEnd().split("\n");
  expect(lines).toHaveLength(4098);
  expect(lines[0]).toBe("# ImageMagick pixel enumeration: 4097,1,2,255,srgb");
  expect(lines[1]).toBe("0,0: (35,69,103,35,69)  #234567  srgb(35,69,103)");
  expect(lines[4097]).toBe("4096,0: (171,205,239,171,205)  #ABCDEF  srgb(171,205,239)");
});
