import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const first = ["-size", "2x1", "xc:#808080"];
const second = ["-size", "2x1", "xc:#888080"];
const draw = ["-fill", "white", "-draw", "point 1,0"];
const original = "808080808080";
// ImageMagick 7.1.2-35: comparison uses the first frame's scoped fuzz.
const cases = [
  { name: "first-frame fuzz crops only the changed pixel", frames: ["(", ...first, "-fuzz", "10%", ")", "(", ...second, ...draw, ")"], tail: [], geometry: "2x1+0+0;1x1+1+0;", pixels: original + "ffffff" },
  { name: "first-frame fuzz omits a matching frame", frames: ["(", ...first, "-fuzz", "10%", ")", "(", ...second, ")"], tail: [], geometry: "2x1+0+0;", pixels: original },
  { name: "second-frame fuzz does not affect comparison", frames: ["(", ...first, ")", "(", ...second, "-fuzz", "10%", ")"], tail: [], geometry: "2x1+0+0;2x1+0+0;", pixels: original + "888080888080" },
  { name: "default zero fuzz retains the full changed frame", frames: ["(", ...first, ")", "(", ...second, ...draw, ")"], tail: [], geometry: "2x1+0+0;2x1+0+0;", pixels: original + "888080ffffff" },
  { name: "fuzz set before the first input is retained", frames: ["(", "-fuzz", "10%", ...first, ")", "(", ...second, ")"], tail: [], geometry: "2x1+0+0;", pixels: original },
  { name: "global reset updates the first frame", frames: ["(", ...first, "-fuzz", "10%", ")", "(", ...second, ")"], tail: ["+fuzz"], geometry: "2x1+0+0;2x1+0+0;", pixels: original + "888080888080" },
  { name: "global fuzz updates both frames", frames: ["(", ...first, ")", "(", ...second, ")"], tail: ["-fuzz", "10%"], geometry: "2x1+0+0;", pixels: original },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const operation of [["-layers", "CompareAny"], ["-layers", "CompareOverlay"], ["-deconstruct"]]) {
    it.each(cases)(`${mode} ${operation.join(" ")}: $name`, async ({ frames, tail, geometry, pixels }) => {
      const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const argv = ["-respect-parentheses", ...frames, ...tail, ...operation,
        "-depth", "8", "-write", "out.rgb", "-format", "%wx%h%O;", "info:"];
      let stdout = "", stderr = "";
      const argumentValues = createCommandArguments(argv);
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result.exitCode).toBe(0);
      expect("stderr" in result ? result.stderr : stderr).toBe(argv.includes("-deconstruct")
        ? `magick: option has been replaced '-deconstruct', use "-layers CompareAny" at CLI arg ${argv.indexOf("-deconstruct") + 1}\n` : "");
      expect("stdout" in result ? result.stdout : stdout).toBe(geometry);
      const output = mode === "sync" || mode === "buffered" ? files.get("out.rgb")! : await fs.readFile("/out.rgb");
      expect(Buffer.from(output).toString("hex")).toBe(pixels);
    });
  }
}
