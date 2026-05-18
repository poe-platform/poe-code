import { defineCommand, type Scope, UserError } from "toolcraft";
import { S, toJsonSchema, type JsonSchema } from "toolcraft-schema";

import { resolveCommandEntries, type CommandEntry, type CommandEntryList } from "./tree.js";

export type GetSchemasCommandOptions = {
  entries: CommandEntryList;
  scope?: Scope[];
};

export type GetSchemasResult = Record<
  string,
  {
    description: string;
    params: JsonSchema;
  }
>;

const getSchemasParams = S.Object({
  names: S.Array(S.String({ description: "Dotted command path." }), {
    description: "Dotted command paths to fetch schemas for."
  })
});

function indexEntriesByPath(entries: CommandEntry[]): Map<string, CommandEntry> {
  const entriesByPath = new Map<string, CommandEntry>();

  for (const entry of entries) {
    entriesByPath.set(entry.path, entry);
  }

  return entriesByPath;
}

export function makeGetSchemasCommand({
  entries,
  scope = ["mcp", "sdk"]
}: GetSchemasCommandOptions) {
  let entriesByPathPromise: Promise<Map<string, CommandEntry>> | undefined;

  return defineCommand({
    name: "get_schemas",
    description: "Get params schemas for commands by path.",
    scope,
    params: getSchemasParams,
    handler: async ({ params }): Promise<GetSchemasResult> => {
      entriesByPathPromise ??= resolveCommandEntries(entries).then(indexEntriesByPath);
      const entriesByPath = await entriesByPathPromise;
      const missingNames = new Set<string>();
      const result: GetSchemasResult = {};

      for (const name of params.names) {
        const entry = entriesByPath.get(name);

        if (entry === undefined) {
          missingNames.add(name);
          continue;
        }

        result[name] = {
          description: entry.command.description ?? "",
          params: toJsonSchema(entry.command.params as Parameters<typeof toJsonSchema>[0])
        };
      }

      if (missingNames.size > 0) {
        throw new UserError(`Unknown command path(s): ${[...missingNames].join(", ")}`);
      }

      return result;
    }
  });
}
