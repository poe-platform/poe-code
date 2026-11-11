import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompositeCommand, createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

for (const route of ["sync", "buffered", "retained", "composite", "magick"] as const) {
  for (const position of ["none", "first", "second", "both"] as const) {
    it(`${route}: composite publishes ${position} intermediate writes before combining inputs`, async () => {
      const encode = (text: string) => new TextEncoder().encode(text);
      const files = new Map([
        ["/a.ppm", encode("P3\n3 1\n255\n10 20 30 40 50 60 70 80 90\n")],
        ["/b.ppm", encode("P3\n3 1\n255\n101 111 121 131 141 151 161 171 181\n")],
        ["/out.raw", encode("KEEP")], ["/side.raw", encode("KEEP")],
      ]);
      const filesystem = new MemoryFileSystem();
      for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
      const args = ["-compose", "CopyRed", "/a.ppm",
        ...(position === "first" || position === "both" ? ["-write", "rgb:/side.raw"] : []),
        "/b.ppm", ...(position === "second" || position === "both" ? ["-write", "rgb:/side.raw"] : []), "rgb:/out.raw"];
      let result;
      if (route === "composite" || route === "magick") {
        const command = route === "magick" ? createMagickCommand() : createCompositeCommand();
        const argumentValues = createCommandArguments([...(route === "magick" ? ["composite"] : []), ...args]);
        let stdout = "", stderr = "";
        result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
          cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr };
      } else result = route === "sync" ? runCompositeCliSync(args, files)
        : await runCompositeCli(args, route === "buffered" ? files : { filesystem, cwd: "/" });
      expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      for (const [path, expected] of [["/out.raw", "0a6f79288d9746abb5"], ["/side.raw", position === "none" ? "4b454550"
        : position === "first" ? "0a141e28323c46505a" : "0a141e28323c46505a656f79838d97a1abb5"]] as const) {
        const output = route === "sync" || route === "buffered" ? files.get(path)! : await filesystem.readFile(path);
        expect(Buffer.from(output).toString("hex"), path).toBe(expected);
      }
    });
  }
}

for (const route of ["sync", "buffered", "retained"] as const) {
  it(`${route}: composite rejects -write without a destination`, async () => {
    const args = ["xc:red", "xc:blue", "-write"];
    const result = route === "sync" ? runCompositeCliSync(args, new Map())
      : await runCompositeCli(args, route === "buffered" ? new Map() : { filesystem: new MemoryFileSystem(), cwd: "/" });
    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "composite: missing argument '-write'\n" });
  });
}
