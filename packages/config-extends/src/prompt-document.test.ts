import { describe, expect, it } from "vitest";
import {
  resolvePromptDocument,
  type PromptDocumentFileSystem
} from "./prompt-document.js";

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

describe("resolvePromptDocument", () => {
  it("does not treat inherited read error codes as missing optional documents", async () => {
    const fs: PromptDocumentFileSystem = {
      readFile: async () => {
        throw new Error("document read denied");
      },
      realpath: async (filePath) => filePath
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        resolvePromptDocument({
          cwd: "/workspace",
          filePath: "review.md",
          optional: true,
          fs
        })
      ).rejects.toThrow("document read denied");
    });
  });

  it("allows files whose real paths stay inside resolved configured roots", async () => {
    const fs: PromptDocumentFileSystem = {
      async readFile(filePath) {
        if (filePath === "/var/tmp/workspace/bases/review.md") {
          return "Base prompt";
        }

        const error = new Error(`not found: ${filePath}`) as Error & { code: string };
        error.code = "ENOENT";
        throw error;
      },
      async realpath(filePath) {
        return filePath.replace(/^\/var\/tmp\/workspace/, "/private/var/tmp/workspace");
      }
    };

    await expect(
      resolvePromptDocument({
        cwd: "/var/tmp/workspace",
        filePath: "review.md",
        optional: true,
        basePaths: ["/var/tmp/workspace/bases"],
        fs
      })
    ).resolves.toMatchObject({
      prompt: "Base prompt",
      chain: ["/var/tmp/workspace/review.md", "/var/tmp/workspace/bases/review.md"]
    });
  });
});
