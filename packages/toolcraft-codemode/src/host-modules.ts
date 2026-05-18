import type { Group } from "toolcraft";

import { resolveCommandTree } from "./tree.js";

export type HostModuleFunction = (params: unknown) => Promise<unknown>;
export type HostModules = Record<string, Record<string, HostModuleFunction>>;
export type HostLintModules = Record<string, string[]>;

export interface BuildHostModulesResult {
  modules: HostModules;
  lintModules: HostLintModules;
}

type Separator = "-" | "_" | " " | ".";

function isSeparator(char: string): char is Separator {
  return char === "-" || char === "_" || char === " " || char === ".";
}

function splitWords(value: string): string[] {
  const words: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();

    if (isSeparator(char)) {
      if (current.length > 0) {
        words.push(current.toLowerCase());
        current = "";
      }
      continue;
    }

    const isUppercase = char !== lower && char === upper;
    const previous = value[index - 1];
    const next = value[index + 1];
    const previousIsLowercase =
      previous !== undefined &&
      previous === previous.toLowerCase() &&
      previous !== previous.toUpperCase();
    const nextIsLowercase =
      next !== undefined && next === next.toLowerCase() && next !== next.toUpperCase();

    if (isUppercase && current.length > 0 && (previousIsLowercase || nextIsLowercase)) {
      words.push(current.toLowerCase());
      current = char;
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    words.push(current.toLowerCase());
  }

  return words;
}

function formatSdkSegment(segment: string): string {
  return splitWords(segment)
    .map((word, index) => (index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join("");
}

function formatModuleSegment(segment: string): string {
  return splitWords(segment).join("_");
}

function formatModulePath(path: string): string {
  return path
    .split(".")
    .map((segment) => formatModuleSegment(segment))
    .join(".");
}

function getModuleName(root: Group, groupPath: string): string {
  return formatModulePath(groupPath.length === 0 ? root.name : groupPath);
}

function getOrCreateModule(modules: HostModules, moduleName: string): Record<string, HostModuleFunction> {
  modules[moduleName] ??= {};
  return modules[moduleName];
}

function getOrCreateLintModule(lintModules: HostLintModules, moduleName: string): string[] {
  lintModules[moduleName] ??= [];
  return lintModules[moduleName];
}

function resolveSdkMember(sdk: Record<string, unknown>, path: string): unknown {
  let current: unknown = sdk;

  for (const segment of path.split(".")) {
    if (typeof current !== "object" && typeof current !== "function") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[formatSdkSegment(segment)];
  }

  return current;
}

function createHostFunction(sdk: Record<string, unknown>, path: string): HostModuleFunction {
  return async (params: unknown) => {
    const sdkMember = resolveSdkMember(sdk, path);

    if (typeof sdkMember !== "function") {
      throw new TypeError(`SDK member "${path}" is not callable.`);
    }

    return sdkMember(params);
  };
}

export async function buildHostModules(
  root: Group,
  sdk: Record<string, unknown>
): Promise<BuildHostModulesResult> {
  const tree = await resolveCommandTree(root);
  const modules: HostModules = {};
  const lintModules: HostLintModules = {};

  for (const entry of tree.entries) {
    const moduleName = getModuleName(root, entry.groupPath);
    const module = getOrCreateModule(modules, moduleName);
    const lintModule = getOrCreateLintModule(lintModules, moduleName);

    module[entry.name] = createHostFunction(sdk, entry.path);
    lintModule.push(entry.name);
  }

  return {
    modules,
    lintModules
  };
}
