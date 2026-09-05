import assert from "node:assert/strict";
import test from "node:test";
import { createOriginAuthorizer } from "../../../src/commands/network/authorizer.js";

const signal = new AbortController().signal;
const request = (host: string) => ({ url: `http://${host}/path`, method: "GET", attempt: 0, signal });

for (const host of [
  "[::]", "[0:0:0:0:0:0:0:0]",
  "[::ffff:0.0.0.0]", "[::ffff:0.255.255.255]",
  "[::ffff:10.0.0.1]", "[::ffff:127.0.0.1]", "[::ffff:127.255.255.255]",
  "[::ffff:169.254.169.254]", "[::ffff:172.16.0.1]", "[::ffff:172.31.255.255]",
  "[::ffff:192.168.1.2]", "[::ffff:7f00:1]", "[::ffff:a9fe:a9fe]",
  "[0:0:0:0:0:ffff:7f00:1]", "[0:0:0:0:0:FFFF:A9FE:A9FE]",
  "[::ffff:0:7f00:1]", "[64:ff9b::7f00:1]",
  "[::ffff:0:a9fe:a9fe]", "[64:ff9b::a9fe:a9fe]",
  "[0:0:0:0:FFFF:0:A9FE:A9FE]", "[0064:FF9B:0:0:0:0:A9FE:A9FE]",
]) {
  test(`private-address policy denies canonical and alternate spelling ${host}`, async () => {
    const authorize = createOriginAuthorizer("*", { denyPrivateNetworks: true });
    assert.equal(await authorize(request(host)), false);
    assert.equal(await authorize({ ...request(host), url: new URL(request(host).url).href }), false);
  });
}

for (const prefix of ["::ffff:0:", "64:ff9b::"]) {
  for (const address of [
    "0.0.0.0", "0.255.255.255", "10.0.0.0", "10.255.255.255",
    "127.0.0.0", "127.255.255.255", "169.254.0.0", "169.254.255.255",
    "172.16.0.0", "172.31.255.255", "192.168.0.0", "192.168.255.255",
  ]) {
    test(`private-address policy denies translated range boundary ${prefix}${address}`, async () => {
      const authorize = createOriginAuthorizer("*", { denyPrivateNetworks: true });
      const input = request(`[${prefix}${address}]`);
      assert.equal(await authorize(input), false);
      assert.equal(await authorize({ ...input, url: new URL(input.url).href }), false);
    });
  }

  for (const address of [
    "1.0.0.0", "8.8.8.8", "9.255.255.255", "11.0.0.0", "126.255.255.255", "128.0.0.0",
    "169.253.255.255", "169.255.0.0", "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0",
  ]) {
    test(`private-address policy permits translated public neighbor ${prefix}${address}`, async () => {
      assert.equal(await createOriginAuthorizer("*", { denyPrivateNetworks: true })(request(`[${prefix}${address}]`)), true);
    });
  }
}

for (const host of [
  "0", "0.0.0.0", "10.255.255.255", "127.1", "169.254.1.1", "172.16.0.0", "172.31.255.255", "192.168.0.1",
  "localhost", "LOCALHOST", "localhost.", "sub.localhost.",
  "[::1]", "[fc00::1]", "[fdff::1]", "[fe80::1]", "[febf::1]",
]) {
  test(`private-address policy retains denial of ${host}`, async () => {
    assert.equal(await createOriginAuthorizer("*", { denyPrivateNetworks: true })(request(host)), false);
  });
}

