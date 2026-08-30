import { describe, expect, it } from "vitest";

import { Budget } from "../interp/budget.js";
import { parseModule } from "../parse/parser.js";
import { resolveModuleImports } from "./registry.js";

describe("resolveModuleImports", () => {
  it("allows imported locals that match Object.prototype property names", () => {
    const module = parseModule(
      'import { value as toString } from "api"; import { other as constructor } from "api";'
    );

    expect(
      resolveModuleImports(
        module,
        {
          api: {
            other: 2,
            value: 1
          }
        },
        { budget: new Budget() }
      )
    ).toMatchObject({
      constructor: 2,
      toString: 1
    });
  });

  it("stores imported locals on a null-prototype binding record", () => {
    const module = parseModule('import { value as __proto__ } from "api";');
    const bindings = resolveModuleImports(
      module,
      {
        api: {
          value: 7
        }
      },
      { budget: new Budget() }
    );

    expect(Object.getPrototypeOf(bindings)).toBeNull();
    expect(Object.hasOwn(bindings, "__proto__")).toBe(true);
    expect(bindings.__proto__).toBe(7);
  });

  it("builds namespace imports without inherited object members", () => {
    const module = parseModule('import * as api from "tools";');
    const bindings = resolveModuleImports(
      module,
      {
        tools: {
          value: 3
        }
      },
      { budget: new Budget() }
    );

    expect(Object.getPrototypeOf(bindings.api as object)).toBeNull();
    expect((bindings.api as Record<string, unknown>).value).toBe(3);
    expect((bindings.api as Record<string, unknown>).toString).toBeUndefined();
  });

  it("reports the empty-export case with the lint-style message", () => {
    const module = parseModule('import { value } from "empty";');

    expect(() =>
      resolveModuleImports(
        module,
        {
          empty: {}
        },
        { budget: new Budget() }
      )
    ).toThrow("Module 'empty' does not export 'value'. The module exports nothing.");
  });
});
