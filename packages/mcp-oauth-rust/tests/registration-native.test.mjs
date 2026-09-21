import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOAuthClientRegistration as own } from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const { parseOAuthClientRegistration: original } = await tsImport(
  "../../mcp-oauth/src/client/client-registration.ts",
  import.meta.url
);
const outcome = (fn, value) => {
  try {
    return { value: fn(value) };
  } catch (error) {
    return { error: error.message, name: error.name };
  }
};
const compare = (value) => assert.deepEqual(outcome(own, value), outcome(original, value));
test("registration preserves complete metadata, extensions and independent ownership", () => {
  const value = JSON.parse(
    '{"client_id":" c ","client_secret":" s ","scope":"write read","token_endpoint_auth_method":"private_key_jwt","redirect_uris":["http://localhost/cb"],"contacts":null,"client_id_issued_at":0,"client_secret_expires_at":9007199254740991,"issuer":"https://issuer.example","__proto__":{"nested":[true,null,1,"\\ud800"]}}'
  );
  compare(value);
  const copy = own(value);
  copy.__proto__.nested.push("changed");
  assert.equal(value.__proto__.nested.length, 4);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  let seed = 0x186754;
  for (let index = 0; index < 512; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    compare({
      client_id: "c",
      extension: [seed / 31, String.fromCharCode(seed & 65535), { value: seed % 2 === 0 }]
    });
  }
});
test("registration rejects invalid JSON and metadata with matching safe diagnostics", () => {
  for (const value of [
    null,
    [],
    true,
    1,
    "c",
    {},
    { client_id: "" },
    { client_id: "\ufeff " },
    { client_id: 1 }
  ])
    compare(value);
  const strings = [
    "client_secret",
    "token_endpoint_auth_method",
    "application_type",
    "client_name",
    "client_uri",
    "logo_uri",
    "scope",
    "tos_uri",
    "policy_uri",
    "jwks_uri",
    "software_id",
    "software_version",
    "software_statement",
    "registration_access_token",
    "registration_client_uri",
    "issuer"
  ];
  for (const key of strings)
    for (const value of [null, "ok", 0, {}, []]) compare({ client_id: "c", [key]: value });
  for (const key of ["redirect_uris", "grant_types", "response_types", "contacts"])
    for (const value of [null, [], ["a"], [1], {}, "a"]) compare({ client_id: "c", [key]: value });
  for (const key of ["client_id_issued_at", "client_secret_expires_at"])
    for (const value of [null, 0, 1.5, -1, 9007199254740991, 9007199254740992, "1", Infinity])
      compare({ client_id: "c", [key]: value });
  for (const value of [
    undefined,
    () => {},
    Symbol("private"),
    1n,
    NaN,
    Infinity,
    new Date(),
    new Map(),
    new Number(1)
  ])
    compare({ client_id: "c", extension: value });
  for (const scope of ["", " ", "read\twrite", "read\\write", 'read"write', "\ud800"])
    compare({ client_id: "c", scope });
});
test("registration descriptor admission never invokes accessors or serialization hooks", () => {
  let effects = 0;
  const value = { client_id: "c" };
  Object.defineProperty(value, "ignored", {
    get() {
      effects++;
      throw Error("PRIVATE");
    }
  });
  Object.defineProperty(value, "toJSON", {
    value() {
      effects++;
      throw Error("PRIVATE");
    }
  });
  value[Symbol("ignored")] = () => effects++;
  compare(value);
  compare(Object.assign(Object.create(null), { client_id: "c" }));
  const accessor = { client_id: "c" };
  Object.defineProperty(accessor, "extension", {
    enumerable: true,
    get() {
      effects++;
      throw Error("PRIVATE");
    }
  });
  compare(accessor);
  class List extends Array {}
  const list = new List("x");
  list.extra = () => effects++;
  compare({ client_id: "c", extension: list });
  const inherited = Object.create({
    toJSON() {
      effects++;
    }
  });
  inherited.client_id = "c";
  compare(inherited);
  compare({ client_id: "c", extension: new Array(1) });
  const proxy = new Proxy(
    { client_id: "c" },
    {
      ownKeys() {
        throw Error("PRIVATE");
      }
    }
  );
  compare(proxy);
  assert.equal(effects, 0);
});
test("registration enforces exact depth, node and UTF8 serialization bounds", () => {
  for (const depth of [63, 64, 65]) {
    let extension = 0;
    for (let i = 0; i < depth; i++) extension = [extension];
    compare({ client_id: "c", extension });
  }
  for (const length of [19997, 19998, 19999, 20000, 20001])
    compare({ client_id: "c", extension: Array(length).fill(null) });
  for (const text of ["x", "é", "\ud800", "\n"])
    for (const length of [10900, 21800, 32700, 65499, 65500, 65501])
      compare({ client_id: "c", extension: text.repeat(length) });
  const cycle = { client_id: "c" };
  cycle.extension = cycle;
  compare(cycle);
  for (const length of [65504, 65505, 65506])
    compare({ client_id: "c", extension: "x".repeat(length) });
});
