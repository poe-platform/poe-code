import { Volume, createFsFromVolume } from "memfs";
import { loadWorkspace, type LintFs, type WorkspaceModel } from "./model.js";

/** A memfs-backed {@link LintFs} built from an absolute-path → contents map. */
export function memLintFs(files: Record<string, string>): LintFs {
  const promises = createFsFromVolume(Volume.fromJSON(files)).promises;
  return {
    async readFile(p) {
      return (await promises.readFile(p, "utf8")) as string;
    },
    async readdir(p) {
      return (await promises.readdir(p, { withFileTypes: true })) as unknown as {
        name: string;
        isDirectory(): boolean;
      }[];
    }
  };
}

export function pkgJson(fields: Record<string, unknown>): string {
  return JSON.stringify(fields, null, 2);
}

/** Build a {@link WorkspaceModel} from an in-memory file map rooted at /repo. */
export function makeWorkspace(files: Record<string, string>): Promise<WorkspaceModel> {
  return loadWorkspace(memLintFs(files), "/repo");
}
