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

  it("returns EvalSource for an absolute existing directory with at least one eval", async () => {
    const fs = memfs({
      "/repo/evals/smoke/eval.yaml": "id: smoke"
    });

    await expect(openSource("/repo/evals", fs)).resolves.toEqual({
      rootDir: "/repo/evals"
    });
  });
});
