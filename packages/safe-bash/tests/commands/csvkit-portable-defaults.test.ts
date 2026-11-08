import {test as it} from "node:test";
import assert from "node:assert/strict";
import {Shell} from "../../src/shell/index.js";
import {MemoryFileSystem} from "../../src/fs/memory/index.js";
import {csvkitCommands} from "../../src/commands/csvkit/index.js";

it("provides locale, codecs, SQL dialects and in-memory SQLite with default csvkit wiring", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new TextEncoder().encode("id,name,score,city\n1,alice,95,nyc\n2,bob,82,sf\n"));
  await fs.writeFile("/latin.csv", new Uint8Array([110,97,109,101,10,99,97,102,233,10]));
  const shell = new Shell({fs}).use(csvkitCommands());
  try {
    for (const command of ["csvstat /data.csv", "csvsql -i sqlite /data.csv", 'csvsql --query "SELECT city, AVG(score) AS mean FROM data GROUP BY city" /data.csv', "csvcut -e latin1 /latin.csv"]) {
      const result = await shell.exec(command);
      assert.equal(result.stderr, ""); assert.equal(result.exitCode, 0);
      if (command.includes("--query")) assert.equal(result.stdout, "city,mean\nnyc,95.0\nsf,82.0\n");
      if (command.includes("latin1")) assert.equal(result.stdout, "name\ncafé\n");
    }
    assert.equal((await shell.exec('csvsql --query "SELECT COUNT(*) AS total FROM data" /data.csv')).exitCode, 0);
  } finally {await shell.dispose();}
});
it("lets hosts disable default database acquisition", async () => {
  const shell = new Shell({fs: new MemoryFileSystem()}).use(csvkitCommands({databases: []}));
  try {
    const result = await shell.exec('sql2csv --db sqlite:///:memory: --query "SELECT 1"');
    assert.equal(result.exitCode, 78);
    assert.ok(result.stderr.includes("database capability sqlite"));
  } finally {await shell.dispose();}
});
