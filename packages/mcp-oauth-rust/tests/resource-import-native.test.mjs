import { test } from "node:test";
import assert from "node:assert/strict";
import { Volume, createFsFromVolume } from "memfs";
import { createResourceBoundOAuthStores } from "../dist/index.js";
function session() {
  return { resource: "https://resource.example/mcp", authorizationServer: "https://auth.example",
    client: { clientId: "c", registration: { client_id: "c" } },
    tokens: { accessToken: "token", tokenType: "Bearer", expiresAt: null },
    discovery: { resourceMetadataUrl: "https://resource.example/meta", resourceMetadata: { resource: "https://resource.example/mcp" }, authorizationServerMetadata: { issuer: "https://auth.example" } } };
}
test("resource imports reject credential effects before storage and preserve lock cancellation", async () => {
  const fs = createFsFromVolume(new Volume()).promises, stores = createResourceBoundOAuthStores({ backend: "file", fileStore: { fs, filePath: "/home/test/import.enc", salt: "fixture", getMachineIdentity: () => ({ hostname: "host", username: "user" }) } }, undefined, "catalog");
  const valid = session();
  await stores.importSession(valid);
  let touched = 0;
  for (const change of [{ get secret() { touched++; throw Error("private-marker"); } }, { extension: "x".repeat(65_536) }, { extension: new Date() }])
    await assert.rejects(stores.importSession(Object.defineProperties({ ...valid }, Object.getOwnPropertyDescriptors(change))), /Invalid OAuth import/);
  assert.equal(touched, 0);
  assert.equal((await stores.sessionStore.load(valid.resource)).tokens.accessToken, "token");
  const controller = new AbortController(), reason = {}; controller.abort(reason);
  await assert.rejects(stores.importSession(valid, { signal: controller.signal }), error => error === reason);
});
