import assert from "node:assert/strict";
import { test } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const reference = await tsImport("../../auth-store/src/index.browser.ts", import.meta.url);
const own = await import("auth-store-rust/portable");

function memory() {
  const fs = createFsFromVolume(new Volume()).promises;
  return { ...fs, async lstat(path) { const stat = await fs.lstat(path); return { type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", mode: stat.mode }; } };
}
const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

test("portable entry has the browser namespace and reads interoperable encrypted documents", async () => {
  assert.deepEqual(Object.keys(own), Object.keys(reference));
  for (const factory of [own, reference]) {
    const fs = memory();
    const store = new factory.SafeFsSecretStore({ fs, filePath: "/vault/../vault/secret", key });
    assert.equal(await store.get(), null);
    for (const value of ["", "secret 🔑", "\ud800", "a\0b"]) {
      await store.set(value);
      assert.equal(await new own.SafeFsSecretStore({ fs, filePath: "/vault/secret", key }).get(), value.toWellFormed());
      assert.equal(await new reference.SafeFsSecretStore({ fs, filePath: "/vault/secret", key }).get(), value.toWellFormed());
      assert.equal((await fs.lstat("/vault/secret")).mode & 0o777, 0o600);
    }
    await store.delete(); await store.delete(); assert.equal(await store.get(), null);
  }
});

test("portable construction preserves path errors, key validation and public descriptors", () => {
  for (const filePath of ["relative", "/", "/a/../", "/a\0b", "/a//./b/../c", "/\ud800/x"]) {
    const outcomes = [reference, own].map(factory => {
      try { const store = new factory.SafeFsSecretStore({ fs: memory(), filePath, key }); return { path: store.filePath, fields: Object.keys(store), methods: Object.getOwnPropertyNames(factory.SafeFsSecretStore.prototype) }; }
      catch (error) { return { name: error.name, message: error.message, code: error.code, syscall: error.syscall, errno: error.errno }; }
    });
    assert.deepEqual(outcomes[1], outcomes[0]);
  }
  for (const invalid of [null, {}, { type: "public" }, { type: "secret", algorithm: { name: "AES-GCM", length: 128 }, usages: ["encrypt", "decrypt"] }]) {
    const outcomes = [reference, own].map(factory => { try { new factory.SafeFsSecretStore({ fs: memory(), filePath: "/s", key: invalid }); return "accepted"; } catch (error) { return [error.name, error.message]; } });
    assert.deepEqual(outcomes[1], outcomes[0]);
  }
});

test("portable publication preserves staging ownership and failure identities", async () => {
  for (const scenario of ["write-collision", "write-partial", "rename", "cleanup", "symlink"]) {
    const outcomes = [];
    for (const factory of [reference, own]) {
      const fs = memory(), trace = [], failure = { failure: "publication" }, cleanup = { failure: "cleanup" };
      const store = new factory.SafeFsSecretStore({ fs, filePath: "/vault/secret", key });
      await store.set("previous");
      const write = fs.writeFile.bind(fs), remove = fs.rm.bind(fs);
      fs.writeFile = async (path, ...args) => {
        trace.push("write");
        if (scenario === "write-collision") { await write(path, "another owner's staging"); throw Object.assign(new Error("collision"), { code: "EEXIST" }); }
        await write(path, ...args); if (scenario === "write-partial") throw failure;
      };
      fs.rename = async () => { trace.push("rename"); throw failure; };
      fs.rm = async path => { trace.push("cleanup"); if (scenario === "cleanup") throw cleanup; return remove(path); };
      if (scenario === "symlink") { await remove("/vault/secret"); await fs.symlink("/other", "/vault/secret"); }
      let outcome;
      try { await store.set("next"); } catch (error) { outcome = error === failure ? "publication" : error instanceof AggregateError ? [error.message, error.errors[0] === failure, error.errors[1] === cleanup] : error.message; }
      outcomes.push({ outcome, trace, files: (await fs.readdir("/vault")).map(name => name.endsWith(".tmp") ? "staging" : name).sort() });
    }
    assert.deepEqual(outcomes[1], outcomes[0], scenario);
  }
});

test("portable validation preserves getter ordering and rejection short circuits", () => {
  for (let failure = 0; failure <= 5; failure++) {
    const outcomes = [reference, own].map(factory => {
      const trace = [];
      const values = ["secret", "AES-GCM", 256, true, true];
      const read = index => { trace.push(index); return index === failure ? null : values[index]; };
      const key = { get type() { return read(0); }, get algorithm() { trace.push("algorithm"); return { get name() { return read(1); }, get length() { return read(2); } }; }, get usages() { trace.push("usages"); return { includes(name) { return read(name === "encrypt" ? 3 : 4); } }; } };
      let outcome = "accepted";
      try { new factory.SafeFsSecretStore({ fs: memory(), filePath: "/s", key }); } catch (error) { outcome = error.message; }
      return { trace, outcome };
    });
    assert.deepEqual(outcomes[1], outcomes[0]);
  }
});

test("portable reads reject malformed documents without modifying storage", async () => {
  const valid = { version: 1, iv: btoa("x".repeat(12)), authTag: btoa("x".repeat(16)), ciphertext: "" };
  for (const document of ["{", "null", "[]", "{}", JSON.stringify(valid), ...["version", "iv", "authTag", "ciphertext"].flatMap(field => [JSON.stringify({ ...valid, [field]: null }), JSON.stringify({ ...valid, [field]: "!" })])]) {
    for (const factory of [reference, own]) {
      const fs = memory(); await fs.writeFile("/secret", document);
      const store = new factory.SafeFsSecretStore({ fs, filePath: "/secret", key });
      await assert.rejects(store.get(), { message: "Invalid encrypted credential document; reset the store explicitly to recover" });
      assert.equal(await fs.readFile("/secret", "utf8"), document);
    }
  }
});
