import {
  createFileSystem,
  createNodeFileSystemAdapterRegistry,
  readConfigRecord,
  validateFileSystemConfig,
  type FileSystemAdapterRegistry,
  type FileSystemConfig
} from "@poe-code/safe-fs";
import type { FsModuleOptions } from "./fs.js";

export type FsConfig = {
  readonly adapter: FileSystemConfig;
  readonly root?: string;
  readonly cwd?: string;
};
export type ResolveFsConfigOptions = { readonly registry?: FileSystemAdapterRegistry };

function validateFsConfig(value: unknown): FsConfig {
  const config = readConfigRecord(value, "fs config", ["adapter", "root", "cwd"]);
  const paths: { root?: string; cwd?: string } = {};
  for (const key of ["root", "cwd"] as const) {
    const path = config[key];
    if (path === undefined) continue;
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) {
      throw new TypeError(`${key} must be an absolute virtual path`);
    }
    paths[key] = path;
  }
  return {
    adapter: validateFileSystemConfig(config.adapter),
    ...paths
  };
}

export function parseFsConfig(json: string): FsConfig {
  return validateFsConfig(JSON.parse(json));
}

export async function resolveFsConfig(
  config: FsConfig,
  options: ResolveFsConfigOptions = {}
): Promise<Required<Pick<FsModuleOptions, "adapter">> & Pick<FsModuleOptions, "root" | "cwd">> {
  const { adapter: adapterConfig, ...paths } = validateFsConfig(config);
  const resolution = readConfigRecord(options, "fs resolution option", ["registry"]);
  const registry = createNodeFileSystemAdapterRegistry(
    resolution.registry as FileSystemAdapterRegistry | undefined
  );
  const adapter = await createFileSystem(adapterConfig, { registry });
  return { adapter, ...paths };
}
