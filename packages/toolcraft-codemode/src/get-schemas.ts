import { defineCommand, UserError } from "toolcraft";
import { S, toJsonSchema, type JsonSchema } from "toolcraft-schema";

import type { CommandEntry } from "./tree.js";

export type GetSchemasCommandOptions = {
  entries: CommandEntry[];
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

export function makeGetSchemasCommand({ entries }: GetSchemasCommandOptions) {
  const entriesByPath = indexEntriesByPath(entries);

  return defineCommand({
    name: "get_schemas",
    description: "Get params schemas for commands by path.",
    scope: ["mcp", "sdk"],
    params: getSchemasParams,
    handler: async ({ params }): Promise<GetSchemasResult> => {
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
