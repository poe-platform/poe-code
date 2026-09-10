import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { networkCommands } from "@poe-platform/safe-bash/commands/network";

for (const [flags, method, mode, errorExit] of [
  ["", "GET", "read", 0], ["-I", "HEAD", "omit", 0],
  ["-I -X GET", "GET", "omit", 0], ["-X HEAD", "HEAD", "read", 0],
  ["-f", "GET", "omit-on-http-error", 22], ["--fail-with-body", "GET", "read", 22],
  ["-I -f", "HEAD", "omit", 22], ["-I --fail-with-body", "HEAD", "omit", 22],
]) {
  for (const scenario of ["direct", "redirect", "non-error", "error"]) {
    let calls = 0;
    let reads = 0;
    let disposed = 0;
    let writes = 0;
    const fs = createMemoryFileSystem();
    await fs.writeFile("/out", new Uint8Array([9]));
    const writeFile = fs.writeFile.bind(fs);
    const writeStream = fs.writeStream.bind(fs);
    fs.writeFile = async (...args) => { writes++; await writeFile(...args); };
    fs.writeStream = async (...args) => { writes++; await writeStream(...args); };
    const output = scenario === "error" && mode !== "omit";
    const expectedReads = mode === "omit" || (scenario === "error" && mode === "omit-on-http-error") ? 0 : 1;
    const shell = new Shell({ fs }).use(networkCommands({
      authorize: () => true,
      async transport(request) {
        if (request.method !== method || request.responseBodyMode !== mode) {
          throw new Error(`Unexpected body intent: ${JSON.stringify({ method: request.method, mode: request.responseBodyMode })}`);
        }
        calls++;
        const status = scenario === "error" ? 400 : scenario === "non-error" ? 399 : scenario === "redirect" && calls === 1 ? 302 : 200;
        return {
          status, statusText: "Fixture", headers: status === 302 ? [["Location", "/next"]] : [],
          body: (async function* () { reads++; yield new Uint8Array([1, 2, 255]); })(),
          async dispose() { disposed++; },
        };
      },
    }));
    try {
      const result = await shell.exec(`curl ${flags} ${scenario === "redirect" ? "-L" : ""} ${output ? "-o /out" : ""} https://offline.invalid/start`);
      if (result.exitCode !== (scenario === "error" ? errorExit : 0) || calls !== (scenario === "redirect" ? 2 : 1) || disposed !== calls || reads !== expectedReads) {
        throw new Error(`Packed curl body intent failed: ${JSON.stringify({ flags, scenario, exitCode: result.exitCode, calls, reads, disposed })}`);
      }
      if ((writes > 0) !== (output && expectedReads > 0)) throw new Error("Unexpected output-file acquisition");
      const bytes = [...await fs.readFile("/out")].join(",");
      if (bytes !== (output && expectedReads > 0 ? "1,2,255" : "9")) throw new Error("Unexpected output-file bytes");
    } finally { await shell.dispose(); }
  }
}

for (const flags of ["-f --fail-with-body", "--fail-with-body -f", "-I -f --fail-with-body", "-I --fail-with-body -f"]) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/out", new Uint8Array([9]));
  let effects = 0;
  const writeFile = fs.writeFile.bind(fs);
  const writeStream = fs.writeStream.bind(fs);
  fs.writeFile = async (...args) => { effects++; await writeFile(...args); };
  fs.writeStream = async (...args) => { effects++; await writeStream(...args); };
  const shell = new Shell({ fs }).use(networkCommands({
    authorize: () => { effects++; return true; },
    async transport() { effects++; throw new Error("Unexpected transport"); },
  }));
  try {
    const result = await shell.exec(`curl ${flags} -o /out https://offline.invalid/missing`);
    if (result.exitCode !== 2 || effects !== 0 || [...await fs.readFile("/out")].join(",") !== "9") {
      throw new Error("Conflicting failure flags must reject before network or file effects");
    }
  } finally { await shell.dispose(); }
}

console.log("Packed curl preserves body intent, HTTP-error omission and conflicting-flag admission");
