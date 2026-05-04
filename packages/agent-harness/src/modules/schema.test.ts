import { lint, run } from "@poe-code/agent-script";
import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";

import * as api from "../index.js";
import { makeSchemaModule } from "./schema.js";

describe("makeSchemaModule", () => {
  it("is re-exported from the package entrypoint", () => {
    expect(api.makeSchemaModule).toBe(makeSchemaModule);
  });

  it("round-trips schema builders through agent-script run()", async () => {
    const result = await run('import { S } from "schema"; return S.Object({ x: S.Number() });', {
      modules: {
        schema: makeSchemaModule()
      }
    });

    expect(result).toMatchObject({
      ok: true,
      returnValue: S.Object({ x: S.Number() })
    });
  });

  it("registers its export list with agent-script lint()", () => {
    expect(
      lint('import { S } from "schema"; return S.Object({ x: S.Number() });', {
        modules: {
          schema: Object.keys(makeSchemaModule())
        }
      })
    ).toEqual([]);
  });
});
