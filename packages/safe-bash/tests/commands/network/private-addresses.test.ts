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
]) {
  test(`private-address policy denies canonical and alternate spelling ${host}`, async () => {
    const authorize = createOriginAuthorizer("*", { denyPrivateNetworks: true });
    assert.equal(await authorize(request(host)), false);
    assert.equal(await authorize({ ...request(host), url: new URL(request(host).url).href }), false);
  });
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
  "[2001:4860:4860::8888]", "[2001:db8::1]", "[::ffff:0:7f00:1]", "[64:ff9b::7f00:1]",
  "[fc::1]", "[fd::1]", "[fe8::1]", "[fbff::1]", "[fe00::1]", "[fe7f::1]", "[fec0::1]", "public.example",
]) {
  test(`private-address policy permits ${host}`, async () => {
    assert.equal(await createOriginAuthorizer("*", { denyPrivateNetworks: true })(request(host)), true);
  });
}

test("private literal filtering remains opt-in, including for new mapped and unspecified denials", async () => {
  for (const host of ["[::]", "[::ffff:127.0.0.1]", "[::ffff:169.254.169.254]", "localhost."]) {
    assert.equal(await createOriginAuthorizer()(request(host)), true);
    assert.equal(await createOriginAuthorizer("*", { denyPrivateNetworks: false })(request(host)), true);
  }
});

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
