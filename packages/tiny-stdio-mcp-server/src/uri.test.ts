import { expect, it } from "vitest";
import { isValidUri } from "./uri.js";

it.each([
  " file:///data", "file:///data ", "file:///some file", "file:///a\nb", "file:///a\tb",
  "https:\\example.com\\file", "file:///bad%", "file:///bad%0", "file:///bad%zz",
  "file:///café", "file:///a\u0085b", "https://example.com/a<", "urn:example:{value}",
  "file:///a\"b", "file:///a>b", "file:///a^b", "file:///a`b", "file:///a|b",
  "urn:example:a[b]", "urn:example:a]b", "https://example.test/a[b]",
  "https://example.test/#x[y]", "https://example.test/?x[y]",
  "https://[::1]/a[b]", "https:[::1]",
])("rejects resource URIs requiring lossy URL normalization: %j", (uri) => {
  expect(isValidUri(uri)).toBe(false);
});
it.each(["https://[::1]/resource", "https://user:pass@[2001:db8::1]:8080/resource",
  "https://example.test/a%5Bb%5D", "urn:example:a%5Bb%5D"])("accepts IPv6 hosts and encoded brackets: %s", (uri) => {
  expect(isValidUri(uri)).toBe(true);
});
it.each(["file:///some%20file", "https://example.com/a%2Fb?x=1#part", "urn:example:resource", "data:text/plain,hello", "file:///caf%C3%A9", "file:///a%3Cb", "urn:example:%7Bvalue%7D"])("accepts encoded and opaque absolute URIs: %s", (uri) => {
  expect(isValidUri(uri)).toBe(true);
});

it.each(["file:///some file", "file:///bad%zz", "file:///a\nb"])("rejects invalid file identifiers in roots results: %j", async (uri) => {
  const { validateProtocolValue } = await import("./protocol-validation.js");
  expect(validateProtocolValue("ListRootsResult", { roots: [{ uri }] })).toBe(false);
});
