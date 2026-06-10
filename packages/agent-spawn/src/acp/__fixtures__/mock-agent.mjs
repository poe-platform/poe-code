import fs from "node:fs/promises";
import http from "node:http";

const fixturesUrl = new URL("./sample-sessions.json", import.meta.url);
const fixtures = JSON.parse(await fs.readFile(fixturesUrl, "utf8"));

const mode = process.argv[2] ?? "codex";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const payload = JSON.stringify({ resourceSpans: [{ scopeSpans: [] }] });
  await new Promise((resolve, reject) => {
    const request = http.request(`${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
    });
    request.once("error", reject);
    request.once("response", (response) => {
      response.resume();
      response.once("end", resolve);
    });
    request.end(payload);
  });
}

if (mode === "fail") {
  process.stderr.write("mock agent failed\n");
  process.exit(2);
}

const lines =
  mode === "codex"
    ? fixtures.codexSession
    : mode === "claude"
      ? fixtures.claudeSession
      : mode === "native-empty"
        ? ["{}"]
      : undefined;

if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) {
  process.stderr.write(`unknown or invalid fixture: ${mode}\n`);
  process.exit(1);
}

for (const line of lines) {
  process.stdout.write(`${line}\n`);
}
