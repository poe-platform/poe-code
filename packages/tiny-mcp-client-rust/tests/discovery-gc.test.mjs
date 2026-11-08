import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("native discovery replacement releases old host snapshots and its final owner", () => {
  const moduleUrl = new URL("../dist/oauth-discovery.js", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { setImmediate as tick } from "node:timers/promises";
    import { OAuthMetadataDiscovery } from ${JSON.stringify(moduleUrl)};
    const platformClone = globalThis.structuredClone;
    const snapshots = [];
    let discovery = new OAuthMetadataDiscovery({fetch: async input => new Response(JSON.stringify(
      String(input).includes("oauth-protected-resource")
        ? {resource:"https://resource.test/mcp",authorization_servers:["https://auth.test"]}
        : {issuer:"https://auth.test",authorization_endpoint:"https://auth.test/authorize",token_endpoint:"https://auth.test/token",response_types_supported:["code"],code_challenge_methods_supported:["S256"]}
    ))});
    globalThis.structuredClone = value => {
      const snapshot = platformClone(value);
      snapshots.push(new WeakRef(snapshot));
      return snapshot;
    };
    try {
      for(let index=0;index<64;index++) await discovery.discover("https://resource.test/mcp",{resourceMetadataUrl:"https://resource.test/oauth-protected-resource"});
    } finally { globalThis.structuredClone = platformClone; }
    for(let index=0;index<3;index++){await tick();global.gc();}
    assert.equal(snapshots.length,64);
    assert.equal(snapshots.filter(ref=>ref.deref()!==undefined).length,1,"replaced snapshots must be collectible");
    discovery=null;
    for(let index=0;index<3;index++){await tick();global.gc();}
    assert.equal(snapshots.filter(ref=>ref.deref()!==undefined).length,0,"dropping discovery releases the final snapshot");
  `;
  const child = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 2000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});
