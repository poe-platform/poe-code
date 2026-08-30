export function generate() {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  return { rawInput: true, reason: 'avoid PTY canonical line truncation; dropped unexecuted input cleared before parsing' };
}
