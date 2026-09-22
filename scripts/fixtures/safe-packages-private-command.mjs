import { csvgrep, createCsvgrepCommand, csvgrepCommands, CsvError as CsvgrepError } from "@poe-platform/safe-bash/commands/csvgrep";
import { csvcut, csvcutCommand, createCsvcutCommand, csvcutCommands, cutCsv, parseCsvRecords, resolveColumns, CsvBudget, CsvParser, CsvError } from "@poe-platform/safe-bash/commands/csvcut";
import * as root from "@poe-platform/safe-bash";
import * as contracts from "@poe-platform/safe-bash/contracts/command";
import * as errors from "@poe-platform/safe-bash/contracts/errors";
import * as values from "@poe-platform/safe-bash/contracts/value";
import * as filesystem from "@poe-platform/safe-fs/core";
import { createExiftoolCommand, createExiftoolArguments, exiftoolCommands } from "@poe-platform/safe-bash/commands/exiftool";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function verifyPrivateCommand() {
  assert(CsvError === CsvgrepError, "CSV commands must share their error constructor");
  const csvSignal = new AbortController().signal;
  const csvRows = [];
  const source = async function* (signal) {
    assert(signal === csvSignal, "csvcut lost explicit cancellation signal");
    yield new TextEncoder().encode('\ufeffa,b,\r\n"x\ny",z,\r\n');
  };
  for await (const row of parseCsvRecords(source, { signal: csvSignal })) csvRows.push(row);
  assert(JSON.stringify(csvRows) === JSON.stringify([
    { cells: ["a", "b", ""], line: 1 }, { cells: ["x\ny", "z", ""], line: 3 }
  ]), "packed csvcut lost multiline or trailing empty cells");
  assert(JSON.stringify(resolveColumns({ include: "3,1,3" }, ["a", "b", "c"], new CsvBudget({}, csvSignal))) === "[2,0,2]", "packed csvcut selectors differ");
  const cutSource = async function* () { yield new TextEncoder().encode("id,id,note\na,b,\nc,d,0\nshort\n"); };
  const cutChunks = [];
  for await (const bytes of cutCsv(cutSource, { include: "note,id,note", deleteEmptyRows: true }, { signal: csvSignal })) cutChunks.push(bytes);
  const cutLength = cutChunks.reduce((sum, bytes) => sum + bytes.length, 0);
  const cutOutput = new Uint8Array(cutLength);
  let cutOffset = 0;
  for (const bytes of cutChunks) { cutOutput.set(bytes, cutOffset); cutOffset += bytes.length; }
  assert(new TextDecoder().decode(cutOutput) === "note,id,note\n,a,\n0,c,0\n,short,\n", "packed csvcut projection differs");
  let cutLimitError;
  try {
    for await (const bytes of cutCsv(async function* () { yield new TextEncoder().encode("a\nx"); }, { names: true }, { signal: csvSignal, limits: { inputBytes: 2 } })) void bytes;
  } catch (error) { cutLimitError = error; }
  assert(cutLimitError instanceof CsvError && cutLimitError.code === "LIMIT", "packed csvcut failed to account delivered names input");
  const parser = new CsvParser({ profile: "utf8-sig-strict-v1" }, new CsvBudget({}, csvSignal));
  let parseError;
  try { parser.push(new TextEncoder().encode('"unfinished')); parser.end(); } catch (error) { parseError = error; }
  assert(parseError instanceof CsvError && parseError.code === "INPUT", "packed csvcut lost error identity");
  assert(root.commandRuntimeIdentity === contracts.commandRuntimeIdentity, "Root/contract runtime identity differs");
  assert(root.CommandArgumentIdentityError === contracts.CommandArgumentIdentityError, "Argument error constructors differ");
  assert(root.FsError === errors.FsError && errors.FsError === filesystem.FsError, "Filesystem error constructors differ");
  const command = createExiftoolCommand();
  assert(command.runtimeIdentity === contracts.commandRuntimeIdentity, "Command runtime identity differs");

  // The SDK and contract subpaths must admit each other's branded carriers.
  const sdk = createExiftoolArguments({ files: ["/missing.png"], format: "json" }, { signal: new AbortController().signal });
  assert(contracts.getCommandArguments({ args: sdk.args, argumentValues: sdk }) === sdk, "SDK carrier lost its brand");
  const invalid = values.shellValueFromBytes(Uint8Array.of(255));
  const raw = contracts.createCommandArguments([invalid, values.shellValueFromBytes(Uint8Array.of(254))]);
  assert(raw.args[0] === raw.args[1] && raw.bytes(0)[0] === 255 && raw.bytes(1)[0] === 254, "Value WeakMap ownership or raw byte distinction differs");
  const copy = raw.bytes(0);
  copy[0] = 0;
  assert(raw.bytes(0)[0] === 255, "Carrier bytes exposed mutable owned storage");
  let mismatch;
  try { contracts.getCommandArguments({ args: [...raw.args], argumentValues: raw }); } catch (error) { mismatch = error; }
  assert(mismatch instanceof root.CommandArgumentIdentityError, "Recreated argv was admitted");

  const fs = new filesystem.MemoryFileSystem();
  // Independent one-pixel PNG fixture; no product writer constructs the input.
  await fs.writeFile("/image.png", Uint8Array.of(137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,4,0,0,0,181,28,12,2,0,0,0,12,116,69,88,116,84,105,116,108,101,0,112,97,99,107,101,100,41,161,151,116,0,0,0,11,73,68,65,84,120,218,99,252,255,31,0,3,3,2,0,239,162,167,91,0,0,0,0,73,69,78,68,174,66,96,130));
  const grep = createCsvgrepCommand();
  assert(grep.runtimeIdentity === contracts.commandRuntimeIdentity, "csvgrep runtime identity differs");
  const grepArgs = contracts.createCommandArguments(["-c", "x", "-m", "a"]);
  const producerBytes = new TextEncoder().encode("x\na\n");
  Object.defineProperty(producerBytes, "constructor", { get() { throw new Error("Producer constructor used"); } });
  let directOutput = "";
  const directResult = await grep.execute({ command: "csvgrep", args: grepArgs.args, argumentValues: grepArgs,
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () { yield producerBytes; })(),
    stdout: { async write(bytes) { directOutput += new TextDecoder().decode(bytes); } },
    stderr: { async write() { throw new Error("Unexpected csvgrep diagnostic"); } },
  });
  assert(directResult.exitCode === 0 && directOutput === "x\na\n", "csvgrep lost producer ownership");
  await fs.writeFile("/input.csv", new TextEncoder().encode("x,y\na,b\nb,a\n"));
  const grepShell = new root.Shell({ fs }).use(csvgrepCommands());
  grepShell.use({ name: "csvgrep-sdk-witness", setup(host) {
    host.commands.register({ name: "sdk-csvgrep", execute(context) { return csvgrep(context, { columns: "x", match: "a", filePath: "/input.csv" }); } });
  } });
  try {
    const cli = await grepShell.exec("csvgrep -c x -m a /input.csv");
    const sdk = await grepShell.exec("sdk-csvgrep");
    assert(cli.exitCode === 0 && cli.stdout === "x,y\na,b\n" && cli.stderr === "", "Packed csvgrep failed");
    assert(JSON.stringify(cli) === JSON.stringify(sdk), "Packed csvgrep CLI/SDK differ");
    const unsupported = await grepShell.exec("csvgrep -c x -r '(?i)[A-z]' /input.csv");
    assert(unsupported.exitCode === 1 && unsupported.stdout === "" && unsupported.stderr.includes("same-case ASCII letter endpoints"), "Packed csvgrep admitted an inaccurate ignore-case range");
    const missing = await grepShell.exec("csvgrep -c x -m a /missing.csv");
    assert(missing.exitCode === 1 && missing.stdout === "", "csvgrep lost canonical FsError");
  } finally { await grepShell.dispose(); }
  const shell = new root.Shell({ fs }).use(exiftoolCommands());
  let admitted;
  shell.use({ name: "byte-argv-witness", setup(host) {
    host.commands.register({ name: "raw-byte", async execute(context) {
      await context.stdout.write(Uint8Array.of(255));
      return { exitCode: 0 };
    } });
    host.commands.register({ name: "witness", runtimeIdentity: contracts.commandRuntimeIdentity, async execute(context) {
      const carrier = contracts.getCommandArguments(context);
      admitted = carrier.bytes(0);
      // Preserve the exact carrier/context pair when invoking the real handler.
      return command.execute(context);
    } });
  } });
  try {
    const result = await shell.exec('witness "$(raw-byte)"');
    assert(admitted?.length === 1 && admitted[0] === 255, "Shell byte argv lost its canonical brand or bytes: " + JSON.stringify({ admitted: admitted && Array.from(admitted), result }));
    assert(result.exitCode === 1 && result.stderr === "Error: Only qualified UTF-8 argv is currently supported\n", "Command decoded invalid byte argv or lost its brand");
    const successful = await shell.exec("exiftool -j -Title /image.png");
    assert(successful.exitCode === 0 && successful.stderr === "" && JSON.parse(successful.stdout)[0].Title === "packed", "Packed command PNG metadata extraction failed: " + JSON.stringify(successful));
    const missing = await shell.exec("exiftool -j /missing.png");
    assert(missing.exitCode === 1 && missing.stderr === "Error: File not found - /missing.png\n", "Opt-in command lost canonical FsError recognition");
  } finally { await shell.dispose(); }
}

