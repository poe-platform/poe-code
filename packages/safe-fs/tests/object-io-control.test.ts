import { expect, it } from "vitest";
import { authorizeObjectIoRequest, cleanupObjectIoBucket } from "../src/testing/object-io-control.js";

const bindings = { QUALIFICATION_TOKEN: "object-io-781-test-bearer-token-value", QUALIFICATION_OWNER: "issue-781-test-owner", QUALIFICATION_EXPIRES_AT: "2000" };
const request = (path: string, token = bindings.QUALIFICATION_TOKEN) => new Request(`https://fixture${path}`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Length": "0" },
});

it("expired credentials cannot run benchmarks but can drain the explicitly qualification-only bucket", () => {
  expect(authorizeObjectIoRequest(request("/object-io-781"), bindings, 2001)?.status).toBe(410);
  expect(authorizeObjectIoRequest(request("/cleanup"), bindings, 2001)).toBeUndefined();
  expect(authorizeObjectIoRequest(request("/cleanup", "wrong"), bindings, 2001)?.status).toBe(401);
  expect(authorizeObjectIoRequest(request("/cleanup"), { ...bindings, QUALIFICATION_OWNER: "" }, 2001)?.status).toBe(503);
});

it("rejects missing bindings, unsupported methods, bodies and query parameters on controls", () => {
  expect(authorizeObjectIoRequest(request("/ready"), {}, 1000)?.status).toBe(503);
  expect(authorizeObjectIoRequest(new Request("https://fixture/ready", { headers: { Authorization: `Bearer ${bindings.QUALIFICATION_TOKEN}` } }), bindings, 1000)?.status).toBe(405);
  expect(authorizeObjectIoRequest(new Request("https://fixture/cleanup", { method: "POST", body: "data", headers: { Authorization: `Bearer ${bindings.QUALIFICATION_TOKEN}`, "Content-Length": "4" } }), bindings, 1000)?.status).toBe(400);
  expect(authorizeObjectIoRequest(request("/cleanup?prefix=production"), bindings, 1000)?.status).toBe(400);
  expect(authorizeObjectIoRequest(request("/unknown"), bindings, 1000)?.status).toBe(404);
  expect(authorizeObjectIoRequest(request("/ready"), { ...bindings, QUALIFICATION_EXPIRES_AT: "3601001" }, 1000)?.status).toBe(503);
});

it("drains acknowledged pages in bounded batches and verifies empty with a final list", async () => {
  const objects = new Set(Array.from({ length: 201 }, (_value, index) => String(index)));
  const batches: number[] = [];
  const result = await cleanupObjectIoBucket({
    async list({ limit }) { return { objects: [...objects].slice(0, limit).map(key => ({ key })), truncated: objects.size > limit }; },
    async delete(keys) { batches.push(keys.length); for (const key of keys) objects.delete(key); },
  });
  expect(batches).toEqual([100, 100, 1]);
  expect(result).toEqual({ removedObjects: 201, listedPages: 4, remainingObjects: 0, truncated: false });
});

it("fails closed when the bounded cleanup cap is exhausted or an empty page is truncated", async () => {
  await expect(cleanupObjectIoBucket({ async list() { return { objects: [{ key: "retained" }], truncated: true }; }, async delete() {} }, 2)).rejects.toThrow("cleanup cap");
  await expect(cleanupObjectIoBucket({ async list() { return { objects: [], truncated: true }; }, async delete() {} })).rejects.toThrow("truncated empty page");
});
