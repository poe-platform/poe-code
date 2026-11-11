import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 validates geometry, then reads only the leading decimal integer.
describe.each(["command", "retained", "buffered", "sync"] as const)("precision geometry (%s)", mode => {
  describe.each(["convert", "identify", "compare"] as const)("%s", command => {
    it.each([
      { value: "2e1", digits: 2 },
      { value: "2x3", digits: 2 },
      { value: "3%", digits: 3 },
      { value: "0xA", digits: undefined },
      { value: "2", digits: 2 },
      { value: "3.5", digits: 3 },
      { value: "2e-1", digits: 2 },
      { value: "+3", digits: 3 },
      { value: "0x10", digits: 6 },
      { value: "(3)", digits: 6 },
      { value: "x3", digits: 6 },
      { value: "0", digits: 6 },
      { value: "-2", digits: 6 },
      { value: "", digits: undefined },
      { value: "Infinity", digits: undefined },
      { value: "3garbage", digits: undefined }
    ])("parses $value", async ({ value, digits }) => {
      const args = command === "convert"
        ? ["xc:red", "-precision", value, "-format", "%[fx:1/3]", "info:"]
        : command === "identify"
          ? ["identify", "-precision", value, "-format", "%[fx:1/3]", "xc:red"]
          : ["compare", "-precision", value, "-metric", "RMSE", "xc:red", "xc:blue", "null:"];
      const fs = new MemoryFileSystem();
      let result;
      if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const status = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
      } else {
        result = mode === "sync" ? runMagickCliSync(args, new Map())
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
      }
      if (digits === undefined) {
        expect(result.exitCode).toBe(command === "compare" ? 2 : 1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("invalid argument for option '-precision'");
      } else if (command === "compare") {
        const metric = digits === 2 ? "5.4e+04 (0.82)" : digits === 3 ? "5.35e+04 (0.816)" : "53509.1 (0.816497)";
        expect(result).toEqual({ exitCode: 1, stdout: "", stderr: metric });
      } else {
        expect(result).toEqual({ exitCode: 0, stdout: `0.${"3".repeat(digits)}`, stderr: "" });
      }
    });
  });
});
