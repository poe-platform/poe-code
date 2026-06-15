import { describe, expect, it } from "vitest";
import { defineCommand, defineGroup, UserError } from "toolcraft";
import { S, toJsonSchema } from "toolcraft-schema";

import { makeGetSchemasCommand } from "./get-schemas.js";
import { resolveCommandTree } from "./tree.js";

function fixtureCommand(name: string, description: string) {
  return defineCommand({
    name,
    description,
    scope: ["sdk"],
    params: S.Object({
      assignee: S.Optional(S.String({ description: "GitHub login to filter by." })),
      labels: S.Array(S.String({ description: "Label name." }), {
        description: "Labels that must be present."
      }),
      state: S.Enum(["open", "closed"] as const, {
        description: "Issue state.",
        default: "open"
      })
    }),
    handler: async () => null
  });
}

async function fixtureEntries() {
  const root = defineGroup({
    name: "root",
    children: [
      defineGroup({
        name: "issues",
        children: [fixtureCommand("list", "List matching issues.")]
      }),
      defineGroup({
        name: "pulls",
        children: [fixtureCommand("review", "Review a pull request.")]
      })
    ]
  });

  return (await resolveCommandTree(root)).entries;
}

describe("makeGetSchemasCommand", () => {
  it("defines the get_schemas command with required names params", async () => {
    const command = makeGetSchemasCommand({
      entries: await fixtureEntries()
    });

    expect(command.name).toBe("get_schemas");
    expect(toJsonSchema(command.params)).toEqual({
      type: "object",
      properties: {
        names: {
          description: "Dotted command paths to fetch schemas for.",
          type: "array",
          items: {
            description: "Dotted command path.",
            type: "string"
          }
        }
      },
      required: ["names"],
      additionalProperties: false
    });
  });

  it("returns a requested command description and params schema", async () => {
    const command = makeGetSchemasCommand({
      entries: await fixtureEntries()
    });

    const result = await command.handler({ params: { names: ["issues.list"] } } as never);

    expect(result).toMatchSnapshot("issues list schema");
  });

  it("throws a UserError that lists only unknown names", async () => {
    const command = makeGetSchemasCommand({
      entries: await fixtureEntries()
    });
    const thrown = await command
      .handler({
        params: {
          names: ["issues.list", "issues.missing", "pulls.unknown"]
        }
      } as never)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(UserError);
    expect((thrown as Error).message).toBe(
      "Unknown command path(s): issues.missing, pulls.unknown"
    );
  });

  it("returns an empty record when no names are requested", async () => {
    const command = makeGetSchemasCommand({
      entries: await fixtureEntries()
    });

    await expect(command.handler({ params: { names: [] } } as never)).resolves.toEqual({});
  });

  it("lists duplicate unknown paths once", async () => {
    const command = makeGetSchemasCommand({
      entries: await fixtureEntries()
    });
    const thrown = await command
      .handler({
        params: {
          names: ["issues.missing", "issues.missing", "pulls.unknown"]
        }
      } as never)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(UserError);
    expect((thrown as Error).message).toBe(
      "Unknown command path(s): issues.missing, pulls.unknown"
    );
  });
});
