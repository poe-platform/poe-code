import assert from "node:assert/strict";
import { test } from "node:test";
import { isBase64, isValidUri } from "../dist/index.js";
import { isBase64 as referenceBase64 } from "../../tiny-stdio-mcp-server/dist/base64.js";
import { isValidUri as referenceUri } from "../../tiny-stdio-mcp-server/dist/uri.js";

test("native canonical base64 matches Node decoding including all unused-bit combinations", () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (const first of alphabet) {
    for (const second of alphabet) {
      for (const source of [`${first}${second}==`, `A${first}${second}=`]) {
        assert.equal(isBase64(source), referenceBase64(source), source);
      }
    }
  }
  for (const source of [
    "",
    "Zg",
    "=AAA",
    "AA=A",
    "AAAA====",
    "AAAA\n",
    "____",
    "----",
    "🦀==",
    "\ud800AAA"
  ]) {
    assert.equal(isBase64(source), referenceBase64(source), source);
  }
});

test("native URI checks agree with the existing strict resource URI validator", () => {
  const hosts = [
    "",
    "host",
    "user:pass@host",
    "host:",
    "host:00080",
    "host:65535",
    "host:65536",
    "host:-1",
    "host:1x",
    "[::1]",
    "[2001:db8::1]:80",
    "[::ffff:192.0.2.1]",
    "[bad]",
    "[::1]extra",
    "127.1",
    "0xffffffff",
    "0300.0250.01.01",
    "256.1.1.1",
    "1.2.3.256",
    "1.2.3.4.5",
    "4294967296",
    "08",
    "%65xample.com",
    "%00",
    "%23",
    "%2F",
    "%FF",
    "example..test",
    "a!b",
    "a;b"
  ];
  for (const scheme of ["http", "https", "ftp", "file", "custom", "urn"]) {
    for (const host of hosts) {
      for (const tail of ["", "/asset", "/a%5Bb%5D", "/a[b]", "?x[y]", "#x[y]"]) {
        const source = `${scheme}://${host}${tail}`;
        assert.equal(isValidUri(source), referenceUri(source), source);
      }
    }
  }
  for (const source of [
    "custom:",
    "urn:example:resource",
    "data:text/plain,hello",
    "file:///some%20file",
    "https:example.com",
    "https:///example.com",
    "https:[::1]",
    "urn:example:a[b]",
    " file:///data",
    "file:///data ",
    "file:///bad%",
    "file:///bad%0",
    "file:///bad%zz",
    "file:///café",
    "file:///a\u0085b",
    'file:///a"b',
    "file:///a>b",
    "file:///a^b",
    "file:///a`b",
    "file:///a|b",
    "file:///a\ud800b",
    "1bad:resource",
    "/relative",
    "http://-1/",
    "http://+1/"
  ]) {
    assert.equal(isValidUri(source), referenceUri(source), source);
  }
});

test("URI host validation handles file drives, oversized IPv4 and invalid IDNA labels", () => {
  for (const host of [
    "C:",
    "%C3%A9.com",
    "%E2%80%8D.com",
    "%EF%BC%8F.com",
    "%EF%BC%A1.com",
    "xn--",
    "xn--a",
    "xn--bcher-kva.test",
    "a.%E2%80%8D",
    "0x10000000000000000",
    "host:00000000000000000000000000000000000080",
    "+4294967296"
  ]) {
    for (const scheme of ["http", "file", "custom"]) {
      const source = `${scheme}://${host}/`;
      assert.equal(isValidUri(source), referenceUri(source), source);
    }
  }
});
