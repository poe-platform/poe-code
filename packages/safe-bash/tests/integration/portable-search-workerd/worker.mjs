import { Shell, browserCommands, portableSearchCommands, FsError } from "@poe-platform/safe-bash/browser";
import { createMemoryFileSystem, FsError as CoreFsError } from "@poe-platform/safe-fs/core";
import { boundedProvider } from "./provider.mjs";

function check(condition, message) { if (!condition) throw new Error(message); }
function clean(provider) {
  const state = provider.evidence;
  check(state.created === state.terminated && state.active === 0 && state.pending === 0 && state.listeners === 0, `unretired provider: ${JSON.stringify(state)}`);
}
async function environment(provider, options = {}) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("first\nsecond\n"));
  await fs.writeFile("/adversarial", new TextEncoder().encode("a".repeat(1000) + "!\n"));
  const shell = new Shell({ fs }).use(browserCommands()).use(portableSearchCommands({ provider, ...options }));
  return shell;
}

export default {
  async test() {
    check(typeof process === "undefined" && typeof Buffer === "undefined" && typeof Worker === "undefined", "unexpected Node/browser Worker globals");
    check(FsError === CoreFsError, "filesystem identity mismatch");
    const results = [];
    const provider = boundedProvider();
    const shell = await environment(provider);
    try {
      for (const script of [
        "printf 'first\\nsecond\\n' | grep second",
        "printf 'first\\nsecond\\n' | rg second",
        "grep -E '^sec.*' /input", "rg '^sec.*' /input",
        "sed -n '/second/p' /input",
        "grep second /input | sed 's/second/found/' | rg found",
      ]) {
        const result = await shell.exec(script);
        check(result.exitCode === 0 && result.stdout === (script.includes("found") ? "found\n" : "second\n"), `${script}: ${JSON.stringify(result)}`);
        results.push({ script, exitCode: result.exitCode, stdout: result.stdout });
      }
    } finally { await shell.dispose(); }
    clean(provider);

    for (const command of ["grep -E", "rg"]) {
      for (const profile of ["work", "deadline"]) {
        const bounded = boundedProvider({ work: profile === "work" ? 512 : 262144 });
        const target = await environment(bounded, { regex: { requestTimeoutMs: profile === "deadline" ? 1 : 1000 } });
        try {
          const result = await target.exec(`${command} '^(a+)+$' /adversarial`);
          check(result.exitCode === 2 && result.stderr.includes(profile === "work" ? "ERE profile limit exceeded" : "REQUEST_TIMEOUT"), `${profile}: ${JSON.stringify(result)}`);
          results.push({ command, profile, error: result.stderr, ...bounded.evidence });
          const recovery = await target.exec("grep second /input");
          check(recovery.exitCode === 0 && recovery.stdout === "second\n", "executor failed to recover");
        } finally { await target.dispose(); }
        clean(bounded);
      }
    }

    for (const action of ["cancel", "dispose"]) {
      const cancellation = new AbortController();
      const reason = new Error("workerd cancellation");
      let armed = true;
      let interruptedActive = false;
      let closing;
      const bounded = boundedProvider({ onActive() {
        if (!armed) return;
        armed = false;
        setTimeout(() => {
          interruptedActive = bounded.evidence.active > 0;
          if (action === "cancel") cancellation.abort(reason);
          else closing = target.dispose();
        }, 0);
      } });
      const target = await environment(bounded);
      let rejected = false;
      try { await target.exec("rg '^(a+)+$' /adversarial", { signal: cancellation.signal }); }
      catch (error) { rejected = action === "dispose" || error === reason; }
      finally { await (closing ?? target.dispose()); }
      check(rejected && interruptedActive && bounded.evidence.work >= 256, `${action} did not interrupt real ERE work: ${JSON.stringify(bounded.evidence)}`);
      clean(bounded);
      results.push({ action, interruptedActive, ...bounded.evidence });
    }

    const limited = boundedProvider();
    const target = await environment(limited, { search: { maxOutputBytes: 1 }, sed: { maxSteps: 8 } });
    try {
      for (const [script, message] of [
        ["rg second /input", "output byte limit"],
        ["sed -n '/z/p' /adversarial", "step limit"],
        [`grep -E '${"a".repeat(257)}' /input`, "pattern byte limit"],
      ]) {
        const result = await target.exec(script);
        check(result.exitCode === 2 && result.stderr.includes(message), `${message}: ${JSON.stringify(result)}`);
        results.push({ budget: message, exitCode: result.exitCode });
      }
    } finally { await target.dispose(); }
    clean(limited);
    console.log("PORTABLE_SEARCH_WORKERD_PASS " + JSON.stringify({ cases: results.length, results }));
  },
};
