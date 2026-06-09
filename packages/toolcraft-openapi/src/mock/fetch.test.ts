import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { UserError } from "toolcraft";
import type { OpenApiDocument } from "../generate.js";
import { mockFetch } from "./fetch.js";

function createWhoamiSpec(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: { title: "T", version: "0" },
    paths: {
      "/v1/whoami": {
        get: {
          tags: ["agent"],
          operationId: "whoami",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { handle: { type: "string" } } }
                }
              }
            }
          }
        }
      }
    }
  };
}

function createTemplatedSpec(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: { title: "T", version: "0" },
    paths: {
      "/v1/users/{userHandle}": {
        get: {
          operationId: "get_user",
          parameters: [
            { name: "userHandle", in: "path", required: true, schema: { type: "string" } }
          ],
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "object" } } }
            }
          }
        }
      }
    }
  };
}

function createSetOfficialSpec(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: { title: "T", version: "0" },
    paths: {
      "/v1/bots/{botHandle}/actions/set-official": {
        post: {
          operationId: "set_official",
          parameters: [
            { name: "botHandle", in: "path", required: true, schema: { type: "string" } }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["is_official"],
                  properties: {
                    is_official: { type: "boolean" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "object" } } }
            }
          }
        }
      }
    }
  };
}

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("mockFetch", () => {
  it("returns the fixture body when one matches the operationId", async () => {
    const { fetch } = await mockFetch({
      spec: createWhoamiSpec(),
      fixtures: { whoami: { body: { handle: "kjopek" } } }
    });

    const response = await fetch("https://api.example.com/v1/whoami");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ handle: "kjopek" });
  });

  it("falls back to the spec example when no fixture file is provided", async () => {
    const spec = createWhoamiSpec();
    spec.paths!["/v1/whoami"]!.get!.responses!["200"] = {
      description: "OK",
      content: {
        "application/json": {
          schema: { type: "object" },
          example: { handle: "from-example" }
        } as any
      }
    };

    const { fetch } = await mockFetch({ spec });

    const response = await fetch("https://api.example.com/v1/whoami");

    await expect(response.json()).resolves.toEqual({ handle: "from-example" });
  });

  it("falls back to the first named example when no fixture file is provided", async () => {
    const spec = createWhoamiSpec();
    spec.paths!["/v1/whoami"]!.get!.responses!["200"] = {
      description: "OK",
      content: {
        "application/json": {
          schema: { type: "object" },
          examples: {
            primary: { value: { handle: "named-example" } }
          }
        } as any
      }
    };

    const { fetch } = await mockFetch({ spec });

    const response = await fetch("https://api.example.com/v1/whoami");

    await expect(response.json()).resolves.toEqual({ handle: "named-example" });
  });

  it("throws synchronously when no fixture and no example exist (default onUnmocked)", async () => {
    const { fetch } = await mockFetch({ spec: createWhoamiSpec() });

    await expect(fetch("https://api.example.com/v1/whoami")).rejects.toThrow(/unmocked/i);
  });

  it("returns a synthetic 404 when onUnmocked is reply404", async () => {
    const { fetch } = await mockFetch({
      spec: createWhoamiSpec(),
      onUnmocked: "reply404"
    });

    const response = await fetch("https://api.example.com/v1/whoami");

    expect(response.status).toBe(404);
  });

  it("throws when the request path does not match any spec operation", async () => {
    const { fetch } = await mockFetch({
      spec: createWhoamiSpec(),
      fixtures: { whoami: { body: {} } }
    });

    await expect(fetch("https://api.example.com/v1/unknown")).rejects.toThrow(
      /no operation/i
    );
  });

  it("matches templated paths and exposes the resolved operationId on requests", async () => {
    const { fetch, requests } = await mockFetch({
      spec: createTemplatedSpec(),
      fixtures: { get_user: { body: { uid: 7 } } }
    });

    const response = await fetch("https://api.example.com/v1/users/alice");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ uid: 7 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "GET",
      path: "/v1/users/alice",
      operationId: "get_user"
    });
  });

  it("returns 422 when the request body is missing a required field", async () => {
    const { fetch } = await mockFetch({
      spec: createSetOfficialSpec(),
      fixtures: { set_official: { body: { success: true } } }
    });

    const response = await fetch(
      "https://api.example.com/v1/bots/x/actions/set-official",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }
    );

    expect(response.status).toBe(422);
    const payload = (await response.json()) as { errors: unknown[] };
    expect(Array.isArray(payload.errors)).toBe(true);
    expect(payload.errors.length).toBeGreaterThan(0);
  });

  it("returns 422 when a request body field has the wrong type", async () => {
    const { fetch } = await mockFetch({
      spec: createSetOfficialSpec(),
      fixtures: { set_official: { body: {} } }
    });

    const response = await fetch(
      "https://api.example.com/v1/bots/x/actions/set-official",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_official: "yes" })
      }
    );

    expect(response.status).toBe(422);
  });

  it("returns 422 for undeclared fields in a closed request body schema", async () => {
    const spec = createSetOfficialSpec();
    const requestSchema = spec.paths!["/v1/bots/{botHandle}/actions/set-official"]!.post!
      .requestBody as { content: Record<string, { schema: { additionalProperties?: boolean } }> };
    requestSchema.content["application/json"]!.schema.additionalProperties = false;
    const { fetch } = await mockFetch({
      spec,
      fixtures: { set_official: { body: { success: true } } }
    });

    const response = await fetch(
      "https://api.example.com/v1/bots/x/actions/set-official",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_official: true, injected: "not-declared" })
      }
    );

    expect(response.status).toBe(422);
  });

  it("accepts a valid request body and records the parsed body", async () => {
    const { fetch, requests } = await mockFetch({
      spec: createSetOfficialSpec(),
      fixtures: { set_official: { body: { success: true } } }
    });

    const response = await fetch(
      "https://api.example.com/v1/bots/x/actions/set-official",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_official: true })
      }
    );

    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/bots/x/actions/set-official",
      operationId: "set_official",
      body: { is_official: true }
    });
  });

  it("records request method, path, headers and timestamp", async () => {
    const { fetch, requests } = await mockFetch({
      spec: createWhoamiSpec(),
      fixtures: { whoami: { body: {} } }
    });

    const before = Date.now();
    await fetch("https://api.example.com/v1/whoami", {
      headers: { authorization: "Bearer test-token", "x-custom": "1" }
    });
    const after = Date.now();

    expect(requests).toHaveLength(1);
    const record = requests[0]!;
    expect(record.method).toBe("GET");
    expect(record.path).toBe("/v1/whoami");
    expect(record.operationId).toBe("whoami");
    expect(record.headers.authorization).toBe("Bearer test-token");
    expect(record.headers["x-custom"]).toBe("1");
    expect(record.at.getTime()).toBeGreaterThanOrEqual(before);
    expect(record.at.getTime()).toBeLessThanOrEqual(after);
  });

  it("records received __proto__ request headers as own fields", async () => {
    const { fetch, requests } = await mockFetch({
      spec: createWhoamiSpec(),
      onUnmocked: "reply404"
    });

    await fetch("https://api.example.com/v1/whoami", {
      headers: new Headers([["__proto__", "visible"]])
    });

    expect(Object.hasOwn(requests[0]?.headers ?? {}, "__proto__")).toBe(true);
    expect(requests[0]?.headers["__proto__"]).toBe("visible");
  });

  it("ignores the host portion of baseUrl when matching", async () => {
    const { fetch, requests } = await mockFetch({
      spec: createWhoamiSpec(),
      fixtures: { whoami: { body: {} } }
    });

    await fetch("https://anything.invalid/v1/whoami");
    await fetch("http://localhost:9999/v1/whoami");

    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.path)).toEqual(["/v1/whoami", "/v1/whoami"]);
  });

  it("clears recorded requests on reset()", async () => {
    const { fetch, requests, reset } = await mockFetch({
      spec: createWhoamiSpec(),
      fixtures: { whoami: { body: {} } }
    });

    await fetch("https://api.example.com/v1/whoami");
    expect(requests).toHaveLength(1);

    reset();

    expect(requests).toHaveLength(0);
  });

  it("loads fixtures from a directory keyed by operationId", async () => {
    const volume = Volume.fromJSON({
      "/fixtures/whoami.json": JSON.stringify({ body: { handle: "from-disk" } })
    });
    const memfs = createFsFromVolume(volume);

    const { fetch } = await mockFetch({
      spec: createWhoamiSpec(),
      fixtures: "/fixtures",
      fs: {
        readFile: async (p) => {
          const data = await memfs.promises.readFile(p, "utf8");
          return typeof data === "string" ? data : data.toString("utf8");
        },
        readdir: async (dir) => {
          const list = await memfs.promises.readdir(dir);
          return list.map((entry) => (typeof entry === "string" ? entry : entry.toString("utf8")));
        }
      }
    });

    const response = await fetch("https://api.example.com/v1/whoami");

    await expect(response.json()).resolves.toEqual({ handle: "from-disk" });
  });

  it("respects fixture status and headers overrides", async () => {
    const { fetch } = await mockFetch({
      spec: createWhoamiSpec(),
      fixtures: {
        whoami: {
          status: 503,
          headers: { "content-type": "application/json", "x-trace": "abc" },
          body: { error: "boom" }
        }
      }
    });

    const response = await fetch("https://api.example.com/v1/whoami");

    expect(response.status).toBe(503);
    expect(response.headers.get("x-trace")).toBe("abc");
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });

  it("defaults the response status to the lowest declared 2xx", async () => {
    const spec = createWhoamiSpec();
    spec.paths!["/v1/whoami"]!.get!.responses = {
      "201": {
        description: "Created",
        content: { "application/json": { schema: { type: "object" } } }
      },
      "202": {
        description: "Accepted",
        content: { "application/json": { schema: { type: "object" } } }
      }
    };

    const { fetch } = await mockFetch({
      spec,
      fixtures: { whoami: { body: {} } }
    });

    const response = await fetch("https://api.example.com/v1/whoami");

    expect(response.status).toBe(201);
  });

  it("loads the spec from a file path via the injected fs", async () => {
    const volume = Volume.fromJSON({
      "/spec/openapi.json": JSON.stringify(createWhoamiSpec())
    });
    const fs = createFsFromVolume(volume);

    const { fetch } = await mockFetch({
      spec: "/spec/openapi.json",
      fixtures: { whoami: { body: { handle: "from-fs" } } },
      fs: {
        readFile: async (path) => {
          const data = await fs.promises.readFile(path, "utf8");
          return typeof data === "string" ? data : data.toString("utf8");
        }
      }
    });

    const response = await fetch("https://api.example.com/v1/whoami");

    await expect(response.json()).resolves.toEqual({ handle: "from-fs" });
  });

  it("rejects requests whose method does not match the spec operation", async () => {
    const { fetch } = await mockFetch({
      spec: createWhoamiSpec(),
      fixtures: { whoami: { body: {} } }
    });

    await expect(
      fetch("https://api.example.com/v1/whoami", { method: "POST" })
    ).rejects.toThrow(/method/i);
  });

  it("returns the fixture body for the operation that was hit, not a sibling operation", async () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "T", version: "0" },
      paths: {
        "/v1/items": {
          get: {
            operationId: "list_items",
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          },
          post: {
            operationId: "create_item",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } }
                }
              }
            },
            responses: {
              "201": {
                description: "Created",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        }
      }
    };

    const { fetch } = await mockFetch({
      spec,
      fixtures: {
        list_items: { body: { items: ["a", "b"] } },
        create_item: { body: { id: 1, name: "x" } }
      }
    });

    const list = await fetch("https://api.example.com/v1/items");
    await expect(list.json()).resolves.toEqual({ items: ["a", "b"] });

    const create = await fetch("https://api.example.com/v1/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" })
    });
    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toEqual({ id: 1, name: "x" });
  });

  it("resolves $ref request schemas when validating", async () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "T", version: "0" },
      paths: {
        "/v1/widgets": {
          post: {
            operationId: "create_widget",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Widget" }
                }
              }
            },
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Widget: {
            type: "object",
            required: ["sku"],
            properties: { sku: { type: "string" } }
          }
        }
      }
    };

    const { fetch } = await mockFetch({
      spec,
      fixtures: { create_widget: { body: {} } }
    });

    const bad = await fetch("https://api.example.com/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(bad.status).toBe(422);

    const good = await fetch("https://api.example.com/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "abc" })
    });
    expect(good.status).toBe(200);
  });

  it("ignores inherited $ref request schema markers when validating", async () => {
    const schema = Object.assign(
      Object.create({ $ref: "#/components/schemas/Widget" }),
      {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } }
      }
    ) as never;
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "T", version: "0" },
      paths: {
        "/v1/widgets": {
          post: {
            operationId: "create_widget",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema
                }
              }
            },
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Widget: {
            type: "object",
            required: ["sku"],
            properties: { sku: { type: "string" } }
          }
        }
      }
    };

    const { fetch } = await mockFetch({
      spec,
      fixtures: { create_widget: { body: {} } }
    });

    const response = await fetch("https://api.example.com/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "abc" })
    });

    expect(response.status).toBe(200);
  });

  it("does not resolve missing request schema refs through inherited prototype properties", async () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "T", version: "0" },
      paths: {
        "/v1/widgets": {
          post: {
            operationId: "create_widget",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/__proto__" }
                }
              }
            },
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        }
      },
      components: {
        schemas: {}
      }
    };

    await expect(
      mockFetch({
        spec,
        fixtures: { create_widget: { body: {} } }
      })
    ).rejects.toThrow(
      new UserError('mockFetch: failed to resolve $ref "#/components/schemas/__proto__".')
    );
  });

  it("disables body validation when the request schema accepts any object", async () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "T", version: "0" },
      paths: {
        "/v1/free-form": {
          post: {
            operationId: "free_form",
            requestBody: {
              required: false,
              content: { "application/json": { schema: { type: "object" } } }
            },
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        }
      }
    };

    const { fetch } = await mockFetch({
      spec,
      fixtures: { free_form: { body: { ok: true } } }
    });

    const response = await fetch("https://api.example.com/v1/free-form", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anything: "goes" })
    });

    expect(response.status).toBe(200);
  });

  it("throws at fetch time when a response fixture violates the response schema", async () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "T", version: "0" },
      paths: {
        "/v1/whoami": {
          get: {
            operationId: "whoami",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["handle"],
                      properties: { handle: { type: "string" } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    const { fetch } = await mockFetch({
      spec,
      fixtures: { whoami: { body: { handle: 42 } } }
    });

    const error = await fetch("https://api.example.com/v1/whoami").catch((caught) => caught);

    expect(error).toBeInstanceOf(UserError);
    expect(error).toHaveProperty("message", expect.stringMatching(/whoami.*expected string/is));
  });

  it("skips response-fixture validation when the chosen status has no schema", async () => {
    const { fetch } = await mockFetch({
      spec: createWhoamiSpec(),
      fixtures: {
        whoami: {
          status: 503,
          body: { error: "boom" }
        }
      }
    });

    const response = await fetch("https://api.example.com/v1/whoami");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });

  it("throws at construction when an inline fixture key is not a known operationId", async () => {
    await expect(
      mockFetch({
        spec: createWhoamiSpec(),
        fixtures: {
          whoami: { body: { handle: "k" } },
          fabricated_op: { body: {} }
        }
      })
    ).rejects.toThrow(/fabricated_op/);
  });

  it("throws at construction when a directory fixture file is not a known operationId", async () => {
    const volume = Volume.fromJSON({
      "/fixtures/whoami.json": JSON.stringify({ body: { handle: "k" } }),
      "/fixtures/fabricated_op.json": JSON.stringify({ body: {} })
    });
    const memfs = createFsFromVolume(volume);

    await expect(
      mockFetch({
        spec: createWhoamiSpec(),
        fixtures: "/fixtures",
        fs: {
          readFile: async (p) => {
            const data = await memfs.promises.readFile(p, "utf8");
            return typeof data === "string" ? data : data.toString("utf8");
          },
          readdir: async (dir) => {
            const entries = await memfs.promises.readdir(dir);
            return entries.map((e) => (typeof e === "string" ? e : e.toString("utf8")));
          }
        }
      })
    ).rejects.toThrow(/fabricated_op/);
  });

  it("does not treat inherited directory fixture error codes as missing fixtures", async () => {
    const readdirError = new Error("fixtures readdir denied");

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(
        mockFetch({
          spec: createWhoamiSpec(),
          fixtures: "/fixtures",
          fs: {
            readFile: async () => "",
            readdir: async () => {
              throw readdirError;
            }
          }
        })
      ).rejects.toBe(readdirError);
    });
  });

  it("accepts null for a nullable request-body field", async () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "T", version: "0" },
      paths: {
        "/v1/items": {
          post: {
            operationId: "create_item",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["label"],
                    properties: { label: { type: "string", nullable: true } }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        }
      }
    };

    const { fetch } = await mockFetch({
      spec,
      fixtures: { create_item: { body: { ok: true } } }
    });

    const response = await fetch("https://api.example.com/v1/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: null })
    });

    expect(response.status).toBe(200);
  });

  it("still rejects wrong-type values when nullable: true is set", async () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "T", version: "0" },
      paths: {
        "/v1/items": {
          post: {
            operationId: "create_item",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["label"],
                    properties: { label: { type: "string", nullable: true } }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        }
      }
    };

    const { fetch } = await mockFetch({
      spec,
      fixtures: { create_item: { body: { ok: true } } }
    });

    const response = await fetch("https://api.example.com/v1/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: 42 })
    });

    expect(response.status).toBe(422);
  });

  it("validates allOf branches and rejects when one branch fails", async () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "T", version: "0" },
      paths: {
        "/v1/items": {
          post: {
            operationId: "create_item",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { type: "object", required: ["a"], properties: { a: { type: "string" } } },
                      { type: "object", required: ["b"], properties: { b: { type: "number" } } }
                    ]
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        }
      }
    };

    const { fetch } = await mockFetch({
      spec,
      fixtures: { create_item: { body: { ok: true } } }
    });

    const missing = await fetch("https://api.example.com/v1/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: "ok" })
    });
    expect(missing.status).toBe(422);

    const wrongType = await fetch("https://api.example.com/v1/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 7, b: 9 })
    });
    expect(wrongType.status).toBe(422);

    const ok = await fetch("https://api.example.com/v1/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: "ok", b: 9 })
    });
    expect(ok.status).toBe(200);
  });

  it("prefers a literal path over a templated path when both match", async () => {
    const spec: OpenApiDocument = {
      openapi: "3.1.0",
      info: { title: "T", version: "0" },
      paths: {
        "/v1/users/{userHandle}": {
          get: {
            operationId: "get_user",
            parameters: [
              { name: "userHandle", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        },
        "/v1/users/me": {
          get: {
            operationId: "get_me",
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        }
      }
    };

    const { fetch, requests } = await mockFetch({
      spec,
      fixtures: {
        get_user: { body: { from: "template" } },
        get_me: { body: { from: "literal" } }
      }
    });

    const response = await fetch("https://api.example.com/v1/users/me");

    await expect(response.json()).resolves.toEqual({ from: "literal" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.operationId).toBe("get_me");
  });
});
