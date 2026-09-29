import { createSsconvertCommand, createSsconvertCommands, ssconvertCommands } from "@poe-platform/safe-bash/ssconvert/commands";
import { csvFormat } from "@poe-platform/safe-bash/ssconvert/formats/csv";
import { createMemoryFileSystem } from "@poe-platform/safe-fs/core";

export const verification = (async () => {
  const fs = createMemoryFileSystem();
  const bytes = new TextEncoder().encode('Name,Value\n"Łódź, office",007\n');
  await fs.writeFile("/input.csv", bytes);
  await fs.writeFile("/saved.xlsx", new TextEncoder().encode("preserve me"));
  const diagnostics = [];
  const context = { command: "ssconvert", cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: [], stdinIsDefault: true,
    stdout: { async write() {} }, stderr: { async write(bytes) { diagnostics.push(bytes); } } };
  const command = createSsconvertCommand({ formats: [csvFormat] });
  const copied = await command.execute({ ...context, args: ["/input.csv", "/output.csv"] });
  const text = new TextDecoder().decode(await fs.readFile("/output.csv"));
  if (copied.exitCode !== 0 || text !== 'Name,Value\n"Łódź, office",7\n')
    throw new Error("Installed selected CSV command did not convert through its format owner");
  const refused = await command.execute({ ...context, args: ["/input.csv", "/saved.xlsx"] });
  if (refused.exitCode === 0 || new TextDecoder().decode(await fs.readFile("/saved.xlsx")) !== "preserve me")
    throw new Error("Unselected XLSX writer was admitted or overwrote its destination");
  diagnostics.length = 0;
  const empty = await createSsconvertCommands()[0].execute({ ...context, args: ["--list-importers"] });
  if (empty.exitCode !== 0 || diagnostics.map(bytes => new TextDecoder().decode(bytes)).join("") !== "ID | Description\n")
    throw new Error("Composable command installed implicit formats");
  const registered = [];
  await ssconvertCommands({ formats: [csvFormat] }).setup({
    commands: { has: () => false, register(command) { registered.push(command); } },
    use() {}, registerFileSystem() {}
  });
  if (registered.length !== 1 || registered[0].name !== "ssconvert")
    throw new Error("Composable plugin did not register its command");
  return { csv: text, disabledXlsxPreserved: true, emptyFormats: true };
})();
