import { execFileSync, fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { existsSync } from 'node:fs';

for (const termination of ['dispose', 'setup-failure', 'SIGTERM', 'SIGKILL', 'startup-SIGKILL'] as const) {
  test(`owned Chromium group retires after ${termination}`, async () => {
    const host = fork(new URL('./browser-process-lifetime.host.mjs', import.meta.url), [], {
      env: { ...process.env, BROWSER_LIFETIME_MODE: termination,
        BROWSER_LIFETIME_ROOT: new URL('../../../out/issue-133/', import.meta.url).pathname },
      execArgv: ['--import', new URL('./browser-process-lifetime.setup.mjs', import.meta.url).pathname],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    let pid: number | undefined;
    try {
      const [message] = await once(host, 'message', { signal: AbortSignal.timeout(15000) });
      pid = message.pid;
      expect(typeof message.directory).toBe('string');
      const candidates = execFileSync('ps', ['-axo', 'pid=,pgid=,args='], { encoding: 'utf8' })
        .split('\n').map(line => line.trim().split(' ').filter(Boolean))
        .filter(fields => Number(fields[1]) === pid || fields.join(' ').includes('chrome_crashpad_handler'))
        .map(fields => fields[0]);
      const census = spawnSync('lsof', ['-n', '-P', '-a', '-p', candidates.join(','), '-d', 'cwd', '-F', 'pn'], { encoding: 'utf8', timeout: 2000 });
      expect(census.error).toBeUndefined();
      expect([0, 1]).toContain(census.status);
      const owned = new Set<number>();
      let current = 0;
      for (const field of census.stdout.split('\n')) {
        if (field.startsWith('p')) current = Number(field.slice(1));
        else if (field === 'n' + message.directory) owned.add(current);
      }
      expect(owned.has(pid!)).toBe(true);
      const exited = once(host, 'exit');
      if (termination === 'dispose' || termination === 'setup-failure') host.send('dispose');
      else host.kill(termination === 'startup-SIGKILL' ? 'SIGKILL' : termination);
      await exited;
      const deadline = Date.now() + 5000;
      let alive = true;
      while (Date.now() < deadline) {
        try { process.kill(-pid!, 0); }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ESRCH') { alive = false; break; }
          if (code !== 'EPERM') throw error;
        }
        await delay(100);
      }
      expect(alive).toBe(false);
      while (owned.size && Date.now() < deadline) {
        for (const member of owned) {
          try { process.kill(member, 0); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') owned.delete(member); }
        }
        if (owned.size) await delay(100);
      }
      expect([...owned]).toEqual([]);
      while (existsSync(message.directory) && Date.now() < deadline) await delay(100);
      expect(existsSync(message.directory)).toBe(false);
    } finally {
      host.kill('SIGKILL');
      if (pid) {
        try { process.kill(-pid, 'SIGKILL'); }
        catch { /* The lifetime assertion above reports surviving groups. */ }
      }
    }
  }, 25000);
}
