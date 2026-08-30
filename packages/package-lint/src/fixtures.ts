import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { loadWorkspace, type LintFs, type WorkspaceModel } from "./model.js";

/** A memfs-backed {@link LintFs} built from an absolute-path → contents map. */
export function memLintFs(
  files: Record<string, string>,
  symlinks: Record<string, string> = {}
): LintFs {
  const volume = Volume.fromJSON(files);
  for (const [link, target] of Object.entries(symlinks)) {
    volume.mkdirSync(path.dirname(link), { recursive: true });
    volume.symlinkSync(target, link);
  }
  const promises = createFsFromVolume(volume).promises;
  async function listFiles(dir: string): Promise<string[]> {
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = (await promises.readdir(dir, { withFileTypes: true })) as unknown as {
        name: string;
        isDirectory(): boolean;
      }[];
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await listFiles(full)));
      } else {
        out.push(full);
      }
    }
    return out;
  }
  return {
    async readFile(p) {
      return (await promises.readFile(p, "utf8")) as string;
    },
    async readdir(p) {
      return (await promises.readdir(p, { withFileTypes: true })) as unknown as {
        name: string;
        isDirectory(): boolean;
      }[];
    },
    async stat(p) {
      const stat = await promises.stat(p);
      return { isDirectory: () => stat.isDirectory(), isFile: () => stat.isFile() };
    },
    async lstat(p) {
      return promises.lstat(p);
    },
    async realpath(p) {
      return (await promises.realpath(p)) as string;
    },
    listFiles
  };
}

export function packageFiles(
  packageDir: string,
  files: string[]
): { packageDir: string; files: Set<string> } {
  return { packageDir, files: new Set(files) };
}

export function withPackageFiles(
  model: WorkspaceModel,
  entries: [string, { packageDir: string; files: Set<string> }][]
): WorkspaceModel {
  return { ...model, packageFiles: new Map(entries) };
}

export function addWorkflowPublishing(model: WorkspaceModel, targetDirs: string[]): WorkspaceModel {
  return {
    ...model,
    releaseWorkflows: [
      {
        file: "release.yml",
        name: "release",
        targetDirs,
        lockstepGroups: []
      }
    ]
  };
}

export function addRootShipping(model: WorkspaceModel, shippedDirs: string[]): WorkspaceModel {
  return {
    ...model,
    shippedDirs: new Set(shippedDirs)
  };
}

export async function makeWorkspaceWithPackageFiles(
  files: Record<string, string>,
  packageFileEntries: [string, string[]][]
): Promise<WorkspaceModel> {
  const model = await makeWorkspace(files);
  return {
    ...model,
    packageFiles: new Map(
      packageFileEntries.map(([dir, packed]) => [
        dir,
        {
          ...packageFiles(dir, packed),
          allFiles: model.packageFiles.get(dir)?.allFiles
        }
      ])
    )
  };
}

export function fakeDirent(
  name: string,
  directory = false
): { name: string; isDirectory(): boolean } {
  return {
    name,
    isDirectory: () => directory
  };
}

export function runtimeAssetRef(fields: {
  packageDir: string;
  packageName: string;
  sourceFile: string;
  runtimeRelPath: string;
  sourceRelPath?: string;
  kind?: "file" | "directory";
  expression?: string;
  externalPackageRelPath?: string;
}): import("./runtime-files.js").RuntimeFileAssetRef {
  return {
    packageDir: fields.packageDir,
    packageName: fields.packageName,
    sourceFile: fields.sourceFile,
    kind: fields.kind ?? "file",
    sourceRelPath: fields.sourceRelPath,
    runtimeRelPath: fields.runtimeRelPath,
    expression: fields.expression ?? fields.runtimeRelPath,
    inferred: true,
    externalPackageRelPath: fields.externalPackageRelPath
  };
}

export function pkgJson(fields: Record<string, unknown>): string {
  return JSON.stringify(fields, null, 2);
}

/** Build a {@link WorkspaceModel} from an in-memory file map rooted at /repo. */
export function makeWorkspace(files: Record<string, string>): Promise<WorkspaceModel> {
  return loadWorkspace(memLintFs(files), "/repo");
}
