import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Identical RGBA pixels; tagged adds an iCCP profile and an eXIf TIFF Make tag.
// Constructed independently of the image-ast encoder.
const tagged = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAABYmlDQ1BpY2MAACiRdZC9S8NQFMVPq1LQOogOHRwyiUPU0gp2cWgrFEUwVAWrU5p+CW18JClScRNXKfgfWMFZcLCIVHBxcBBEBxHdnDopuGh43pdU2iLex+X9OJxzuVzAG1AZK/YCKOmWkUzEpLXUuuR7g4eeU6pmsqiiLAr+/bvr89H13k+IWU27dhDZT1yXzi6Xdp4CU3/9XdWfyZoa/d/UQY0ZFuCRiZVtiwneJR4xaCniquC8y8eC0y6fO56VZJz4lljSCmqGuEkspzv0fAeXimWttYPY3p/VV5fFHOpRzGETJhiKUFGBBAXhf/zTjj+OLXJXYFAujwIsykRJEROyxPPQoWESMnEIQeqQuHPrfg+t+8ltbe8VmG1wzi/a2kIDOJ2hk9Xb2ngEGBoAbupMNVRH6qH25nLA+wkwmAKG7yizYebCIXd7fwzoe+H8YwzwHQJ2lfOvI87tGoWfgSv9BxcparzsG/VjAAAAJ2VYSWZJSSoACAAAAAEADwECAA0AAAAaAAAAAAAAAFBhcml0eUNhbWVyYQCqOMpqAAAAM0lEQVR4nA3IoREAQAgDwXSAoRc0lWBOf0MUy0dkLrPKQB3wgltPWVyXwd1CyjGMYdD6f7FYEoUWhAkjAAAAAElFTkSuQmCC", "base64");
const untagged = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAM0lEQVR4nA3IoREAQAgDwXSAoRc0lWBOf0MUy0dkLrPKQB3wgltPWVyXwd1CyjGMYdD6f7FYEoUWhAkjAAAAAElFTkSuQmCC", "base64");
const format = "%[profiles]|%[exif:Make]";
const cases = [
  { name: "embedded EXIF and ICC", input: tagged, options: [], expected: "exif,icc|ParityCamera" },
  { name: "untagged control", input: untagged, options: [], expected: "|" },
  { name: "EXIF alone", input: tagged, options: ["+profile", "icc"], expected: "exif|ParityCamera" },
  { name: "removed EXIF", input: tagged, options: ["+profile", "exif"], expected: "icc|" },
  { name: "removed profiles", input: tagged, options: ["+profile", "*"], expected: "|" },
  { name: "stripped profiles", input: tagged, options: ["-strip"], expected: "|" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  for (const identify of [false, true]) {
    it.each(cases.filter(test => !identify || test.options.length === 0))(
      `lists PNG profiles: $name (${mode}, identify=${identify})`,
      async ({ input, options, expected }) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const args = identify
          ? ["identify", "-quiet", "-format", "%[profiles]", "/input.png"]
          : ["-quiet", "/input.png", ...options, "-format", format, "info:"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, new Map([["/input.png", input]]))
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map([["/input.png", input]]));
        expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
          .toEqual({ exitCode: 0, stdout: identify ? expected.split("|")[0] : expected, stderr: "" });
      }
    );
  }
}
