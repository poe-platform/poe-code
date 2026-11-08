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

test("pure backend selection matches the SDK without store creation or platform admission", async () => {
  const own = await import("../dist/index.js");
  process.env.TSX_DISABLE_CACHE = "1";
  const { tsImport } = await import("tsx/esm/api"),
    sdk = await tsImport("../../auth-store/src/create-secret-store.ts", import.meta.url);
  for (const configured of [
    "file",
    "keychain",
    " KEYCHAIN ",
    "",
    " \ufeffkeychain ",
    "missing",
    "\ud800"
  ]) {
    const input = {
      backend: configured,
      platform: "linux",
      fileStore: {
        get salt() {
          throw new Error("must not create file store");
        }
      },
      keychainStore: {
        get service() {
          throw new Error("must not create keychain store");
        }
      }
    };
    const outcome = (resolve) => {
      try {
        return { value: resolve(input) };
      } catch (error) {
        return { message: error.message, name: error.name };
      }
    };
    assert.deepEqual(
      outcome(own.resolveSecretStoreBackend),
      outcome(sdk.resolveSecretStoreBackend)
    );
  }
  for (const resolve of [own.resolveSecretStoreBackend, sdk.resolveSecretStoreBackend]) {
    const calls = [];
    assert.equal(
      resolve({
        get backend() {
          calls.push("backend");
          return "keychain";
        },
        get env() {
          throw new Error("must not read env");
        },
        get platform() {
          throw new Error("must not read platform");
        }
      }),
      "keychain"
    );
    assert.deepEqual(calls, ["backend"]);
    assert.equal(resolve({ backendEnvVar: "CUSTOM", env: { CUSTOM: " file " } }), "file");
  }
});