for (const host of [
  "8.8.8.8", "1.0.0.1", "9.255.255.255", "11.0.0.0", "126.255.255.255", "128.0.0.0",
  "169.253.255.255", "169.255.0.0", "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0",
  "[::ffff:8.8.8.8]", "[::ffff:808:808]", "[0:0:0:0:0:FFFF:0808:0808]",
  "[::ffff:172.15.255.255]", "[::ffff:172.32.0.0]", "[::ffff:169.253.255.255]", "[::ffff:192.169.0.0]",
  "[2001:4860:4860::8888]", "[2001:db8::1]", "[2001:4860::7f00:1]", "[::7f00:1]",
  "[65:ff9b::7f00:1]", "[64:ff9c::7f00:1]", "[64:ff9b:1::7f00:1]",
  "[64:ff9b:0:1::7f00:1]", "[64:ff9b:0:0:1:0:7f00:1]", "[64:ff9b:0:0:0:1:7f00:1]",
  "[1:0:0:0:ffff:0:7f00:1]", "[0:1:0:0:ffff:0:7f00:1]", "[0:0:1:0:ffff:0:7f00:1]",
  "[0:0:0:1:ffff:0:7f00:1]", "[::fffe:0:7f00:1]", "[::ffff:1:7f00:1]",
  "[fc::1]", "[fd::1]", "[fe8::1]", "[fbff::1]", "[fe00::1]", "[fe7f::1]", "[fec0::1]", "public.example",
]) {
  test(`private-address policy permits ${host}`, async () => {
    assert.equal(await createOriginAuthorizer("*", { denyPrivateNetworks: true })(request(host)), true);
  });
}

test("private literal filtering remains opt-in, including translated, mapped and unspecified denials", async () => {
  for (const host of [
    "[::]", "[::ffff:127.0.0.1]", "[::ffff:169.254.169.254]", "localhost.",
    "[::ffff:0:127.0.0.1]", "[64:ff9b::169.254.169.254]",
  ]) {
    assert.equal(await createOriginAuthorizer()(request(host)), true);
    assert.equal(await createOriginAuthorizer("*", { denyPrivateNetworks: false })(request(host)), true);
  }
});

for (const prefix of ["::ffff:0:", "64:ff9b::"]) {
  test(`translated filtering precedes allowlists and preserves public origin/hostname rules for ${prefix}`, async () => {
    const privateHost = `[${prefix}127.0.0.1]`;
    const privateUrl = `http://${privateHost}`;
    const canonicalHost = new URL(privateUrl).hostname;
    for (const allowlist of [[privateUrl], [canonicalHost]]) {
      assert.equal(await createOriginAuthorizer(allowlist)(request(privateHost)), true);
      assert.equal(await createOriginAuthorizer(allowlist, { denyPrivateNetworks: false })(request(privateHost)), true);
      assert.equal(await createOriginAuthorizer(allowlist, { denyPrivateNetworks: true })(request(privateHost)), false);
    }
    const publicHost = `[${prefix}8.8.8.8]`;
    const canonicalPublicHost = new URL(`http://${publicHost}`).hostname;
    const origin = createOriginAuthorizer([`http://${publicHost}`], { denyPrivateNetworks: true });
    assert.equal(await origin(request(canonicalPublicHost)), true);
    assert.equal(await origin(request(`${canonicalPublicHost}:81`)), false);
    assert.equal(await origin({ ...request(canonicalPublicHost), url: `https://${canonicalPublicHost}/` }), false);
    const hosts = createOriginAuthorizer([canonicalPublicHost], { denyPrivateNetworks: true });
    assert.equal(await hosts(request(`${canonicalPublicHost}:81`)), true);
    assert.equal(await hosts({ ...request(canonicalPublicHost), url: `https://${canonicalPublicHost}/` }), true);
    assert.equal(await createOriginAuthorizer(["public.example"], { denyPrivateNetworks: true })(request(publicHost)), false);
  });
}

test("private filtering composes with canonical exact origins and hostname allowlists", async () => {
  const privateUrl = "http://[::ffff:127.0.0.1]";
  assert.equal(await createOriginAuthorizer([privateUrl])(request("[::ffff:7f00:1]")), true);
  assert.equal(await createOriginAuthorizer([privateUrl], { denyPrivateNetworks: true })(request("[::ffff:7f00:1]")), false);
  const origin = createOriginAuthorizer(["http://[::ffff:8.8.8.8]"], { denyPrivateNetworks: true });
  assert.equal(await origin(request("[::ffff:808:808]")), true);
  assert.equal(await origin(request("[::ffff:808:808]:81")), false);
  assert.equal(await origin({ ...request("[::ffff:808:808]"), url: "https://[::ffff:808:808]/" }), false);
  const hosts = createOriginAuthorizer(["PUBLIC.EXAMPLE."], { denyPrivateNetworks: true });
  assert.equal(await hosts(request("public.example.")), true);
  assert.equal(await hosts(request("public.example:81")), true);
  assert.equal(await hosts(request("sub.public.example")), false);
});
