import * as defaultEntry from "@poe-platform/safe-bash";
import { createIconvCommand, createIconvCommands, iconvCommands } from "@poe-platform/safe-bash/commands/iconv";

export async function verifyIconvCommands(entry = defaultEntry) {
  if (entry.createIconvCommand !== createIconvCommand || entry.createIconvCommands !== createIconvCommands || entry.iconvCommands !== iconvCommands) throw new Error("Iconv public subpath factory identity differs");
  if (createIconvCommand().name !== "iconv" || JSON.stringify(createIconvCommands().map(command => command.name)) !== '["iconv"]') throw new Error("Iconv public factories differ");
  const limits = ["maxArguments", "maxArgumentBytes", "maxInputBytes", "maxBufferedBytes", "maxOutputBytes", "maxDiagnosticBytes", "maxWork", "maxChunks", "maxEmptyChunks"];
  for (const name of limits) {
    let failure;
    try { entry.createAgentCommands({ iconv: { limits: { [name]: 0 } } }); }
    catch (error) { failure = error; }
    if (failure?.name !== "RangeError") throw new Error(`Aggregate iconv limit not forwarded: ${name}`);
  }
  const encoder = new TextEncoder();
  const input = encoder.encode("A\0éÿ\n");
  const translit = encoder.encode("éß€\0㎯\n");
  const translated = encoder.encode("?ssEUR\0rad/s^2\n");
  const script = encoder.encode('iconv -f UTF-8 -t UTF-16LE "$1" > utf16.bin || exit "$?"\niconv -f UTF-16LE -t Latin1 utf16.bin > latin1.bin || exit "$?"\niconv -f Latin1 -t UTF-8 latin1.bin > roundtrip.bin || exit "$?"\niconv -f UTF-8 -t ASCII//TRANSLIT "$2" > translit.bin || exit "$?"\ncat roundtrip.bin translit.bin\n');
  const filesystem = entry.createMemoryFileSystem();
  await filesystem.mkdir("/iconv-work");
  for (const [name, value] of [["saved.sh", script], ["input.bin", input], ["translit-input.bin", translit]]) await filesystem.writeFile(`/iconv-work/${name}`, value);
  const shell = new entry.Shell({ fs: filesystem, cwd: "/iconv-work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
  try {
    const result = await shell.exec("sh saved.sh input.bin translit-input.bin");
    const stdout = new Uint8Array(input.length + translated.length);
    stdout.set(input); stdout.set(translated, input.length);
    if (result.exitCode !== 0 || result.stderrBytes.length !== 0 || result.stdoutBytes.length !== stdout.length || result.stdoutBytes.some((value, index) => value !== stdout[index])) throw new Error(`Iconv saved VFS workflow differs: ${JSON.stringify(result)}`);
    const files = [
      ["saved.sh", script], ["input.bin", input], ["translit-input.bin", translit],
      ["utf16.bin", Uint8Array.of(65, 0, 0, 0, 233, 0, 255, 0, 10, 0)],
      ["latin1.bin", Uint8Array.of(65, 0, 233, 255, 10)], ["roundtrip.bin", input], ["translit.bin", translated],
    ];
    for (const [name, expected] of files) {
      const actual = await filesystem.readFile(`/iconv-work/${name}`);
      if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new Error(`Iconv VFS effect differs: ${name}`);
    }
    const names = (await filesystem.readdir("/iconv-work")).map(item => item.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(files.map(([name]) => name).sort())) throw new Error("Iconv VFS namespace differs");
  } finally { await shell.dispose(); }
  const options = { limits: { maxArguments: 1 } };
  Object.defineProperty(options, "replace", { get() { throw new Error("Unexpected nested iconv replacement lookup"); } });
  const limited = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.agentCommands({ iconv: options }));
  try {
    const result = await limited.exec("iconv -f UTF-8");
    if (result.exitCode !== 1 || result.stdoutBytes.length !== 0 || result.stderr !== "iconv: argument count limit exceeded\n") throw new Error("Aggregate iconv argument limit differs");
  } finally { await limited.dispose(); }
}
