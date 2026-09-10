import * as defaultEntry from "@poe-platform/safe-bash";
import { createDos2unixCommand, createUnix2dosCommand, createLineEndingCommands, lineEndingCommands } from "@poe-platform/safe-bash/commands/line-endings";

export async function verifyLineEndingCommands(entry = defaultEntry) {
  if (entry.createDos2unixCommand !== createDos2unixCommand || entry.createUnix2dosCommand !== createUnix2dosCommand || entry.createLineEndingCommands !== createLineEndingCommands || entry.lineEndingCommands !== lineEndingCommands) throw new Error("Line-ending public subpath factory identity differs");
  if (createDos2unixCommand().name !== "dos2unix" || createUnix2dosCommand().name !== "unix2dos" || JSON.stringify(createLineEndingCommands().map(command => command.name)) !== '["dos2unix","unix2dos"]') throw new Error("Line-ending public factories differ");
  const limits = ["maxArguments", "maxArgumentBytes", "maxInputBytes", "maxOutputBytes", "maxBufferedBytes", "maxDiagnosticBytes", "maxFiles", "maxWork", "maxEmptyChunks", "maxPathBytes", "maxDepth", "maxTempAttempts", "chunkSize"];
  for (const name of limits) {
    let failure;
    try { entry.createAgentCommands({ lineEndings: { limits: { [name]: 0 } } }); }
    catch (error) { failure = error; }
    if (failure?.name !== "RangeError") throw new Error(`Aggregate line-ending limit not forwarded: ${name}`);
  }
  const filesystem = entry.createMemoryFileSystem();
  const script = new TextEncoder().encode('dos2unix -q -b "$1" || exit "$?"\nunix2dos -q -b -n "$1" "$2" || exit "$?"\ncat "$1" | unix2dos -b > stream.bin || exit "$?"\ncat stream.bin | dos2unix -b\n');
  const input = Uint8Array.of(239, 187, 191, 65, 13, 10, 66, 10);
  const unix = Uint8Array.of(239, 187, 191, 65, 10, 66, 10);
  const dos = Uint8Array.of(239, 187, 191, 65, 13, 10, 66, 13, 10);
  await filesystem.mkdir("/line-ending-work");
  await filesystem.writeFile("/line-ending-work/saved.sh", script);
  await filesystem.writeFile("/line-ending-work/input.bin", input);
  const shell = new entry.Shell({ fs: filesystem, cwd: "/line-ending-work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh saved.sh input.bin converted.bin");
    if (result.exitCode !== 0 || result.stderrBytes.length !== 0 || result.stdoutBytes.length !== unix.length || result.stdoutBytes.some((value, index) => value !== unix[index])) throw new Error(`Line-ending saved VFS workflow differs: ${JSON.stringify(result)}`);
    const files = [["saved.sh", script], ["input.bin", unix], ["converted.bin", dos], ["stream.bin", dos]];
    for (const [name, expected] of files) {
      const actual = await filesystem.readFile(`/line-ending-work/${name}`);
      if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new Error(`Line-ending VFS effect differs: ${name}`);
    }
    if (JSON.stringify((await filesystem.readdir("/line-ending-work")).map(item => item.name).sort()) !== JSON.stringify(files.map(([name]) => name).sort())) throw new Error("Line-ending VFS namespace differs");
  } finally { await shell.dispose(); }
  const options = { limits: { maxArguments: 1 } };
  Object.defineProperty(options, "replace", { get() { throw new Error("Unexpected nested line-ending replacement lookup"); } });
  const limited = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.agentCommands({ lineEndings: options }));
  try {
    for (const command of ["dos2unix", "unix2dos"]) {
      const result = await limited.exec(`${command} -q -b`);
      if (result.exitCode !== 1 || result.stdoutBytes.length !== 0 || result.stderr !== `${command}: argument count limit exceeded\n`) throw new Error(`Aggregate ${command} limit differs`);
    }
  } finally { await limited.dispose(); }
}
