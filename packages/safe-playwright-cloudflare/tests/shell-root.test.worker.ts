import assert from 'node:assert/strict';
import { agentCommands, createMemoryFileSystem, Shell } from '@poe-platform/safe-bash';

let retained: { shell: Shell; fs: ReturnType<typeof createMemoryFileSystem>; runs: number } | undefined;

export default { async fetch(request: Request) {
  if (!retained) {
    const fs = createMemoryFileSystem();
    await fs.writeFile('/input', new TextEncoder().encode('2\n3\n'));
    retained = { fs, shell: new Shell({ fs }).use(agentCommands()), runs: 0 };
  }
  const { shell, fs } = retained;
  const route = new URL(request.url).pathname;
  if (route === '/dispose') {
    await shell.dispose();
    retained = undefined;
    return Response.json({ disposed: true });
  }
  if (route === '/cancel-awk' || route === '/cancel-jq') {
    const controller = new AbortController();
    const reason = Object.freeze({ cancelled: route });
    let wrote = false;
    const command = route === '/cancel-awk' ? "awk '{ print $1 }' /input" : "jq -n '42'";
    await assert.rejects(shell.exec(command + '; printf unexpected > /cancelled', {
      signal: controller.signal,
      stdout: { async write() { wrote = true; controller.abort(reason); } },
    }), error => error === reason);
    assert.equal(wrote, true);
    await assert.rejects(fs.stat('/cancelled'), { code: 'ENOENT' });
    return Response.json({ cancelled: true });
  }
  assert.equal(route, '/run');
  if (retained.runs > 0) assert.equal(new TextDecoder().decode(await fs.readFile('/result')), '10\n');
  const result = await shell.exec("awk '{ total += $1 } END { print total }' /input | jq '. * 2' > /result; cat /result");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '10\n');
  assert.equal(new TextDecoder().decode(await fs.readFile('/result')), '10\n');
  return Response.json({ runs: ++retained.runs, output: result.stdout });
} };
