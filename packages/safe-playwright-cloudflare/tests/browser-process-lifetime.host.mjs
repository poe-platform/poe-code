import { launchBrowser, Log } from 'miniflare';
import childProcess from 'node:child_process';

if (process.env.BROWSER_LIFETIME_MODE === 'startup-SIGKILL') {
  const spawn = childProcess.spawn;
  childProcess.spawn = function (command, args, options) {
    const child = spawn.call(this, command, args, options);
    if (options?.detached && args.some(arg => arg.includes('/browser-rendering/profile-'))) {
      process.send({ pid: child.pid, directory: child[Symbol.for('poe-code.native-browser-directory')] });
    }
    return child;
  };
}

const browser = await launchBrowser({
  browserVersion: '126.0.6478.182', headful: false,
  log: new Log(), tmpPath: process.env.BROWSER_LIFETIME_ROOT,
});
if (process.env.BROWSER_LIFETIME_MODE !== 'startup-SIGKILL') process.send({
  pid: browser.browserProcess.nodeProcess.pid,
  directory: browser.browserProcess.nodeProcess[Symbol.for('poe-code.native-browser-directory')],
});
process.on('message', async () => {
  if (process.env.BROWSER_LIFETIME_MODE === 'setup-failure') throw new Error('Injected fixture setup failure');
  await browser.browserProcess.close();
  process.exit(0);
});
