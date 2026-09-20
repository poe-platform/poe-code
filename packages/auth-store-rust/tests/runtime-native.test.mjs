import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { createCredentialStoreBindings } from "../dist/runtime.js";
const native = createRequire(import.meta.url)("../dist/auth-store-rust.node");
test("shared credential host creates independent usable binding families from one native core", async () => {
  const a = createCredentialStoreBindings(native),
    b = createCredentialStoreBindings(native);
  const fs = createFsFromVolume(new Volume()).promises;
  const input = {
    fs,
    filePath: "/shared.enc",
    salt: "shared-host-v1",
    getMachineIdentity: () => ({ hostname: "host", username: "user" })
  };
  const writer = new a.EncryptedFileStore(input),
    reader = new b.EncryptedFileStore(input);
  await writer.set("secret");
  assert.equal(await reader.get(), "secret");
  await reader.delete();
  assert.equal(await writer.get(), null);
  assert.equal(a.key("id"), "provider:id");
  assert.equal(b.createSecretStore({ backend: "file", fileStore: input }).backend, "file");
});
