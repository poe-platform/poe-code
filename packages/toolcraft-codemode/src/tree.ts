import type { Command, Group } from "toolcraft";
import { resolveMcpProxies, type ResolveMcpProxyOptions } from "toolcraft/mcp-proxy";

export type CommandEntry = {
  path: string;
  groupPath: string;
  name: string;
  command: Command;
};

export type CommandTree = {
  entries: CommandEntry[];
  exportsByGroupPath: Map<string, string[]>;
};

export type ResolveCommandTreeOptions = ResolveMcpProxyOptions;

function commandIsProgrammatic(command: Command): boolean {
  return command.scope.includes("mcp") || command.scope.includes("sdk");
}

function addExport(
  exportsByGroupPath: Map<string, string[]>,
  groupPath: string,
  exportName: string
): void {
  const exportNames = exportsByGroupPath.get(groupPath);

  if (exportNames === undefined) {
    exportsByGroupPath.set(groupPath, [exportName]);
    return;
  }

  exportNames.push(exportName);
}

export async function resolveCommandTree(
  root: Group,
  options: ResolveCommandTreeOptions = {}
): Promise<CommandTree> {
  await resolveMcpProxies(root, options);

  const entries: CommandEntry[] = [];
  const exportsByGroupPath = new Map<string, string[]>();

  function visit(group: Group, groupSegments: string[]): void {
    const groupPath = groupSegments.join(".");

    for (const child of group.children) {
      if (child.kind === "group") {
        visit(child, [...groupSegments, child.name]);
        continue;
      }

      if (!commandIsProgrammatic(child)) {
        continue;
      }

      entries.push({
        path: [...groupSegments, child.name].join("."),
        groupPath,
        name: child.name,
        command: child
      });
      addExport(exportsByGroupPath, groupPath, child.name);
    }
  }

  visit(root, []);

  return {
    entries,
    exportsByGroupPath
  };
}
