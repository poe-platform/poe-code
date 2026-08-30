export function parseAuditDiagnostic(line) {
  if (!line.startsWith('# {"name":')) return undefined;
  const result = JSON.parse(line.slice(2).replace(/\\([\\#])/g, "$1"));
  if (typeof result.name !== "string" || !Array.isArray(result.events)) {
    throw new TypeError("Audit diagnostic requires a string name and an events array");
  }
  return result;
}

export function formatAuditOutput(output) {
  const lines = [];
  const errors = [];
  for (const line of output.split("\n")) {
    lines.push(line);
    try {
      const result = parseAuditDiagnostic(line);
      if (!result) continue;
      const strings = result.events.filter(event => typeof event === "string");
      const selected = strings.filter(event => /^(?:settled:|state:|failure:|cleanup.failure:|http.final:|after-fixture|late.body|body.reader|head\.)/.test(event));
      const count = prefix => strings.filter(event => event.startsWith(prefix)).length;
      lines.push(JSON.stringify({ case: result.name.slice(0, 3), verdict: result.verdict, ms: result.durationMs,
        pipelines: result.pipelines, operations: count("op:"), acquired: count("source.acquire"),
        next: count("source.next"), returned: count("source.return"), bodyCancel: count("body.cancel"),
        putAcquired: count("PUT.transport.body.acquire"), putNext: count("PUT.transport.body.next"), putReturned: count("PUT.transport.body.return"),
        socketsOpened: count("http.socket.open"), socketsClosed: count("http.socket.close"), evidence: selected }));
    } catch (error) {
      errors.push(`AUDIT FORMAT ERROR: ${String(error)}`);
    }
  }
  return { lines, errors };
}
