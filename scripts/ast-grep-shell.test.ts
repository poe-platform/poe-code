import { it, expect } from "vitest";
import { Shell } from "../packages/safe-bash/src/shell-entry.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { astGrepCommands } from "../packages/safe-bash/src/ast-grep.js";
import { parseCode, findMatches } from "../packages/safe-bash/src/ts-ast.js";
it("runs sg and ast-grep through the shell with literal patterns and VFS writes", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/sample.ts", new TextEncoder().encode("console.log(value);"));
  const shell = new Shell({ fs, cwd: "/" }).use(astGrepCommands());
  const result = await shell.exec(
    "sg run -p 'console.log($X)' -r 'logger.info($X)' -U --json=compact sample.ts"
  );
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject([{ replacement: "logger.info(value)" }]);
  const searched = await shell.exec("ast-grep -p 'logger.info($X)' --json=stream sample.ts");
  expect(searched.exitCode).toBe(0);
  expect(JSON.parse(searched.stdout).text).toBe("logger.info(value)");
  expect(findMatches(parseCode("f(a)", "ts"), "f($X)")).toHaveLength(1);
});
it("preflights duplicate registrations before installing the plugin", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/" }).use(astGrepCommands());
  await shell.exec("sg --help");
  expect(() => astGrepCommands().setup(shell)).toThrow("already registered");
  expect(() => astGrepCommands({ replace: true }).setup(shell)).not.toThrow();
});
