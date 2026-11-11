import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { count: 1, space: "srgb", tuple: "35,69,103,42", options: ["-channel-fx", "meta0"], output: "gray", expected: [42] },
    { count: 2, space: "srgb", tuple: "35,69,103,42,23", options: ["-channel-fx", "meta1"], output: "gray", expected: [23] },
    { count: 1, space: "srgba", tuple: "35,69,103,128,42", options: ["-channel-fx", "meta0"], output: "gray", expected: [42] },
    { count: 1, space: "srgba", tuple: "35,69,103,128,42", options: [], output: "rgba", expected: [35,69,103,128] },
    { count: 0, space: "srgb", tuple: "35,69,103", options: [], output: "rgb", expected: [35,69,103] },
  ])(`reads TXT extra channels via ${mode}: $space $tuple $options`, async fixture => {
    const bytes = new TextEncoder().encode(`# ImageMagick pixel enumeration: 1,1,${fixture.count},255,${fixture.space}\n0,0: (${fixture.tuple})\n`);
    const files = new Map([["/in.txt", bytes]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.txt", bytes);
    const args = ["/in.txt", ...fixture.options, "-depth", "8", `${fixture.output}:/out.raw`];
    let result;
    if (mode === "command") {
      const arguments_ = createCommandArguments(args);
      let stderr = "";
      const executed = await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
      });
      result = { exitCode: executed.exitCode, stderr };
    } else result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(Array.from((mode === "retained" || mode === "command") ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!)).toEqual(fixture.expected);
    if (fixture.count === 2) {
      const infoArgs = ["/in.txt", "-format", "%[channels]|%z|%[pixel:p{0,0}]", "info:"];
      const info = mode === "sync" ? runConvertCliSync(infoArgs, files) : await runConvertCli(infoArgs, (mode === "retained" || mode === "command") ? { filesystem, cwd: "/" } : files);
      expect(info).toMatchObject({ exitCode: 0, stdout: "srgb  5.2|8|srgb(35,69,103)", stderr: "" });
    }
  });
}
