import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick images with an embedded Display P3 ICC profile.
const inputs = {
  png: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAABYmlDQ1BpY2MAACiRdZC9S8NQFMVPq1LQOogOHRwyiUPU0gp2cWgrFEUwVAWrU5p+CW18JClScRNXKfgfWMFZcLCIVHBxcBBEBxHdnDopuGh43pdU2iLex+X9OJxzuVzAG1AZK/YCKOmWkUzEpLXUuuR7g4eeU6pmsqiiLAr+/bvr89H13k+IWU27dhDZT1yXzi6Xdp4CU3/9XdWfyZoa/d/UQY0ZFuCRiZVtiwneJR4xaCniquC8y8eC0y6fO56VZJz4lljSCmqGuEkspzv0fAeXimWttYPY3p/VV5fFHOpRzGETJhiKUFGBBAXhf/zTjj+OLXJXYFAujwIsykRJEROyxPPQoWESMnEIQeqQuHPrfg+t+8ltbe8VmG1wzi/a2kIDOJ2hk9Xb2ngEGBoAbupMNVRH6qH25nLA+wkwmAKG7yizYebCIXd7fwzoe+H8YwzwHQJ2lfOvI87tGoWfgSv9BxcparzsG/VjAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAADUExURf8AABniCTcAAAAHdElNRQfqCwYWEyhlQcojAAABn3pUWHRSYXcgcHJvZmlsZSB0eXBlIGljYwAAOI2VU1mO5TAI/Pcp5giY1TmOt0hz/wsM3p4yrfda3UiRE8BFUZDwt9bwZ5iQBhiGMWk0MNAKPD2gTbuxoSAbI4IkuSQjgHX1cNzPy4JGJSMDjgICXE/g6/d3dnvV8ERuhO0w6/VumVKnlIStkrbCpfFtueWY8P4KFn5S8WFZWcVIaXPZjMlb87YMbSkTcQcEzFwhOH7b/jhUm2qtzwuOP6g9A5lPQP+7UNIDiH0Ai1GsuwAORuoT0125n0DVDxe88AegptXk9PyyM4Cqol1E6DDapwOwv6v3Zh6zIbbvDqhftGsgD31cPPpdAeLwqOBOvQf6AjVcFdUd6hoN4UchjjsHNgmZrXlgJHd/HAj70GddIBxj3Se+NvthvohyWE5Gvoj1XWKiNhePWrmXlfIuj3O5J1CJZNOTy/UuERPN8ccIZQqUyuXbHw319VcMoCMoqtukjHkBN5kbF6mtjCzFt1qJ6FkpQmVcYkvrkznhBHKtJ/jdLlgdZZyn/31rSG3uT3Vtwz9p6Ow62jeaJAAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0xMS0wNlQyMjoxOTo0MCswMDowMKeaZZ4AAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMTEtMDZUMjI6MTk6NDArMDA6MDDWx90iAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTExLTA2VDIyOjE5OjQwKzAwOjAwgdL8/QAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=", "base64"),
  jpg: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/4gIoSUNDX1BST0ZJTEUAAQEAAAIYYXBwbAQAAABtbnRyUkdCIFhZWiAH5gABAAEAAAAAAABhY3NwQVBQTAAAAABBUFBMAAAAAAAAAAAAAAAAAAAAAAAA9tYAAQAAAADTLWFwcGzs/aOOOIVHw220vU962hgvAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAApkZXNjAAAA/AAAADBjcHJ0AAABLAAAAFB3dHB0AAABfAAAABRyWFlaAAABkAAAABRnWFlaAAABpAAAABRiWFlaAAABuAAAABRyVFJDAAABzAAAACBjaGFkAAAB7AAAACxiVFJDAAABzAAAACBnVFJDAAABzAAAACBtbHVjAAAAAAAAAAEAAAAMZW5VUwAAABQAAAAcAEQAaQBzAHAAbABhAHkAIABQADNtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADQAAAAcAEMAbwBwAHkAcgBpAGcAaAB0ACAAQQBwAHAAbABlACAASQBuAGMALgAsACAAMgAwADIAMlhZWiAAAAAAAAD21QABAAAAANMsWFlaIAAAAAAAAIPfAAA9v////7tYWVogAAAAAAAASr8AALE3AAAKuVhZWiAAAAAAAAAoOAAAEQsAAMi5cGFyYQAAAAAAAwAAAAJmZgAA8qcAAA1ZAAAT0AAACltzZjMyAAAAAAABDEIAAAXe///zJgAAB5MAAP2Q///7ov///aMAAAPcAADAbv/bAEMAAwICAgICAwICAgMDAwMEBgQEBAQECAYGBQYJCAoKCQgJCQoMDwwKCw4LCQkNEQ0ODxAQERAKDBITEhATDxAQEP/bAEMBAwMDBAMECAQECBALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/AABEIAAEAAgMBEQACEQEDEQH/xAAUAAEAAAAAAAAAAAAAAAAAAAAI/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABUBAQEAAAAAAAAAAAAAAAAAAAcJ/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AOgMVTf/Z", "base64"),
};
for (const mode of ["buffered", "retained", "command"]) {
  for (const input of Object.values(inputs)) {
    for (const extension of ["png", "jpg"]) {
      it.each([false, true])(`preserves ICC unless stripped (%s), ${mode}, ${input[0]}, ${extension}`, async strip => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        const files = new Map([["/input", new Uint8Array(input)]]);
        const outputPath = `/output.${extension}`;
        const args = ["/input", ...(strip ? ["-strip"] : []), outputPath];
        if (mode === "command") {
          const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args,
            cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} }
          });
          expect(result).toMatchObject({ exitCode: 0 });
        } else {
          expect(await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const output = mode === "buffered" ? files.get(outputPath)! : await fs.readFile(outputPath);
        const native = spawnSync("magick", ["identify", "-quiet", "-format", "%[profiles]", "-"], { input: output, encoding: "utf8" });
        expect(native.status, native.stderr).toBe(0);
        expect(native.stdout).toBe(strip ? "" : "icc");
        if (!strip) {
          const original = spawnSync("magick", ["-", "icc:-"], { input });
          const preserved = spawnSync("magick", ["-", "icc:-"], { input: output });
          expect(preserved.status).toBe(0);
          expect(preserved.stdout).toEqual(original.stdout);
        }
      });
    }
  }
}
