import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failedStatTarget: undefined as string | undefined,
  files: new Map<string, string>()
}));

vi.mock("node:fs/promises", () => ({
  readFile: async (targetPath: string) => {
    const content = mocks.files.get(String(targetPath));
    if (content === undefined) {
      throw Object.assign(new Error("missing file"), { code: "ENOENT" });
    }

    return content;
  },
  stat: async (targetPath: string) => {
    const normalized = String(targetPath);
    if (normalized === mocks.failedStatTarget) {
      throw new Error("template stat denied");
    }
    if (mocks.files.has(normalized)) {
      return {};
    }

    throw Object.assign(new Error("missing path"), { code: "ENOENT" });
  }
}));

const { loadTemplate } = await import("./templates.js");

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

describe("loadTemplate", () => {
  beforeEach(() => {
    mocks.failedStatTarget = undefined;
    mocks.files.clear();
    mocks.files.set(path.join(packageRoot, "package.json"), "{}");
  });

  it("does not treat inherited stat error codes as missing template candidates", async () => {
    mocks.failedStatTarget = path.join(packageRoot, "src", "templates", "poe-generate.md");
    mocks.files.set(path.join(packageRoot, "dist", "templates", "poe-generate.md"), "# fallback\n");

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(loadTemplate("poe-generate.md")).rejects.toThrow("template stat denied");
    });
  });
});