const baseVerification = verifyPrivateCommand();

export const csvcutWiringVerification = (async () => {
  assert(csvcutCommand.runtimeIdentity === contracts.commandRuntimeIdentity, "packed csvcut duplicated runtime contracts");
  assert(createCsvcutCommand().name === "csvcut", "packed csvcut factory missing");
  const fs = new filesystem.MemoryFileSystem();
  const shell = new root.Shell({ fs });
  try {
    await shell.exec("true");
    assert(!shell.commands.has("csvcut"), "csvcut changed default registration");
    shell.use(csvcutCommands());
    await fs.writeFile("/csvcut-input", new TextEncoder().encode("a,b\nx,y\n"));
    const result = await shell.exec("csvcut -c2 /csvcut-input");
    assert(result.exitCode === 0 && result.stdout === "b\ny\n" && result.stderr === "", "packed csvcut CLI differs");
    const badField = await shell.exec("csvcut --maxfieldsize=no");
    assert(badField.exitCode === 2 && badField.stdout === "" && badField.stderr === "csvcut: Expected an ASCII integer\n", "packed csvcut field-size grammar differs");
    const invalid = await shell.exec("csvcut $'\\xff'");
    assert(invalid.exitCode === 2 && invalid.stderr === "csvcut: Arguments must be valid UTF-8\n", "packed csvcut lost byte argument identity");
    const carrier = contracts.createCommandArguments([]);
    const bytes = [], errors = [], cleanups = [];
    const resultSdk = await csvcut({ command: "csvcut", args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () { yield new TextEncoder().encode("a,b\nx,y\n"); })(),
      stdout: { async write(chunk) { bytes.push(...chunk); } }, stderr: { async write(chunk) { errors.push(...chunk); } },
      registerCleanup(cleanup) { cleanups.push(cleanup); }
    }, { include: "2" });
    assert(resultSdk.exitCode === 0 && new TextDecoder().decode(new Uint8Array(bytes)) === result.stdout && !errors.length, "packed csvcut SDK differs");
    await Promise.all(cleanups.map(cleanup => cleanup()));
  } finally { await shell.dispose(); }
})();
export const verification = Promise.all([baseVerification, csvcutWiringVerification]);
