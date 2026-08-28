export const schema = "webdav-directory-access-independent/v1";
export const baseUrl = "https://independent.invalid/dav/";
export const requestBody = '<?xml version="1.0" encoding="utf-8"?>'
  + '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/>'
  + '<d:getlastmodified/><d:creationdate/><d:getetag/>'
  + '<v:timestamps xmlns:v="urn:virtual-bash:metadata"/></d:prop></d:propfind>';
export const defaults = {
  baseUrl, headers: { Authorization: "Bearer independent-synthetic-only" },
  timeoutMs: 500, maxXmlBytes: 2097152, maxEntries: 10000, maxResponseBytes: 16777216,
};
export const xml = members => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${members}</d:multistatus>`;
export const property = (content, status = 200) => `<d:propstat><d:prop>${content}</d:prop><d:status>HTTP/1.1 ${status} Fixture</d:status></d:propstat>`;
export const member = (href, properties) => `<d:response><d:href>${href}</d:href>${properties}</d:response>`;
export const directory = href => member(href, property('<d:resourcetype><d:collection/></d:resourcetype>'));
export const file = href => member(href, property('<d:resourcetype/><d:getcontentlength>3</d:getcontentlength>'));
const dav = (members, extra = {}) => ({ status: 207, body: xml(members), ...extra });
const http = status => ({ status, body: null });
const probe = (urlPath, depth, response, extra = {}) => ({
  method: "PROPFIND", url: new URL(urlPath, baseUrl).href, depth, response, ...extra,
});
const access = (path, mode, outcome = "OK", extra = {}) => ({
  method: "access", path, mode, outcome, ...extra,
});
const cases = [];
const add = (id, group, calls, requests, extra = {}) => cases.push({
  id, group, calls, requests, cleanup: "finite-eof", qualification: "injected-mock-only", ...extra,
});

add("N01", "navigation-freshness", [access("/docs", 1),
  { method: "readdir", path: "/docs", outcome: "EACCES" }, access("/docs", 1, "EACCES")], [
  probe("/dav/docs", "0", dav(directory("/dav/docs"))),
  probe("/dav/docs/", "1", http(403)), probe("/dav/docs", "0", http(403)),
]);
add("N02", "navigation-freshness", [
  { method: "stat", path: "/docs", outcome: "directory" }, access("/docs", 1, "ENOTSUP"),
], [probe("/dav/docs", "0", dav(directory("/dav/docs"))), probe("/dav/docs", "0", dav(file("/dav/docs")))]);
add("N03", "navigation-freshness", [access("/parent/../docs//.", 1)], [
  probe("/dav/docs/", "0", dav(directory("https://independent.invalid/dav/%64ocs/"))),
], { headers: {} });
add("N04", "navigation-freshness", [access("/docs", 5)], [
  probe("/dav/docs", "0", { status: 301, body: "redirect-body", headers: { Location: "/dav/docs/" } }),
  probe("/dav/docs/", "0", dav(directory("/dav/docs/"))),
  probe("/dav/docs/", "1", dav(directory("/dav/docs/") + file("/dav/docs/child"))),
], { cleanup: "redirect-once", deadlineRelation: "requests-0-and-1-share-signal" });
add("N05", "navigation-freshness", [access("/", 1)], [probe("/dav/", "0", dav(directory("/dav/")))]);

for (const [suffix, response, outcome] of [
  ["required-denied", dav(member("/dav/docs", property('<d:resourcetype><d:collection/></d:resourcetype>', 403))), "EACCES"],
  ["optional-denied", dav(directory("/dav/docs").replace('</d:response>', property('<d:getetag/>', 403) + '</d:response>')), "OK"],
  ["extension", dav(member("/dav/docs", property('<d:resourcetype><d:collection/><z:opaque xmlns:z="urn:independent"/></d:resourcetype>'))), "ENOTSUP"],
  ["malformed", { status: 207, body: "<broken" }, "EIO"],
  ["duplicate-normalized", dav(directory("/dav/docs") + directory("/dav/%64ocs/")), "EIO"],
  ["missing-self", dav(""), "EIO"],
  ["extra-member", dav(directory("/dav/docs") + file("/dav/docs/child")), "EACCES"],
  ["wrong-final-url", dav(directory("/dav/docs"), { url: "https://independent.invalid/dav/other" }), "EACCES"],
  ["outside-href", dav(directory("https://outside.invalid/dav/docs")), "EACCES"],
  ["encoded-separator", dav(directory("/dav/docs%2Fchild")), "EACCES"],
  ["redirect-encoding", { status: 301, body: null, headers: { Location: "/dav/%64ocs/" } }, "ENOTSUP"],
  ["redirect-origin", { status: 301, body: null, headers: { Location: "https://outside.invalid/dav/docs/" } }, "EACCES"],
  ["locked", http(423), "EBUSY"],
  ["retryable", http(503), "EAGAIN"],
  ["unexpected-http-success", http(200), "EIO"],
]) add(`M-${suffix}`, "metadata-namespace", [access("/docs", 1, outcome)], [probe("/dav/docs", "0", response)]);

for (const mode of [1, 5]) for (const slash of [false, true]) {
  const path = `/file${slash ? "/" : ""}`;
  add(`T-file-${mode}-${Number(slash)}`, "file-type", [access(path, mode, slash ? "ENOTDIR" : "ENOTSUP")], [
    probe(`/dav${path}`, "0", dav(file(`/dav${path}`))),
  ]);
}
for (const mode of [-1, 8, 1.5, "NaN", "Infinity", "string:1", "null"]) {
  add(`O-invalid-${String(mode).replaceAll(".", "p").replaceAll(":", "-")}`, "ordering", [access("/docs", mode, "EINVAL", { signal: "preaborted" })], [], { cleanup: "zero-work" });
}
for (const wrapper of ["plain", "readonly"]) for (const mode of [0, 1, 2, 3, 4, 5, 6, 7]) {
  add(`O-aborted-${wrapper}-${mode}`, "ordering", [access("/docs", mode,
    wrapper === "readonly" && (mode & 2) ? "EROFS" : "ECANCELED", { signal: "preaborted" })], [],
  { wrapper, cleanup: "zero-work" });
}
for (const wrapper of ["plain", "readonly"]) for (const mode of [2, 3, 6, 7]) {
  add(`O-write-${wrapper}-${mode}`, "ordering", [access(`/${"a".repeat(65536)}`, mode,
    wrapper === "readonly" ? "EROFS" : "ENOTSUP")], [], { wrapper, cleanup: "zero-work" });
}
for (const mode of [1, 5]) {
  add(`O-readonly-${mode}`, "ordering", [access("/docs", mode)], [
    probe("/dav/docs", "0", dav(directory("/dav/docs"))),
    ...(mode === 5 ? [probe("/dav/docs/", "1", dav(directory("/dav/docs/")))] : []),
  ], { wrapper: "readonly" });
}
add("O-invalid-before-bounds", "ordering", [access(`/${"a".repeat(65536)}`, 8, "EINVAL", { signal: "preaborted" })], [], { cleanup: "zero-work" });
add("O-aborted-before-bounds", "ordering", [access(`/${"a".repeat(65536)}`, 1, "ECANCELED", { signal: "preaborted" })], [], { cleanup: "zero-work" });
add("O-readonly-invalid", "ordering", [access("/docs", 8, "EINVAL", { signal: "preaborted" })], [], { wrapper: "readonly", cleanup: "zero-work" });
for (const [suffix, response, outcome] of [
  ["denied", http(403), "EACCES"],
  ["became-file", dav(file("/dav/docs/")), "ENOTDIR"],
  ["unknown-child", dav(directory("/dav/docs/") + member("/dav/docs/child", property('<d:resourcetype><z:opaque xmlns:z="urn:independent"/></d:resourcetype>'))), "ENOTSUP"],
  ["paginated", dav(directory("/dav/docs/"), { headers: { Link: '</dav/page2>; rel="next"' } }), "ENOTSUP"],
  ["new-collection", dav(directory("/dav/docs/")), "OK"],
]) add(`R-${suffix}`, "mode5-races", [access("/docs", 5, outcome)], [
  probe("/dav/docs", "0", dav(directory("/dav/docs"))), probe("/dav/docs/", "1", response),
], { betweenRequests: "replace-resource-no-lease" });

for (const [suffix, path, outcome] of [
  ["nul", "/do\0cs", "EINVAL"], ["backslash", "/do\\cs", "EINVAL"],
  ["surrogate", "/\ud800", "EINVAL"], ["escape", "/../docs", "EACCES"],
]) add(`P-${suffix}`, "input-bounds", [access(path, 1, outcome)], [], { cleanup: "zero-work" });
for (const [suffix, path, accepted] of [
  ["ascii-at", `/${"a".repeat(65535)}`, true], ["ascii-over", `/${"a".repeat(65536)}`, false],
  ["utf8-at", `/${"é".repeat(32767)}a`, true], ["utf8-over", `/${"é".repeat(32768)}`, false],
  ["astral-at", `/${"😀".repeat(16383)}abc`, true], ["astral-over", `/${"😀".repeat(16384)}`, false],
  ["components-at", `/${Array(256).fill("a").join("/")}`, true],
  ["components-over", `/${Array(257).fill("a").join("/")}`, false],
  ["raw-dot-at", `/${"./".repeat(255)}docs`, true], ["raw-dot-over", `/${"./".repeat(256)}docs`, false],
  ["raw-dotdot-over", `/${"a/../".repeat(128)}docs`, false],
  ["empty-components", `/${"/".repeat(300)}docs`, true],
]) {
  const canonical = suffix.startsWith("raw-") || suffix === "empty-components" ? "/docs" : path;
  const href = `/dav${canonical.split("/").map(encodeURIComponent).join("/")}`;
  add(`B-${suffix}`, "input-bounds", [access(path, 1, accepted ? "OK" : "ENAMETOOLONG")],
    accepted ? [probe(href, "0", dav(directory(href)))] : [],
    { cleanup: accepted ? "finite-eof" : "zero-work", inputBytes: Buffer.byteLength(path),
      inputComponents: path.split("/").filter(Boolean).length });
}
add("B-mode5-over", "input-bounds", [access(`/${Array(257).fill("a").join("/")}`, 5, "ENAMETOOLONG")], [], { cleanup: "zero-work" });
const self = directory("/dav/docs");
const listingSelf = directory("/dav/docs/");
for (const [suffix, options, response, outcome] of [
  ["xml-at", { maxXmlBytes: Buffer.byteLength(xml(self)) }, dav(self), "OK"],
  ["xml-over", { maxXmlBytes: Buffer.byteLength(xml(self)) - 1 }, dav(self), "EFBIG"],
]) add(`L-${suffix}`, "response-limits", [access("/docs", 1, outcome)], [probe("/dav/docs", "0", response)],
  { options, cleanup: outcome === "OK" ? "finite-eof" : "bounded-body-cancel" });
add("L-entry-over", "response-limits", [access("/docs", 5, "EFBIG")], [
  probe("/dav/docs", "0", dav(self)), probe("/dav/docs/", "1", dav(listingSelf + file("/dav/docs/child"))),
], { options: { maxEntries: 1 } });
add("L-independent-budgets", "response-limits", [access("/docs", 5)], [
  probe("/dav/docs", "0", dav(self)), probe("/dav/docs/", "1", dav(listingSelf)),
], { options: { maxEntries: 1, maxXmlBytes: Buffer.byteLength(xml(listingSelf)) } });
for (const [suffix, ancestor, outcome] of [
  ["file", dav(file("/dav/a")), "ENOTDIR"], ["denied", http(403), "EACCES"],
  ["directories", dav(directory("/dav/a")), "ENOENT"],
]) add(`Q-${suffix}`, "lookup-races", [access("/a/b/leaf", 1, outcome)], [
  probe("/dav/a/b/leaf", "0", http(404)), probe("/dav/a", "0", ancestor),
  ...(suffix === "directories" ? [probe("/dav/a/b", "0", dav(directory("/dav/a/b")))] : []),
], { betweenRequests: "target-appears-after-404-no-retry" });
const maximalPath = `/${Array(255).fill("a").join("/")}/leaf`;
const maximalRequests = [];
for (const [path, response] of [[maximalPath, http(404)],
  ...Array.from({ length: 255 }, (_, index) => {
    const ancestor = `/${Array(index + 1).fill("a").join("/")}`;
    return [ancestor, dav(directory(`/dav${ancestor}/`))];
  })]) {
  maximalRequests.push(probe(`/dav${path}`, "0", {
    status: 301, body: "redirect-body", headers: { Location: `/dav${path}/` },
  }), probe(`/dav${path}/`, "0", response));
}
add("Q-maximal-lookup", "lookup-races", [access(maximalPath, 1, "ENOENT")], maximalRequests,
  { cleanup: "redirect-once-per-pair", deadlineRelation: "each-even-odd-pair-shares-signal" });

for (const [phase, mode] of [["stat", 1], ["stat", 5], ["readdir", 5]]) {
  add(`C-after-${phase}-${mode}`, "cancellation-cleanup", [access("/docs", mode, "ECANCELED", { signal: "active" })], [
    probe("/dav/docs", "0", dav(self)),
    ...(phase === "readdir" ? [probe("/dav/docs/", "1", dav(listingSelf))] : []),
  ], { abortAt: `public-${phase}-fulfilled-before-return` });
}
add("C-active-body", "cancellation-cleanup", [access("/docs", 5, "ECANCELED", { signal: "active" })], [
  probe("/dav/docs", "0", { status: 207, body: null, delivery: "pending-first-body-pull" }),
], { abortAt: "first-body-pull", cleanup: "active-body-once" });
for (const [suffix, outcome, delivery] of [
  ["abort-late-body", "ECANCELED", "deferred-response"],
  ["timeout-late-body", "ETIMEDOUT", "deferred-response"],
  ["abort-late-rejection", "ECANCELED", "deferred-rejection"],
  ["abort-beats-fetch-error", "ECANCELED", "abort-then-reject"],
  ["fetch-error", "EIO", "immediate-rejection"],
]) add(`C-${suffix}`, "cancellation-cleanup", [access("/docs", 1, outcome,
  { signal: suffix === "fetch-error" || suffix.startsWith("timeout") ? "omitted" : "active" })], [
  probe("/dav/docs", "0", { status: 207, body: xml(self), delivery }),
], { abortAt: suffix.startsWith("timeout") ? "deadline" : suffix === "fetch-error" ? "never" : "after-fetch-admission",
  cleanup: delivery === "deferred-response" ? "late-body-once" : "observed-rejection",
  ...(suffix.startsWith("timeout") ? { options: { timeoutMs: 10 } } : {}) });

add("G-existing-file-read", "compatibility", [access("/file", 0), access("/file", 4)], [
  probe("/dav/file", "0", dav(file("/dav/file"))), probe("/dav/file", "0", dav(file("/dav/file"))),
  { method: "GET", url: `${baseUrl}file`, depth: null, response: { status: 200, body: "abc" } },
], { cleanup: "unconsumed-get-once" });
for (const wrapper of ["plain", "readonly"]) {
  add(`G-logical-cwd-${wrapper}`, "compatibility", [access("/docs", 1),
    { method: "stat", path: "/docs/child", outcome: "EACCES" }], [
    probe("/dav/docs", "0", dav(self)), probe("/dav/docs/child", "0", http(403)),
  ], { wrapper, invariant: "future-cd-runtime-separate" });
}

export const scenarios = cases;
for (const scenario of scenarios) for (const request of scenario.requests) {
  const response = request.response;
  if (response.delivery?.includes("rejection") || response.delivery === "abort-then-reject") {
    request.resources = { responses: 0, pulls: 0, underlyingCancels: 0, releasedLocks: true };
  } else if (response.delivery === "pending-first-body-pull") {
    request.resources = { responses: 1, pulls: 1, underlyingCancels: 1, releasedLocks: true };
  } else if (response.body === null) {
    request.resources = { responses: 1, pulls: 0, underlyingCancels: 0, releasedLocks: true };
  } else if (response.delivery === "deferred-response" || response.status !== 207 || response.url || response.headers?.Link) {
    request.resources = { responses: 1, pulls: 0, underlyingCancels: 1, releasedLocks: true };
  } else if (scenario.id === "L-xml-over") {
    request.resources = { responses: 1, pulls: 1, underlyingCancels: 1, releasedLocks: true };
  } else {
    request.resources = { responses: 1, pulls: 2, underlyingCancels: 0, releasedLocks: true };
  }
}
export const invariants = [
  "logical-cwd-only-permissions-false-no-capability",
  "exact-sequential-requests-no-hidden-fallback-or-mutation",
  "typed-errors-not-raw-abort-reasons",
  "no-cache-lease-acl-listing-child-or-future-permission-inference",
  "per-response-and-request-budgets-not-a-shared-global-budget",
  "cleanup-counts-underlying-stream-cancel-not-api-cancel-calls",
  "no-opaque-host-preemption-or-await-all-late-work-promise",
  "future-cd-compatibility-not-runtime-execution-or-approval",
];
