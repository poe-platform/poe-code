import assert from "node:assert/strict";
import { Shell, MemoryFileSystem, readBytes, writeBytes, writeText } from "virtual-bash";

const fs = new MemoryFileSystem();
const shell = new Shell({ fs });
shell.register({ name: "record", async execute(context) {
  await writeText(context.stdout, JSON.stringify(context.args) + "\n");
  return { exitCode: 0 };
} });
shell.register({ name: "emit", async execute(context) {
  await writeBytes(context.stdout, new Uint8Array([0, 255, 10, 127]), context.signal);
  return { exitCode: 0 };
} });
shell.register({ name: "copy", async execute(context) {
  let bytes = 0;
  for await (const chunk of readBytes(context.stdin, context.signal)) {
    bytes += chunk.byteLength;
    assert(bytes <= 128);
    await writeBytes(context.stdout, chunk, context.signal);
  }
  return { exitCode: 0 };
} });
shell.register({ name: "nested", async execute(context) {
  await context.invoke!("eval", ['record "${a[@]}"'], { signal: undefined });
  return { exitCode: 0 };
} });
try {
  const sparse = await shell.exec('a=([9]=nine [0]=zero); a+=([2147483647]=max); record "${a[@]}"; a+=(missing) || true; record "${a[@]}"');
  assert.equal(sparse.stdout, '["zero","nine","max"]\n["zero","nine","max"]\n');
  assert.equal(sparse.exitCode, 0);
  const flow = await shell.exec('a=([2]=outer); f() { local a=inner; a[4]=tail; record "${a[@]}"; }; f; nested; record "${a:-zero}" "${a[@]}"');
  assert.equal(flow.stderr, "");
  assert.equal(flow.stdout, '["inner","tail"]\n["outer"]\n["zero","outer"]\n');
  const splice = await shell.exec('a=(A B); b=(C D); record "${a[@]}:${b[@]}"');
  assert.equal(splice.stdout, '["A","B:C","D"]\n');
  const bytes = await shell.exec('a=(binary); emit "${a[@]}" | copy > /bytes');
  assert.equal(bytes.exitCode, 0);
  assert.deepEqual(await fs.readFile("/bytes"), new Uint8Array([0, 255, 10, 127]));
  await fs.writeFile("/script", new TextEncoder().encode('a[7]=sourced; record "${a[@]}"'));
  assert.equal((await shell.exec('a=(start); source /script')).stdout, '["start","sourced"]\n');
  assert.equal((await shell.exec('record "${a-unset}"')).stdout, '["unset"]\n');
  process.stdout.write(JSON.stringify({ publicFlows: 6, binaryVfsPipe: true, dependencies: 0 }) + "\n");
} finally { await shell.dispose(); }
