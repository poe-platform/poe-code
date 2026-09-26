import assert from 'node:assert/strict';
import { agentCommands, createMemoryFileSystem, Shell } from '@poe-platform/safe-bash';

let retained: { shell: Shell; fs: ReturnType<typeof createMemoryFileSystem>; runs: number } | undefined;

export default { async fetch(request: Request) {
  if (!retained) {
    const fs = createMemoryFileSystem();
    await fs.writeFile('/input', new TextEncoder().encode('2\n3\n'));
    await fs.mkdir('/search');
    await fs.writeFile('/search/input', new TextEncoder().encode('2\n3\n'));
    retained = { fs, shell: new Shell({ fs }).use(agentCommands()), runs: 0 };
  }
  const { shell, fs } = retained;
  const route = new URL(request.url).pathname;
  if (route === '/dispose') {
    await shell.dispose();
    retained = undefined;
    return Response.json({ disposed: true });
  }
  if (route === '/prime' || route === '/prewarm') {
    const result = await shell.exec(route === '/prime' ? ':' : '');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    return Response.json({ route });
  }
  if (route === '/json') {
    const result = await shell.exec('rg --json 2 /search');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
    const lines = result.stdout.split('\n');
    assert.equal(lines.pop(), '');
    return Response.json({ records: lines.map(line => JSON.parse(line)) });
  }
  if (route === '/cancel-awk' || route === '/cancel-jq' || route === '/cancel-rg') {
    const controller = new AbortController();
    const reason = Object.freeze({ cancelled: route });
    let wrote = false;
    const command = route === '/cancel-awk' ? "awk '{ print $1 }' /input"
      : route === '/cancel-rg' ? 'rg -l 2 /search' : "jq -n '42'";
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
  const search = await shell.exec('rg -l 2 /search');
  assert.equal(search.exitCode, 0, search.stderr);
  assert.equal(search.stdout, '/search/input\n');
  return Response.json({ runs: ++retained.runs, output: result.stdout });
} };
