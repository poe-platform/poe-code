import { types } from "node:util";
import type { HostObjectDefinition, HostObject } from "./interp/host-capabilities.js";
import type { ModuleRegistry } from "./modules/registry.js";
import type { CallerInjectedBinding } from "./interp/host-bridge.js";

export type CallbackOptions = { thisValue?: unknown; args?: readonly unknown[] };
export type HostOperation = { invoke(...args: readonly any[]): unknown }["invoke"];
export type ExtensionManifest = {
  version: 1;
  name: string;
  capabilities?: readonly string[];
  globals?: readonly string[];
  modules?: Readonly<Record<string, readonly string[]>>;
};
export type ExtensionExports = {
  globals?: Record<string, CallerInjectedBinding>;
  modules?: ModuleRegistry;
};
export type ExtensionContext = {
  readonly signal: AbortSignal;
  onCleanup(cleanup: () => void | Promise<void>): void;
  chargeWork(units?: number): void;
  createHostObject(definition: HostObjectDefinition): HostObject;
  invokeCallback(callback: unknown, options?: CallbackOptions): Promise<unknown>;
  releaseCallback(callback: unknown): void;
  retainGuestArguments<Operation extends HostOperation>(
    operation: Operation,
    from: number
  ): Operation;
  releaseGuestReference(reference: unknown): void;
  nestedOperation<Operation extends HostOperation>(operation: Operation): Operation;
  evaluateNested(source: string): Promise<void>;
};
export type ExtensionDefinition = {
  manifest: ExtensionManifest;
  setup(context: ExtensionContext): ExtensionExports;
};
export type SafeJSExtension = { readonly manifest: Readonly<ExtensionManifest> };

const definitions = new WeakMap<SafeJSExtension, ExtensionDefinition["setup"]>();

export function readDataRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || types.isProxy(value)) {
    throw new TypeError(`${label} must be a plain data record.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError(`${label} must be a plain data record.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 4096) throw new RangeError(`${label} has too many fields.`);
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !("value" in descriptor)) {
      throw new TypeError(`${label} requires string-keyed data properties, not accessors.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

export function readStringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > 4096) {
    throw new TypeError(`${label} must be a bounded string array.`);
  }
  const result: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      descriptor.value.length === 0
    ) {
      throw new TypeError(`${label} requires nonempty string data properties.`);
    }
    if (result.includes(descriptor.value))
      throw new TypeError(`${label} contains a duplicate name.`);
    result.push(descriptor.value);
  }
  if (Reflect.ownKeys(value).length !== result.length + 1)
    throw new TypeError(`${label} has unexpected fields.`);
  return Object.freeze(result);
}

export function defineExtension(definition: ExtensionDefinition): SafeJSExtension {
  const input = readDataRecord(definition, "Extension definition");
  if (Object.keys(input).some((key) => key !== "manifest" && key !== "setup"))
    throw new TypeError("Unknown extension definition field.");
  if (typeof input.setup !== "function") throw new TypeError("Extension setup must be a function.");
  if (types.isAsyncFunction(input.setup))
    throw new TypeError("Extension setup must be synchronous.");
  const manifest = readDataRecord(input.manifest, "Extension manifest");
  if (
    Object.keys(manifest).some(
      (key) => !["version", "name", "capabilities", "globals", "modules"].includes(key)
    )
  )
    throw new TypeError("Unknown extension manifest field.");
  if (manifest.version !== 1) throw new TypeError("Unsupported extension manifest version.");
  if (typeof manifest.name !== "string" || manifest.name.length === 0 || manifest.name.length > 256)
    throw new TypeError("Extension name must be a nonempty bounded string.");
  const modules = Object.create(null) as Record<string, readonly string[]>;
  for (const [name, exports] of Object.entries(
    readDataRecord(manifest.modules ?? {}, "Extension modules")
  )) {
    if (name.length === 0) throw new TypeError("Module names must be nonempty.");
    modules[name] = readStringList(exports, `Module '${name}' exports`);
  }
  const extension = Object.freeze({
    manifest: Object.freeze({
      version: 1 as const,
      name: manifest.name,
      capabilities: readStringList(manifest.capabilities ?? [], "Extension capabilities"),
      globals: readStringList(manifest.globals ?? [], "Extension globals"),
      modules: Object.freeze(modules)
    })
  });
  definitions.set(extension, input.setup as ExtensionDefinition["setup"]);
  return extension;
}

export function getExtensionSetup(extension: SafeJSExtension): ExtensionDefinition["setup"] {
  const setup = definitions.get(extension);
  if (setup === undefined) throw new TypeError("Extensions must be created by defineExtension.");
  return setup;
}
