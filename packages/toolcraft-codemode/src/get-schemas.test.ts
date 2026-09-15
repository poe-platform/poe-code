import { describe, expect, it, vi } from "vitest";
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
  describe.each([false, true])("custom paths with promised entries: %s", (promised) => {
    it.each(["__proto__", "constructor", "toString", "ordinary"])(
      "returns %s as an own serializable property without changing the result prototype",
      async (path) => {
        const handler = vi.fn(async () => null);
        const leaf = defineCommand({
          name: "ordinary",
          description: "Custom path command.",
          params: S.Object({ value: S.String() }),
          handler
        });
        const entries = [{ path, name: path, groupPath: "", sdkPath: ["ordinary"], command: leaf }];
        const command = makeGetSchemasCommand({
          entries: promised ? Promise.resolve(entries) : entries
        });
        const expected = { description: leaf.description, params: toJsonSchema(leaf.params) };

        const result = await command.handler({ params: { names: [path, path] } } as never);

        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(result, path)).toEqual({
          value: expected,
          enumerable: true,
          configurable: true,
          writable: true
        });
        expect(Object.keys(result)).toEqual([path]);
        expect(Object.getOwnPropertyDescriptor(JSON.parse(JSON.stringify(result)), path)?.value)
          .toEqual(expected);
        expect(handler).not.toHaveBeenCalled();
      }
    );

    it("retains special paths alongside ordinary paths across repeated requests", async () => {
      const paths = ["ordinary", "__proto__", "constructor", "toString"];
      const entries = paths.map((path) => ({
        path,
        name: path,
        groupPath: "",
        sdkPath: ["ordinary"],
        command: fixtureCommand("ordinary", `Description for ${path}.`)
      }));
      const command = makeGetSchemasCommand({
        entries: promised ? Promise.resolve(entries) : entries
      });

      for (const names of [paths, [...paths].reverse()]) {
        const result = await command.handler({ params: { names } } as never);

        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect(Object.keys(result)).toEqual(names);
        for (const path of names) {
          expect(Object.getOwnPropertyDescriptor(result, path)?.value.description)
            .toBe(`Description for ${path}.`);
        }
      }
    });

    it("does not mistake inherited object members for registered paths", async () => {
      const command = makeGetSchemasCommand({
        entries: promised ? Promise.resolve([]) : []
      });

      await expect(command.handler({ params: { names: ["__proto__", "toString"] } } as never))
        .rejects.toThrow("Unknown command path(s): __proto__, toString");
    });
  });

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
