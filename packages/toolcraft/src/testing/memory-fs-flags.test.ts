import { describe, expect, it } from "vitest";
import { createMemoryFs } from "./memory-fs.js";

const flagCases = [
  { flags: [undefined, "", "w", "w+"], behavior: "replace", exclusive: false },
  { flags: ["wx", "xw", "wx+", "xw+"], behavior: "replace", exclusive: true },
  { flags: ["a", "a+", "as", "sa", "as+", "sa+"], behavior: "append", exclusive: false },
  { flags: ["ax", "xa", "ax+", "xa+"], behavior: "append", exclusive: true },
  { flags: ["r+", "rs+", "sr+"], behavior: "update", exclusive: false },
  { flags: ["r", "rs", "sr"], behavior: "read", exclusive: false }
].flatMap(({ flags, ...options }) => flags.map((flag) => ({ flag, ...options })));

describe.each(flagCases)("memory filesystem flag=$flag", ({ flag, behavior, exclusive }) => {
  describe.each([false, true])("existing=%s", (existing) => {
    it.each(["", "new", "é🙂overlong"])("writes %j with native flag semantics", async (value) => {
      const original = "original";
      const fs = createMemoryFs(existing ? { "/file.txt": original } : {});
      const before = fs.snapshot();
      const options = flag === undefined ? undefined : { flag };
      const operation = fs.writeFile("/file.txt", value, options);
      const expectedError = exclusive && existing
        ? { code: "EEXIST", errno: -17, syscall: "open", path: "/file.txt" }
        : !existing && (behavior === "read" || behavior === "update")
          ? { code: "ENOENT", errno: -2, syscall: "open", path: "/file.txt" }
          : behavior === "read" && value.length > 0
            ? { code: "EBADF", errno: -9, syscall: "write" }
            : undefined;

      if (expectedError) {
        await expect(operation).rejects.toMatchObject(expectedError);
        expect(fs.snapshot()).toEqual(before);
        expect(fs.changes()).toEqual([]);
        return;
      }

      await operation;
      const expected = behavior === "read" ? original
        : behavior === "append" ? (existing ? original : "") + value
          : behavior === "update" ? value + original.slice(Buffer.byteLength(value))
            : value;
      await expect(fs.readFile("/file.txt")).resolves.toBe(expected);
      expect(fs.changes()).toEqual([{ op: "writeFile", path: "/file.txt" }]);
    });
  });
});

describe("memory filesystem write flag boundaries", () => {
  it.each(["rw", "toString", "constructor", "__proto__", " W ", "R", "wa", "ra+"])(
    "rejects invalid flag %j without changing state",
    async (flag) => {
      const fs = createMemoryFs({ "/file.txt": "original" });

      for (const path of ["/file.txt", "/missing.txt"]) {
        const error = await fs.writeFile(path, "new", { flag }).catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(TypeError);
        expect(error).toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
      }
      expect(fs.snapshot()).toEqual({ "/file.txt": "original" });
      expect(fs.changes()).toEqual([]);
    }
  );

  it.each(["r+", "rs+", "sr+"])("updates bytes rather than Unicode characters for %s", async (flag) => {
    const fs = createMemoryFs({ "/file.txt": "é🙂tail" });

    await fs.writeFile("/file.txt", "58", { encoding: "hex", flag });

    await expect(fs.readFile("/file.txt", "hex")).resolves.toBe("58a9f09f99827461696c");
    expect(fs.changes()).toEqual([{ op: "writeFile", path: "/file.txt" }]);
  });

  it.each(["a", "a+", "as", "sa", "as+", "sa+"])("appends decoded bytes for %s", async (flag) => {
    const fs = createMemoryFs({ "/file.txt": "é" });

    await fs.writeFile("/file.txt", "8J+Zgg==", { encoding: "base64", flag });

    await expect(fs.readFile("/file.txt")).resolves.toBe("é🙂");
  });

  describe.each(["r", "rs", "sr"])("read-only flag=%s", (flag) => {
    it.each([
      { value: " ", encoding: "base64" as const, empty: true },
      { value: "zz", encoding: "hex" as const, empty: true },
      { value: "bmV3", encoding: "base64" as const, empty: false },
      { value: "58", encoding: "hex" as const, empty: false }
    ])("uses encoded length for $encoding/$value", async ({ value, encoding, empty }) => {
      const fs = createMemoryFs({ "/file.txt": "original" });
      const operation = fs.writeFile("/file.txt", value, { flag, encoding });

      if (empty) {
        await operation;
      } else {
        await expect(operation).rejects.toMatchObject({ code: "EBADF" });
      }
      expect(fs.snapshot()).toEqual({ "/file.txt": "original" });
      expect(fs.changes()).toEqual(empty ? [{ op: "writeFile", path: "/file.txt" }] : []);
    });
  });
});
