import assert from "node:assert/strict";
import { it } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import * as own from "auth-store-rust";

it("Native credential store subpath matches public exports and own identities", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/auth-store"),
    import("toolcraft/auth-store")
  ]);
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reference).sort());
  for (const name of Object.keys(reference)) assert.equal(native[name], own[name], name);
  for (const id of ["poe", "", "service:child", "雪\ud800"]) {
    assert.equal(native.key(id), reference.key(id));
  }
});

it("Native credential store subpath shares encrypted documents with the reference", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/auth-store"),
    import("toolcraft/auth-store")
  ]);
  const fs = createFsFromVolume(new Volume()).promises;
  const input = {
    fs,
    filePath: "/credentials/secret.enc",
    salt: "public-store-parity",
    getMachineIdentity: () => ({ hostname: "fixture-host", username: "fixture-user" }),
    getRandomBytes: (size) => Buffer.alloc(size, 7)
  };
  const writer = native.createSecretStore({ backend: "file", fileStore: input });
  const reader = new reference.EncryptedFileStore(input);
  assert.equal(writer.backend, "file");
  assert.equal(writer.store instanceof own.EncryptedFileStore, true);
  await writer.store.set("fixture credential 雪");
  assert.equal(await reader.get(), "fixture credential 雪");
  const document = await fs.readFile(input.filePath, "utf8");
  await reader.set("fixture credential 雪");
  assert.equal(await fs.readFile(input.filePath, "utf8"), document);
  assert.equal((await fs.stat(input.filePath)).mode & 0o777, 0o600);
  await writer.store.delete();
  assert.equal(await reader.get(), null);
});
