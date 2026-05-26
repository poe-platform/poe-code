# Toolcraft OpenAPI mock accepts undeclared request fields in closed object schemas

## Summary

The published `toolcraft-openapi/mock` `mockFetch()` API validates JSON request bodies against object schemas, but it ignores `additionalProperties: false`. An operation whose request body explicitly permits only `name` still accepts a payload containing an undeclared `injected` field and returns the configured success response instead of a validation response.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { OpenApiDocument } from "./generate.js";
import { mockFetch } from "./mock.js";

const spec: OpenApiDocument = {
  openapi: "3.1.0",
  info: { title: "Probe", version: "1.0.0" },
  paths: {
    "/items": {
      post: {
        operationId: "create_item",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["name"],
                properties: { name: { type: "string" } }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      }
    }
  }
};

describe("toolcraft-openapi mock additional properties", () => {
  it("accepts an undeclared request property despite additionalProperties false", async () => {
    const { fetch } = await mockFetch({
      spec,
      fixtures: { create_item: { body: { ok: true } } }
    });

    const response = await fetch("https://api.example.com/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "declared", injected: "accepted" })
    });

    expect(response.status).toBe(200);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft-openapi/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/toolcraft-openapi/src/__probe__.test.ts > toolcraft-openapi mock additional properties > accepts an undeclared request property despite additionalProperties false
```

## Observed Behavior

`mockFetch()` returns status `200` for the request body `{ "name": "declared", "injected": "accepted" }` even though the operation schema declares `additionalProperties: false` and no `injected` property. The request validation path calls `validateAgainstSchema()` in `packages/toolcraft-openapi/src/mock/fetch.ts`, whose object handling checks required declared fields and validates values for known properties but never emits an error for unknown own properties. This omission is observable through the published `./mock` export in `packages/toolcraft-openapi/src/mock.ts`.

## Expected Behavior

When a request schema declares `additionalProperties: false`, `mockFetch()` should return a validation failure such as status `422` for any undeclared request-body property. Its mock request validation should enforce the same closed-object contract retained by OpenAPI generation for supported request schemas.

## Impact

Tests built on the public OpenAPI mock can succeed with requests that generated or production-facing clients should reject under their declared contract. Extra fields, including accidentally leaked or unsupported API parameters, can go unnoticed in integration tests and fixtures, weakening the mock's role as a contract validator.
