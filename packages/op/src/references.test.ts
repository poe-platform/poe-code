import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import { deriveItemFieldReferences, parseSecretReference, resolveSecretReference } from "./references.js";
import type { OpBackendRequest, OpItem } from "./types.js";

const context = { signal: new AbortController().signal };

function referenceItem(): OpItem {
  return {
    id: "current-item", title: "Unsupported / item title", vault: { id: "current-vault", name: "Unsupported / vault name" },
    sections: [{ id: "current-section", label: "Unsupported / section label" }],
    fields: [
      { id: "password", label: "Unsupported / field label", value: "synthetic-secret", reference: "op://old-vault/old-item/password" },
      { id: "current-field", section: { id: "current-section" }, value: "section-secret", reference: "op://old-vault/old-item/old-section/old-field" },
      { id: "notesPlain", purpose: "NOTES" },
    ],
    files: [{ id: "file", name: "key.bin", content: new Uint8Array([0, 255]) }],
  };
}

test("derives current raw-ID references including section and valueless fields, replacing stale references", () => {
  const item = referenceItem();
  const before = structuredClone(item);
  const result = deriveItemFieldReferences(item);
  assert.deepEqual(result.fields?.map(field => field.reference), [
    "op://current-vault/current-item/password",
    "op://current-vault/current-item/current-section/current-field",
    "op://current-vault/current-item/notesPlain",
  ]);
  assert.equal(Object.hasOwn(result.fields![2]!, "value"), false);
  assert.deepEqual(item, before);
  for (const field of result.fields ?? []) {
    assert.deepEqual(parseSecretReference(String(field.reference)), {
      vault: item.vault.id, item: item.id, field: field.id, ...(field.section ? { section: field.section.id } : {}),
    });
  }
});

test("derived output is deeply detached and accepts frozen input without altering metadata or bytes", () => {
  const item = referenceItem();
  Object.freeze(item.vault);
  for (const field of item.fields ?? []) { if (field.section) Object.freeze(field.section); Object.freeze(field); }
  Object.freeze(item.fields);
  Object.freeze(item);
  const before = structuredClone(item);
  const result = deriveItemFieldReferences(item);
  assert.equal(result.title, item.title);
  assert.equal(result.fields![0]!.value, "synthetic-secret");
  result.vault.id = "changed";
  result.fields![0]!.value = "changed";
  result.fields![1]!.section!.id = "changed";
  (result.files![0]!.content as Uint8Array)[0] = 99;
  assert.deepEqual(item, before);
});

test("items without fields remain detached and do not acquire fabricated fields", () => {
  const item: OpItem = { id: "item", title: "Empty", vault: { id: "vault" } };
  const result = deriveItemFieldReferences(item);
  assert.deepEqual(result, item);
  assert.notEqual(result, item);
  assert.notEqual(result.vault, item.vault);
  assert.deepEqual(deriveItemFieldReferences({ ...item, fields: [] }).fields, []);
});

test("supported ID segments round trip literally without URL normalization or encoding", () => {
  const item: OpItem = { id: "..", title: "Ignored", vault: { id: "Vault-ID_1" }, fields: [{ id: "Field ID_2", section: { id: "." } }] };
  const result = deriveItemFieldReferences(item);
  assert.equal(result.fields![0]!.reference, "op://Vault-ID_1/.././Field ID_2");
  assert.deepEqual(parseSecretReference(String(result.fields![0]!.reference)), { vault: "Vault-ID_1", item: "..", section: ".", field: "Field ID_2" });
});

for (const location of ["vault", "item", "section", "field"]) {
  for (const invalid of [undefined, null, 42, "", "synthetic/private", "synthetic%2Fprivate", "synthetic?attr=value", "synthetic#private", "syntheticü", "synthetic\u0000private"]) {
    test(`rejects invalid ${location} ID ${JSON.stringify(invalid)} without fabrication or plaintext error leaks`, () => {
      const item = referenceItem();
      if (location === "vault") item.vault.id = invalid as string;
      else if (location === "item") item.id = invalid as string;
      else if (location === "section") item.fields![1]!.section!.id = invalid as string;
      else item.fields![0]!.id = invalid as string;
      const before = structuredClone(item);
      assert.throws(() => deriveItemFieldReferences(item), { message: "Cannot derive field reference from item IDs" });
      assert.deepEqual(item, before);
    });
  }
}

test("parses official names, IDs, sections and metadata queries without URL normalization", () => {
  assert.deepEqual(parseSecretReference("op://Work/Login/password"), { vault: "Work", item: "Login", field: "password" });
  assert.deepEqual(parseSecretReference("op://Work/Login/Access Keys/private key?attribute=value&ssh-format=openssh"), { vault: "Work", item: "Login", section: "Access Keys", field: "private key", query: { attribute: "value", "ssh-format": "openssh" } });
  assert.equal(parseSecretReference("op://Work/../password").item, "..");
  assert.equal(parseSecretReference("OP://Work/Login/password").vault, "Work");
});

test("rejects malformed references and unsupported name characters", () => {
  for (const reference of ["https://a/b/c", "op://a/b", "op://a/b/c/d/e", "op://a//c", "op://a/b/c/", "op://a/b/p%20w", "op://a/b/p#x", "op://a/b/ü", "op://a/b/p?", "op://a/b/p?attr=id&attr=value", "op://a/b/p?unknown=value"]) {
    assert.throws(() => parseSecretReference(reference), Error, reference);
  }
});

test("resolver delegates exact reference and cancellation to a pluggable backend", async () => {
  let received: OpBackendRequest | undefined;
  const result = await resolveSecretReference("op://a/b/c", { async execute(request, supplied) { received = request; assert.equal(supplied, context); return "secret"; } }, context);
  assert.equal(result, "secret");
  assert.deepEqual(received, { resource: "secret", action: "read", args: ["op://a/b/c"], flags: {} });
});

test("object reference reads are case insensitive, section aware and preserve file bytes", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Work" }], items: [{ id: "item", title: "Login", vault: { id: "vault" }, sections: [{ id: "section", label: "Access" }], fields: [{ id: "password", label: "Password", value: "secret", type: "CONCEALED" }, { id: "token", label: "Token", section: { id: "section" }, value: "scoped" }], files: [{ id: "file", name: "key.bin", content: new Uint8Array([0, 255]), size: 2 }] }] });
  assert.equal(await resolveSecretReference("op://work/login/PASSWORD", backend, context), "secret");
  assert.equal(await resolveSecretReference("op://vault/item/Access/Token", backend, context), "scoped");
  assert.equal(await resolveSecretReference("op://vault/item/password?attr=type", backend, context), "CONCEALED");
  assert.deepEqual(await resolveSecretReference("op://vault/item/key.bin", backend, context), new Uint8Array([0, 255]));
  assert.equal(await resolveSecretReference("op://vault/item/key.bin?attribute=size", backend, context), 2);
  await assert.rejects(resolveSecretReference("op://vault/item/absent", backend, context));
  await assert.rejects(resolveSecretReference("op://vault/item/password?attribute=otp", backend, context));
  await assert.rejects(resolveSecretReference("op://vault/item/password?ssh-format=openssh", backend, context));
});
