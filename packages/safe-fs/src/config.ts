import type { FileSystem, FileSystemFactory } from "./contracts/filesystem.js";

export type FileSystemConfig = {
  readonly type: string;
  readonly options?: Readonly<Record<string, unknown>>;
};
export type FileSystemAdapterDescriptor = {
  readonly validateOptions: (options: Readonly<Record<string, unknown>>) => void;
  readonly create: FileSystemFactory;
};
export type FileSystemAdapterRegistry = ReadonlyMap<string, FileSystemAdapterDescriptor>;

export function readConfigRecord(
  value: unknown,
  label: string,
  keys?: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain record.`);
  }
  const record: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || (keys !== undefined && !keys.includes(key))) {
      throw new TypeError(`Unknown ${label}: ${String(key)}`);
    }
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in property)) throw new TypeError(`${label}.${key} must be a data property.`);
    record[key] = property.value;
  }
  return Object.freeze(record);
}

export function validateFileSystemConfig(value: unknown): FileSystemConfig {
  const config = readConfigRecord(value, "filesystem config", ["type", "options"]);
  if (typeof config.type !== "string" || config.type.trim().length === 0) {
    throw new TypeError("Filesystem adapter type must be a nonempty string.");
  }
  return {
    type: config.type,
    ...(config.options === undefined
      ? {}
      : { options: readConfigRecord(config.options, "filesystem options") })
  };
}

export async function createFileSystem(
  config: FileSystemConfig,
  options: { registry: FileSystemAdapterRegistry }
): Promise<FileSystem> {
  const validated = validateFileSystemConfig(config);
  const creation = readConfigRecord(options, "filesystem creation option", ["registry"]);
  const registry = creation.registry as FileSystemAdapterRegistry | undefined;
  if (registry === undefined || registry === null || typeof registry.get !== "function") {
    throw new TypeError("registry must be a filesystem adapter map.");
  }
  const descriptor = registry.get(validated.type);
  if (descriptor === undefined)
    throw new TypeError(`Unknown filesystem adapter: ${validated.type}`);
  const adapterOptions = validated.options ?? Object.freeze(Object.create(null));
  descriptor.validateOptions(adapterOptions);
  return await descriptor.create(adapterOptions);
}
