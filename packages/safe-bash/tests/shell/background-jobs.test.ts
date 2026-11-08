import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem, agentCommands } from "../../src/index.js";

test("cooperative backgrounding via Shell({ backgroundJobs: true }): cmd &, $!, wait, jobs, disown, kill", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  const shell = new Shell({ fs, cwd: "/work", backgroundJobs: true }).use(agentCommands());
  try {
    const res = await shell.exec(`
(printf 'job1\\n' > /work/j1.txt) &
pid1=$!
(printf 'job2\\n' > /work/j2.txt; exit 7) &
pid2=$!
wait "$pid1"
s1=$?
wait "$pid2"
s2=$?
printf 's1=%s s2=%s\\n' "$s1" "$s2"
cat /work/j1.txt /work/j2.txt
`);
    assert.equal(res.stderr, "");
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, "s1=0 s2=7\njob1\njob2\n");

    const disownRes = await shell.exec(`
(sleep 0.05; printf 'disowned\\n' > /work/disown.txt) &
bgpid=$!
jobs -p | wc -l | tr -d ' '
disown %1
jobs -p | wc -l | tr -d ' '
wait "$bgpid"
printf 'wait_after_disown=%s\\n' "$?"
`);
    assert.equal(disownRes.exitCode, 0);
    assert.equal(disownRes.stdout, "1\n0\nwait_after_disown=127\n");
  } finally {
    await shell.dispose();
  }
});
