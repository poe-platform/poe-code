import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  for (const setting of [["-gravity"], ["-set", "gravity"], ["-set", "option:gravity"]]) {
    it.each([
      ["South-East", true], ["South_East", true], ["sOuTh-eAsT", true], ["SouthEast", true],
      ["South East", false], ["South,East", false], ["South\tEast", false], ["South", false],
    ] as const)(`${mode}: ${setting.join(" ")} %s preserves native placement`, async (gravity, southeast) => {
      const args = ["xc:red", "xc:blue", "+append", "-background", "black", ...setting,
        gravity, "-extent", "4x2", "-depth", "8", "rgb:/out"];
      const files = new Map<string, Uint8Array>();
      const filesystem = new MemoryFileSystem();
      let exitCode: number, stderr = "";
      if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        ({ exitCode } = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { async write() {} },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }));
      } else {
        const result = mode === "sync" ? runMagickCliSync(args, files)
          : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        ({ exitCode, stderr } = result);
      }
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
      expect(Buffer.from(output).toString("hex")).toBe(southeast
        ? "000000000000000000000000000000000000ff00000000ff"
        : "000000000000000000000000000000ff00000000ff000000");
    });
  }
}
