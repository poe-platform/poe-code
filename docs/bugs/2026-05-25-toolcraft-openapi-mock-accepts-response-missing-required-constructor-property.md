# OpenAPI Mock Accepts a Response Missing Required `constructor` Property

## Summary

The public `mockFetch()` fixture validator accepts a JSON response body that omits a schema-required property named `constructor`. Required-property validation uses the JavaScript `in` operator, so the inherited `Object.prototype.constructor` satisfies the schema even though the response body does not contain an own `constructor` field.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft-openapi/src/mock/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mockFetch } from "./fetch.js";

describe("OpenAPI mock required special properties", () => {
  it("accepts a fixture missing required constructor response property", async () => {
    const handle = await mockFetch({
      spec: {
        openapi: "3.0.0",
        info: { title: "Demo", version: "1" },
        paths: {
          "/ping": {
            get: {
              operationId: "ping",
              responses: {
                "200": {
                  description: "ok",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["constructor"],
                        properties: { constructor: { type: "string" } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      fixtures: { ping: { body: {} } }
    } as never);

    const response = await handle.fetch("https://example.test/ping");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft-openapi/src/mock/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the invalid fixture response is served successfully. Remove the disposable probe after validation.

## Observed Behavior

A response schema requiring `constructor` accepts fixture body `{}` and `mockFetch()` serves it with status `200`. In `packages/toolcraft-openapi/src/mock/fetch.ts`, `validateAgainstSchema()` checks required object properties with `if (!(required in value))`; for a normal empty object, `"constructor" in {}` is true through its prototype chain.

## Expected Behavior

Response fixture validation should require schema-mandated properties to be own JSON object properties. A fixture body that omits a required `constructor` field should fail validation rather than being returned as a conforming response.

## Impact

Mocks can approve and serve responses that violate their OpenAPI response contract, allowing tests to pass against invalid fixture data. Any schema with a required inherited-property name can receive false-positive fixture validation, reducing confidence in API client or integration testing.
