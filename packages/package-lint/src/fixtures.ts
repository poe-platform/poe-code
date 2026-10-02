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
    isTest: false,
    externalPackageRelPath: fields.externalPackageRelPath
  };
}

export function pkgJson(fields: Record<string, unknown>): string {
  return JSON.stringify(fields, null, 2);
}

export function canonicalBundleFixture() {
  const source = "packages/safe-fs/src/index.ts";
  const entry = "dist/shared/safe-js/safe-fs.js";
  const chunk = "dist/shared/safe-js/chunks/fs.js";
  const types = "dist/types/safe-fs/index.d.ts";
  const manifest = {
    name: "poe-code",
    exports: {
      "./safe-js": {
        types: { workerd: "./dist/types/safe-js/workerd.d.ts",
          browser: "./dist/types/safe-fs/node-unavailable.d.ts",
          default: "./dist/types/safe-js/index.d.ts"
        },
        workerd: "./packages/safe-js/dist/workerd.js",
        browser: null,
        import: "./dist/shared/safe-js/index.js"
      },
      "./safe-js/core": {
        types: { workerd: "./dist/types/safe-js/workerd.d.ts",
          browser: "./dist/types/safe-js/core.d.ts",
          default: "./dist/types/safe-js/core.d.ts"
        },
        workerd: "./packages/safe-js/dist/workerd.js",
        browser: "./packages/safe-js/dist/core.js",
        import: "./dist/shared/safe-js/core.js"
      },
      "./safe-js/cli": {
        types: {
          browser: "./dist/types/safe-fs/node-unavailable.d.ts",
          default: "./dist/types/safe-js/cli.d.ts"
        },
        browser: null,
        import: "./dist/shared/safe-js/cli.js"
      },
      "./safejs": {
        types: { workerd: "./dist/types/safe-js/workerd.d.ts",
          browser: "./dist/types/safe-fs/node-unavailable.d.ts",
          default: "./dist/types/safe-js/index.d.ts"
        },
        workerd: "./packages/safe-js/dist/workerd.js",
        browser: null,
        import: "./dist/shared/safe-js/index.js"
      },
      "./safejs/core": {
        types: { workerd: "./dist/types/safe-js/workerd.d.ts",
          browser: "./dist/types/safe-js/core.d.ts",
          default: "./dist/types/safe-js/core.d.ts"
        },
        workerd: "./packages/safe-js/dist/workerd.js",
        browser: "./packages/safe-js/dist/core.js",
        import: "./dist/shared/safe-js/core.js"
      },
      "./safejs/cli": {
        types: {
          browser: "./dist/types/safe-fs/node-unavailable.d.ts",
          default: "./dist/types/safe-js/cli.d.ts"
        },
        browser: null,
        import: "./dist/shared/safe-js/cli.js"
      },
      "./safe-fs": {
        types: { workerd: "./dist/types/safe-fs/core.d.ts", browser: "./dist/types/safe-fs/core.d.ts", default: `./${types}` },
        workerd: "./dist/shared/safe-js/browser/safe-fs.js",
        browser: "./dist/shared/safe-js/browser/safe-fs.js",
        import: `./${entry}`
      },
      "./safe-fs/core": {
        types: { workerd: "./dist/types/safe-fs/core.d.ts",
          browser: "./dist/types/safe-fs/core.d.ts",
          default: "./dist/types/safe-fs/core.d.ts"
        },
        workerd: "./dist/shared/safe-js/browser/safe-fs-core.js",
        browser: "./dist/shared/safe-js/browser/safe-fs-core.js",
        import: "./dist/shared/safe-js/safe-fs-core.js"
      },
      "./safe-fs/node": {
        types: { workerd: "./dist/types/safe-fs/node-unavailable.d.ts",
          browser: "./dist/types/safe-fs/node-unavailable.d.ts",
          default: "./dist/types/safe-fs/node-host.d.ts"
        },
        workerd: null,
        browser: null,
        import: "./dist/shared/safe-js/safe-fs-node.js"
      },
      "./safe-fs/node/filesystem": {
        types: { workerd: "./dist/types/safe-fs/node-unavailable.d.ts",
          browser: "./dist/types/safe-fs/node-unavailable.d.ts",
          default: "./dist/types/safe-fs/node/filesystem.d.ts"
        },
        workerd: null,
        browser: null,
        import: "./dist/shared/safe-js/safe-fs-bridge.js"
      }
    },
    imports: {
      "#safe-fs-platform": {
        types: {
          workerd: "./dist/types/safe-fs/platform/browser.d.ts",
          browser: "./dist/types/safe-fs/platform/browser.d.ts",
          default: "./dist/types/safe-fs/platform/node.d.ts"
        },
        default: null
      }
    },
    files: ["dist", "dist/types/safe-js", "dist/types/safe-fs/**/*.d.ts"],
    dependencies: { jose: "*" },
    optionalDependencies: { "optional-sdk": "*" }
  };
  function graph(profile: "node" | "browser") {
    const directory = profile === "node" ? "dist/shared/safe-js" : "dist/shared/safe-js/browser";
    const sources =
      profile === "node"
        ? {
            "safe-fs": source,
            "safe-fs-core": "packages/safe-fs/src/core.ts",
            "safe-fs-node": "packages/safe-fs/src/node-host.ts",
            "safe-fs-bridge": "packages/safe-fs/src/node/filesystem.ts"
          }
        : {
            "safe-fs": "packages/safe-fs/src/core.ts",
            "safe-fs-core": "packages/safe-fs/src/core.ts"
          };
    const policy = `packages/safe-fs/src/platform/${profile}.ts`;
    const shared = `${directory}/chunks/fs.js`;
    const outputs: Record<
      string,
      {
        entryPoint?: string;
        imports: { path: string; external?: boolean }[];
        inputs: Record<string, unknown>;
      }
    > = {};
    for (const [name, input] of Object.entries(sources)) {
      outputs[`${directory}/${name}.js`] = {
        entryPoint: input,
        imports: [{ path: shared }],
        inputs: {}
      };
      outputs[`${directory}/${name}.js.map`] = { imports: [], inputs: {} };
    }
    outputs[shared] = {
      imports: profile === "node" ? [{ path: "node:fs", external: true }] : [],
      inputs: { [policy]: {} }
    };
    outputs[`${shared}.map`] = { imports: [], inputs: {} };
    return {
      entryPoints: Object.values(sources),
      metafile: {
        inputs: Object.fromEntries([...Object.values(sources), policy].map((input) => [input, {}])),
        outputs
      }
    };
  }
  const metafile = {
    inputs: { "src/index.ts": {} } as Record<string, unknown>,
    outputs: {
      "dist/index.js": {
        imports: [{ path: "poe-code/safe-fs", external: true, kind: "import-statement" }]
      }
    },
    canonicalBundle: graph("node"),
    browserCanonicalBundle: graph("browser"),
    canonicalEmptyTypes: ["dist/types/safe-fs/node-unavailable.d.ts"],
    canonicalTypes: {
      [types]: ["./core.js"],
      "dist/types/safe-fs/core.d.ts": ["./contracts/errors.js"],
      "dist/types/safe-fs/node-host.d.ts": ["./index.js"],
      "dist/types/safe-fs/node/filesystem.d.ts": ["../core.js"],
      "dist/types/safe-fs/node-unavailable.d.ts": [],
      "dist/types/safe-fs/contracts/errors.d.ts": ["#safe-fs-platform"],
      "dist/types/safe-fs/platform/node.d.ts": ["node:util"],
      "dist/types/safe-fs/platform/browser.d.ts": []
    } as Record<string, string[]>
  };
  const packed = new Set([
    ...Object.keys(metafile.canonicalBundle.metafile.outputs),
    ...Object.keys(metafile.browserCanonicalBundle.metafile.outputs),
    ...Object.keys(metafile.canonicalTypes)
  ]);
  return { manifest, metafile, packed, source, entry, chunk, types };
}

/** Build a {@link WorkspaceModel} from an in-memory file map rooted at /repo. */
export function makeWorkspace(files: Record<string, string>): Promise<WorkspaceModel> {
  return loadWorkspace(memLintFs(files), "/repo");
}
