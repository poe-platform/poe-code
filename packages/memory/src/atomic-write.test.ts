import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { writeFileAtomically } = await import("./atomic-write.js");

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("writeFileAtomically", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it("does not remove a colliding temporary symlink", async () => {
    const filePath = "/repo/.poe-code/memory/pages/page.md";
    const outsidePath = "/outside.tmp";
    vol.fromJSON({
      [filePath]: "# Existing\n",
      [outsidePath]: "outside-state\n"
    });

    let tempPath: string | undefined;
    const writeFile = vol.promises.writeFile.bind(vol.promises);
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (targetPath, data, options) => {
      const pathText = String(targetPath);
      if (
        tempPath === undefined &&
        pathText.startsWith(`${filePath}.`) &&
        pathText.endsWith(".tmp")
      ) {
        tempPath = pathText;
        vol.symlinkSync(outsidePath, pathText);
        expect(options).toEqual({ encoding: "utf8", flag: "wx" });
      }

      await writeFile(targetPath, data, options);
    });

    await expect(writeFileAtomically(filePath, "# Updated\n")).rejects.toThrow();

    expect(tempPath).toBeDefined();
    expect(vol.readFileSync(outsidePath, "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(tempPath as string).isSymbolicLink()).toBe(true);
    await expect(vol.promises.readFile(filePath, "utf8")).resolves.toBe("# Existing\n");
  });

  it("removes a partial temporary file when the temp write fails", async () => {
    const filePath = "/repo/.poe-code/memory/pages/page.md";
    vol.fromJSON({
      [filePath]: "# Existing\n"
    });

    let tempPath: string | undefined;
    const writeFile = vol.promises.writeFile.bind(vol.promises);
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (targetPath, data, options) => {
      const pathText = String(targetPath);
      if (
        tempPath === undefined &&
        pathText.startsWith(`${filePath}.`) &&
        pathText.endsWith(".tmp")
      ) {
        tempPath = pathText;
        await writeFile(targetPath, "partial\n", options);
        throw new Error("disk full");
      }

      await writeFile(targetPath, data, options);
    });

    await expect(writeFileAtomically(filePath, "# Updated\n")).rejects.toThrow("disk full");

    expect(tempPath).toBeDefined();
    await expect(vol.promises.readFile(tempPath as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(vol.promises.readFile(filePath, "utf8")).resolves.toBe("# Existing\n");
  });

  it("removes a partial temporary file when the write error only inherits an existing-path code", async () => {
    const filePath = "/repo/.poe-code/memory/pages/page.md";
    vol.fromJSON({
      [filePath]: "# Existing\n"
    });

    let tempPath: string | undefined;
    const writeFile = vol.promises.writeFile.bind(vol.promises);
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (targetPath, data, options) => {
      const pathText = String(targetPath);
      if (
        tempPath === undefined &&
        pathText.startsWith(`${filePath}.`) &&
        pathText.endsWith(".tmp")
      ) {
        tempPath = pathText;
        await writeFile(targetPath, "partial\n", options);
        throw new Error("temp write denied");
      }

      await writeFile(targetPath, data, options);
    });

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(writeFileAtomically(filePath, "# Updated\n")).rejects.toThrow(
        "temp write denied"
      );
    });

    expect(tempPath).toBeDefined();
    await expect(vol.promises.readFile(tempPath as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(vol.promises.readFile(filePath, "utf8")).resolves.toBe("# Existing\n");
  });
});
