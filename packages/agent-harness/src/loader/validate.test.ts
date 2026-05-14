import { describe, expect, expectTypeOf, it } from "vitest";
import { S } from "toolcraft-schema";

import * as api from "../index.js";
import { FrontmatterValidationError, validateFrontmatter } from "./validate.js";

describe("validateFrontmatter", () => {
  it("is re-exported from the package entrypoint", () => {
    expect(api.validateFrontmatter).toBe(validateFrontmatter);
    expect(api.FrontmatterValidationError).toBe(FrontmatterValidationError);
  });

  it("returns validated frontmatter with defaults applied", () => {
    const schema = S.Object({
      title: S.String(),
      retries: S.Optional(S.Number({ default: 2 }))
    });

    const result = validateFrontmatter(schema, { title: "Build" }, "docs/plans/build.md");

    expect(result).toEqual({
      title: "Build",
      retries: 2
    });
    expectTypeOf(result).toEqualTypeOf<{
      title: string;
      retries?: number;
    }>();
  });

  it("throws a formatted error for a single issue", () => {
    const schema = S.Object({
      title: S.String()
    });

    expect(() => validateFrontmatter(schema, { title: 123 }, "docs/plans/build.md")).toThrow(
      new FrontmatterValidationError(
        "docs/plans/build.md (title): Expected string at title, got integer",
        [
          {
            path: ["title"],
            expected: "string",
            received: "integer",
            message: "Expected string at title, got integer"
          }
        ]
      )
    );
  });

  it("throws a formatted error with one line per issue", () => {
    const schema = S.Object({
      title: S.String(),
      retries: S.Number({ minimum: 1 })
    });

    expect(() =>
      validateFrontmatter(
        schema,
        {
          title: 123,
          retries: 0
        },
        "docs/plans/build.md"
      )
    ).toThrow(
      [
        "docs/plans/build.md (title): Expected string at title, got integer",
        "docs/plans/build.md (retries): Expected number greater than or equal to 1 at retries, got 0"
      ].join("\n")
    );
  });

  it("formats nested and array issue paths as dotted paths", () => {
    const schema = S.Object({
      jobs: S.Array(
        S.Object({
          title: S.String()
        })
      )
    });

    expect(() =>
      validateFrontmatter(schema, { jobs: [{ title: "Build" }, { title: 123 }] }, "jobs.md")
    ).toThrow("jobs.md (jobs.1.title): Expected string at jobs.1.title, got integer");
  });

  it("formats an empty issue path as frontmatter", () => {
    const schema = S.Object({
      title: S.String()
    });

    expect(() =>
      validateFrontmatter(schema, [] as unknown as Record<string, unknown>, "jobs.md")
    ).toThrow("jobs.md (frontmatter): Expected object at value, got array");
  });

  it("exposes the original issues on the error", () => {
    const schema = S.Object({
      title: S.String(),
      retries: S.Number({ minimum: 1 })
    });

    try {
      validateFrontmatter(schema, { title: 123, retries: 0 }, "docs/plans/build.md");
    } catch (error) {
      expect(error).toBeInstanceOf(FrontmatterValidationError);
      expect((error as FrontmatterValidationError).issues).toEqual([
        {
          path: ["title"],
          expected: "string",
          received: "integer",
          message: "Expected string at title, got integer"
        },
        {
          path: ["retries"],
          expected: "number greater than or equal to 1",
          received: "0",
          message: "Expected number greater than or equal to 1 at retries, got 0"
        }
      ]);
      return;
    }

    throw new Error("Expected validateFrontmatter to throw.");
  });

  it("rejects empty frontmatter when required fields are missing", () => {
    const schema = S.Object({
      title: S.String(),
      owner: S.String()
    });

    expect(() => validateFrontmatter(schema, {}, "docs/plans/build.md")).toThrow(
      [
        "docs/plans/build.md (title): Expected string at title, got missing",
        "docs/plans/build.md (owner): Expected string at owner, got missing"
      ].join("\n")
    );
  });
});
