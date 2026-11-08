import type { CallerInjectedBinding } from "../interp/host-bridge.js";
import { isSandboxClosure } from "../interp/values.js";
import type { ModuleExports, ModuleRegistry } from "../modules/registry.js";
import type { LintModuleExport, LintModuleExports, Modules } from "./rules/module-registry.js";

const AsyncFunction = (async () => undefined).constructor;

export function createLintModulesFromRuntimeRegistry(modules: ModuleRegistry): Modules {
  const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);

  return new Map(
    entries.map(([moduleName, moduleExports]) => [
      moduleName,
      {
        exports: createLintModuleExports(moduleExports)
      }
    ])
  );
}

function createLintModuleExports(moduleExports: ModuleExports): LintModuleExports {
  const entries =
    moduleExports instanceof Map ? [...moduleExports.entries()] : Object.entries(moduleExports);

  return new Map(
    entries
      .filter(([exportName]) => exportName.length > 0)
      .map(([exportName, value]) => [exportName, createLintModuleExport(value)] as const)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function createLintModuleExport(value: CallerInjectedBinding): LintModuleExport {
  return isAsyncRuntimeExport(value) ? { async: true } : {};
}

function isAsyncRuntimeExport(value: CallerInjectedBinding): boolean {
  if (isSandboxClosure(value)) {
    return value.async === true;
  }

  return typeof value === "function" && value.constructor === AsyncFunction;
}
