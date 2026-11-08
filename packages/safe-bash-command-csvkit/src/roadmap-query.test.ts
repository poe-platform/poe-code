import { expect, test } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { csvkitCommands } from "./command.js";

test("default csvsql joins VFS CSV tables and groups numeric sums through Shell", async () => {
  const shellSource: string = "../../safe-bash/src/shell/shell.js";
  const { Shell } = await import(shellSource);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/customers.csv", new TextEncoder().encode("id,name\n1,Alice\n2,Bob\n3,Alice\n4,No orders\n"));
  await fs.writeFile("/orders.csv", new TextEncoder().encode("customer_id,amount\n1,10.5\n2,3\n1,7.25\n3,2.5\n2,4.5\n99,1000\n"));
  const shell = new Shell({ fs, cwd: "/" }).use(csvkitCommands());
  try {
    const result = await shell.exec(`csvsql --query 'SELECT customers.name, SUM(orders.amount) AS total, COUNT(*) AS orders_count FROM orders JOIN customers ON orders.customer_id = customers.id GROUP BY customers.name ORDER BY total DESC' orders.csv customers.csv`);
    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "name,total,orders_count\nAlice,20.25,3\nBob,7.5,2\n",
    });
  } finally { await shell.dispose(); }
});
