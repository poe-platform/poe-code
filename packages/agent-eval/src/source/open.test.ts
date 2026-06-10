import { isAbsolute, resolve } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import { openSource } from "./open.js";
import type { EvalFs } from "../types.js";

function memfs(files: Record<string, string | null>, cwd = "/"): EvalFs {
  const volume = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(volume).promises;

  return {
    readdir(path, options) {
      return fs.readdir(isAbsolute(path) ? path : resolve(cwd, path), options);
    },
    readFile(path, encoding) {
      return fs.readFile(isAbsolute(path) ? path : resolve(cwd, path), encoding);
    },
    realpath(path) {
      return fs.realpath(isAbsolute(path) ? path : resolve(cwd, path)) as Promise<string>;
    },
    stat(path) {
      return fs.stat(isAbsolute(path) ? path : resolve(cwd, path));
    }
  } as EvalFs;
}

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

describe("openSource", () => {
  it("rejects a directory without any first-level eval.yaml", async () => {
    const fs = memfs({
      "/repo/evals": null,
      "/repo/evals/nested/child/eval.yaml": "id: child"
    });

    await expect(openSource("/repo/evals", fs)).rejects.toThrow(
      'Eval source "/repo/evals" does not contain any first-level <id>/eval.yaml files.'
    );
  });

  it("rejects a source path that is not absolute", async () => {
    const fs = memfs(
      {
        "/repo/evals/smoke/eval.yaml": "id: smoke"
      },
      "/repo"
    );

    await expect(openSource("evals", fs)).rejects.toThrow(
      'Eval source path must be absolute, received "evals".'
    );
  });

  it("rejects an absolute source path that is a file", async () => {
    const fs = memfs({
      "/repo/evals": "not a directory"
    });

    await expect(openSource("/repo/evals", fs)).rejects.toThrow(
      'Eval source "/repo/evals" is not a directory.'
    );
  });

  it("does not treat inherited stat error codes as missing source directories", async () => {
    const raw = memfs({
      "/repo/evals/smoke/eval.yaml": "id: smoke"
    });
    const fs: EvalFs = {
      ...raw,
      stat: async (filePath) => {
        if (filePath === "/repo/evals") {
          throw new Error("source stat denied");
        }

        return raw.stat(filePath);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(openSource("/repo/evals", fs)).rejects.toThrow("source stat denied");
    });
  });

  it("returns EvalSource for an absolute existing directory with at least one eval", async () => {
    const fs = memfs({
      "/repo/evals/smoke/eval.yaml": "id: smoke"
    });

    await expect(openSource("/repo/evals", fs)).resolves.toEqual({
      rootDir: "/repo/evals"
    });
  });
});
