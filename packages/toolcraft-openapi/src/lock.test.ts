import { describe, expect, it, vi } from "vitest";
import { UserError } from "toolcraft";
import { readOpenApiLock, writeOpenApiLock } from "./lock.js";

describe("OpenAPI lock files", () => {
  it("throws a user-facing error when the lock file is corrupt", async () => {
    const promise = readOpenApiLock(
      {
        readFile: async () => "{\n,"
      },
      "/repo/openapi.lock"
    );

    await expect(promise).rejects.toThrow('Lock file "/repo/openapi.lock" is not valid JSON');
    await expect(promise).rejects.toThrow("line 2 column 1");
    await expect(promise).rejects.toThrow("Expected property name");
  });

  it("preserves the parser error as the corrupt lock cause", async () => {
    await expect(
      readOpenApiLock(
        {
          readFile: async () => "{\n,"
        },
        "/repo/openapi.lock"
      )
    ).rejects.toMatchObject({
      cause: expect.any(SyntaxError)
    });
  });

  it("wraps lock write failures with the path and error code", async () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES"
    });
    const fs = {
      mkdir: vi.fn(async () => undefined),
      readFile: vi.fn(),
      writeFile: vi.fn(async () => {
        throw error;
      })
    };

    const promise = writeOpenApiLock(fs, "/repo/openapi.lock", {
      specSha: "sha256:abc"
    });

    await expect(promise).rejects.toThrow(
      'Failed to write lock file "/repo/openapi.lock" (EACCES): permission denied'
    );
    await expect(promise).rejects.toBeInstanceOf(UserError);
  });
});
