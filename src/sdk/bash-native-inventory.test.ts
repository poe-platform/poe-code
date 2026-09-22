import { expect, it } from 'vitest';
import { MemoryFileSystem } from '@poe-platform/safe-bash';
import { runBash } from './bash.js';
import { createTransport, fixtureDigest } from '../../packages/media-cli/fixtures/transport.js';

it.each([
  'animate', 'compare', 'composite', 'conjure', 'convert', 'display', 'ffmpeg', 'ffprobe',
  'identify', 'import', 'magick', 'magick-script', 'mogrify', 'montage', 'stream',
])('preserves %s SDK argv and executable heredocs through the authenticated protocol', async command => {
  const requests: unknown[] = [];
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  const media = {
    service: 'https://media.test', authToken: 'fixture', buildDigest: fixtureDigest,
    resource: { namespaceId: 'work', logicalRoot: '/', rights: ['read', 'write'] as ('read' | 'write')[],
      grantId: 'host-issued', profile: 'live' as const },
    fetch: createTransport({ observe(request) { requests.push(request); }, output: Uint8Array.of(0, 255, 10) }),
  };
  const settings = { fs, media, cwd: '/work', env: { NATIVE: 'a b' } };
  const direct = await runBash({ ...settings, command,
    args: ['-help', '--media-provider', 'native-value', 'a b', '', Uint8Array.of(255)] });
  const scripted = await runBash({ ...settings, source: `cat > /native.sh <<'EOF'
#!/bin/sh
${command} -help --media-provider native-value 'a b' '' $'\\377'
EOF
chmod +x /native.sh
/native.sh` });
  expect(direct.exitCode).toBe(0);
  expect(scripted.exitCode).toBe(direct.exitCode);
  expect(scripted.stdoutBytes).toEqual(direct.stdoutBytes);
  expect(scripted.stdoutBytes).toEqual(Uint8Array.of(0, 255, 10));
  expect(scripted.stderrBytes).toEqual(direct.stderrBytes);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ toolId: command, cwd: '/work',
    env: expect.objectContaining({ NATIVE: 'a b' }),
    args: ['-help', '--media-provider', 'native-value', 'a b', ''].map(value =>
      Array.from(new TextEncoder().encode(value))).concat([[255]]),
  });
});
