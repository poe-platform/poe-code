import type { Command, Group } from "toolcraft";
import { resolveMcpProxies, type ResolveMcpProxyOptions } from "toolcraft/mcp-proxy";

export type CommandEntry = {
  path: string;
  groupPath: string;
  name: string;
  sdkPath: string[];
  command: Command;
};

export type CommandTree = {
  entries: CommandEntry[];
  exportsByGroupPath: Map<string, string[]>;
};

export type CommandEntryList = CommandEntry[] | Promise<CommandEntry[]>;

export type ResolveCommandTreeOptions = ResolveMcpProxyOptions;

export async function resolveCommandEntries(entries: CommandEntryList): Promise<CommandEntry[]> {
  return entries;
}

type Separator = "-" | "_" | " " | ".";

function isSeparator(character: string): character is Separator {
  return character === "-" || character === "_" || character === " " || character === ".";
}

function splitWords(value: string): string[] {
  const words: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    const lower = character.toLowerCase();
    const upper = character.toUpperCase();

    if (isSeparator(character)) {
      if (current.length > 0) {
        words.push(current.toLowerCase());
        current = "";
      }
      continue;
    }

    const isUppercase = character !== lower && character === upper;
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
      current = character;
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    words.push(current.toLowerCase());
  }

  return words;
}

export function formatSdkSegment(segment: string): string {
  return splitWords(segment)
    .map((word, index) => (index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join("");
}

export function formatModuleSegment(segment: string): string {
  return splitWords(segment).join("_");
}

function formatNamedModuleSegment(segment: string, kind: "command" | "group"): string {
  const formatted = formatModuleSegment(segment);

  if (formatted.length === 0) {
    throw new Error(
      `Codemode ${kind} name "${segment}" must include at least one non-separator character.`
    );
  }

  return formatted;
}

function commandIsExecutable(command: Command): boolean {
  return command.scope.includes("sdk");
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
  root: Group<any>,
  options: ResolveCommandTreeOptions = {}
): Promise<CommandTree> {
  await resolveMcpProxies(root, options);

  const entries: CommandEntry[] = [];
  const exportsByGroupPath = new Map<string, string[]>();
  const paths = new Set<string>();

  function visit(group: Group, groupSegments: string[]): void {
    const groupPath = groupSegments
      .map((segment) => formatNamedModuleSegment(segment, "group"))
      .join(".");

    for (const child of group.children) {
      if (child.kind === "group") {
        visit(child, [...groupSegments, child.name]);
        continue;
      }

      if (!commandIsExecutable(child)) {
        continue;
      }

      const name = formatNamedModuleSegment(child.name, "command");
      const path = groupPath.length === 0 ? name : `${groupPath}.${name}`;
      if (paths.has(path)) {
        throw new Error(`Duplicate codemode command path "${path}".`);
      }

      paths.add(path);

      entries.push({
        path,
        groupPath,
        name,
        sdkPath: [...groupSegments, child.name].map(formatSdkSegment),
        command: child
      });
      addExport(exportsByGroupPath, groupPath, name);
    }
  }

  visit(root, []);

  return {
    entries,
    exportsByGroupPath
  };
}
