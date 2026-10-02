import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createShufCommand, evalSyncShuf } from "./index.js";

async function shuffle(args: string[], input = "") {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/one", new TextEncoder().encode("only_one\n"));
  await fs.writeFile("/random", new Uint8Array());
  let stdout = "", stderr = "";
  const result = await createShufCommand().execute({
    command: "shuf", args, cwd: "/", env: { LC_ALL: "C" }, fs,
    stdin: toByteSource(input), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { exitCode: result.exitCode, stdout, stderr };
}

for (const [args, value] of [
  [["-n", "1abc"], "1abc"], [["--head-count=0foo"], "0foo"],
  [["-n1 "], "1 "], [["-n", "18446744073709551616x"], "18446744073709551616x"],
] as const) test(`shuf rejects the entire invalid count ${value}`, async () => {
  const argv = [...args, "-e", "a", "b"];
  assert.deepEqual(await shuffle(argv), { exitCode: 1, stdout: "", stderr: `shuf: invalid line count: '${value}'\n` });
  assert.equal(evalSyncShuf(undefined, argv), undefined);
});

for (const args of [["-e", "only_one"], ["-i5-5"], ["/one"], []]) {
  test(`shuf opens a requested random source for one record: ${args.join(" ") || "stdin"}`, async () => {
    assert.deepEqual(await shuffle([...args, "--random-source=/missing"], "only_one\n"), {
      exitCode: 1, stdout: "", stderr: "shuf: /missing: No such file or directory\n",
    });
    const result = await shuffle([...args, "--random-source=/random"], "only_one\n");
    assert.deepEqual(result, { exitCode: 0, stdout: args[0] === "-i5-5" ? "5\n" : "only_one\n", stderr: "" });
    assert.equal(evalSyncShuf(new TextEncoder().encode("only_one\n"), [...args, "--random-source=/missing"], () => undefined), undefined);
  });
}

for (const args of [["/missing-input"], ["-e", "one"], ["-i5-5"], []]) test(`shuf zero count skips random-source admission: ${args.join(" ")}`, async () => {
  assert.deepEqual(await shuffle(["-n0", ...args, "--random-source=/missing"]), { exitCode: 0, stdout: "", stderr: "" });
});

for (const count of ["18446744073709551615", "18446744073709551616"]) test(`shuf accepts explicit unsigned-maximum count ${count}`, async () => {
  assert.deepEqual(await shuffle(["-r", "-n", count, "-e"]), { exitCode: 1, stdout: "", stderr: "shuf: no lines to repeat\n" });
  for (const args of [["-n", count, "-n1"], ["-n1", "--head-count=" + count]]) {
    assert.deepEqual(await shuffle(["-r", ...args, "-e", "one"]), { exitCode: 0, stdout: "one\n", stderr: "" });
  }
});
