import type { Group } from "toolcraft";

import {
  formatModuleSegment,
  resolveCommandEntries,
  resolveCommandTree,
  type CommandEntry,
  type CommandEntryList
} from "./tree.js";

export type HostModuleFunction = (params: unknown) => Promise<unknown>;
export type HostModules = Record<string, Record<string, HostModuleFunction>>;
export type HostLintModules = Record<string, string[]>;

export interface BuildHostModulesResult {
  modules: HostModules;
  lintModules: HostLintModules;
}

function getModuleName(root: Group<any>, groupPath: string): string {
  return groupPath.length === 0 ? formatModuleSegment(root.name) : groupPath;
}

function getOrCreateModule(
  modules: HostModules,
  moduleName: string
): Record<string, HostModuleFunction> {
  modules[moduleName] ??= Object.create(null) as Record<string, HostModuleFunction>;
  return modules[moduleName];
}

function getOrCreateLintModule(lintModules: HostLintModules, moduleName: string): string[] {
  lintModules[moduleName] ??= [];
  return lintModules[moduleName];
}

function resolveSdkMember(sdk: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = sdk;

  for (const segment of path) {
    if (typeof current !== "object" && typeof current !== "function") {
      return undefined;
    }

    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function createHostFunction(sdk: Record<string, unknown>, entry: CommandEntry): HostModuleFunction {
  return async (params: unknown) => {
    const sdkMember = resolveSdkMember(sdk, entry.sdkPath);

    if (typeof sdkMember !== "function") {
      throw new TypeError(`SDK member "${entry.path}" is not callable.`);
    }

    return sdkMember(params);
  };
}

export async function buildHostModules(
  root: Group<any>,
  sdk: Record<string, unknown>,
  entries?: CommandEntryList
): Promise<BuildHostModulesResult> {
  const resolvedEntries: CommandEntry[] =
    entries === undefined
      ? (await resolveCommandTree(root)).entries
      : await resolveCommandEntries(entries);
  const modules = Object.create(null) as HostModules;
  const lintModules = Object.create(null) as HostLintModules;

  for (const entry of resolvedEntries) {
    const moduleName = getModuleName(root, entry.groupPath);
    const module = getOrCreateModule(modules, moduleName);
    const lintModule = getOrCreateLintModule(lintModules, moduleName);

    Object.defineProperty(module, entry.name, {
      configurable: true,
      enumerable: true,
      value: createHostFunction(sdk, entry),
      writable: true
    });
    lintModule.push(entry.name);
  }

  return {
    modules,
    lintModules
  };
}
