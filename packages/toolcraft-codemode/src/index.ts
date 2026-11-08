import { defineGroup, type Group, type Scope } from "toolcraft";
import { createSDK, mergeApprovalsRoot, type CreateSDKOptions } from "toolcraft/sdk";

import { makeExecuteCommand, type ExecuteBudgetOptions } from "./execute.js";
import { makeGetSchemasCommand } from "./get-schemas.js";
import { makeSearchCommand, type SearchDetail } from "./search.js";
import { resolveCommandTree, type CommandEntryList } from "./tree.js";

export type CodeModeCommandOptions = {
  scope?: Scope[];
};

export type CodeModeOptions<TServices extends object = Record<string, unknown>> =
  CreateSDKOptions<TServices> & {
    budget?: ExecuteBudgetOptions;
    search?: CodeModeCommandOptions & {
      defaultDetail?: SearchDetail;
      defaultLimit?: number;
    };
    getSchemas?: CodeModeCommandOptions;
    execute?: CodeModeCommandOptions;
  };

function makeSearchDefaults(options: CodeModeOptions["search"]) {
  return {
    detail: options?.defaultDetail,
    limit: options?.defaultLimit
  };
}

export function codeMode<TServices extends object = Record<string, unknown>>(
  root: Group<TServices>,
  options: CodeModeOptions<TServices> = {}
) {
  const { budget, search, getSchemas, execute, ...sdkOptions } = options;
  const effectiveRoot = mergeApprovalsRoot(root, sdkOptions);
  const sdk = createSDK(
    effectiveRoot as Group<any> & { readonly __agentKitGroupTypeInfo: unknown },
    { ...sdkOptions, approvals: false }
  );
  const entries: CommandEntryList = resolveCommandTree(effectiveRoot, {
    projectRoot: options.projectRoot
  }).then((tree) => tree.entries);
  void entries.catch(() => undefined);

  return defineGroup({
    name: "code_mode",
    scope: ["mcp", "sdk"],
    children: [
      makeSearchCommand({
        entries,
        defaults: makeSearchDefaults(search),
        scope: search?.scope
      }),
      makeGetSchemasCommand({
        entries,
        scope: getSchemas?.scope
      }),
      makeExecuteCommand({
        root: effectiveRoot,
        sdk,
        entries,
        budget,
        scope: execute?.scope
      })
    ]
  });
}

export {
  makeExecuteCommand,
  type ExecuteBudgetOptions,
  type ExecuteCommandOptions,
  type ExecuteResult,
  type ExecuteRuntimeError,
  type ExecuteSink
} from "./execute.js";
export {
  makeGetSchemasCommand,
  type GetSchemasCommandOptions,
  type GetSchemasResult
} from "./get-schemas.js";
export {
  buildHostModules,
  type BuildHostModulesResult,
  type HostLintModules,
  type HostModuleFunction,
  type HostModules
} from "./host-modules.js";
export {
  makeSearchCommand,
  type SearchCommandOptions,
  type SearchDefaults,
  type SearchDetail,
  type SearchResult
} from "./search.js";
export {
  resolveCommandTree,
  type CommandEntry,
  type CommandEntryList,
  type CommandTree,
  type ResolveCommandTreeOptions
} from "./tree.js";
export type { CreateSDKOptions };
