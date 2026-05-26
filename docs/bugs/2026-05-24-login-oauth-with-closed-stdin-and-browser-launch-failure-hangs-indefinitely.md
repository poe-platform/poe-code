# Login OAuth with closed stdin and browser launch failure hangs indefinitely

## Summary

Running the built `poe-code login` OAuth flow in a non-interactive environment can wait forever when standard input is already closed and automatic browser launch fails. The CLI prints that the browser could not be opened, but its manual callback input promise never detects EOF, leaving no remaining authorization channel and no completion or error.

## Reproduction

From the repository root, invoke the built login command with closed stdin and a disposable `open` executable that fails browser launch, then observe that it remains running after both available input mechanisms are unavailable:

```sh
probe=$(mktemp -d /tmp/poe-login-no-channel-cli-probe.XXXXXX)
mkdir -p "$probe/home" "$probe/project" "$probe/bin"

cat > "$probe/bin/open" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x "$probe/bin/open"

cat > "$probe/drive.mjs" <<EOF
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["$PWD/dist/bin.cjs", "--yes", "login"], {
  cwd: "$probe/project",
  env: { ...process.env, HOME: "$probe/home", PATH: "$probe/bin:" + process.env.PATH },
  stdio: ["pipe", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
child.stdin.end();
await new Promise((resolve) => setTimeout(resolve, 1200));
console.log("settled=" + String(child.exitCode !== null));
console.log("waiting=" + String(output.includes("Waiting for authorization")));
console.log("browserFailed=" + String(output.includes("Could not open browser automatically")));
if (child.exitCode === null) {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
EOF

node "$probe/drive.mjs"

nl -ba src/cli/oauth-login.ts | sed -n '6,58p'
```

## Observed Behavior

The login flow is still pending even after stdin is closed and the browser-open command has failed:

```text
settled=false
waiting=true
browserFailed=true
```

`resolveApiKeyViaOAuth()` in `src/cli/oauth-login.ts:6` through `src/cli/oauth-login.ts:38` defines manual callback collection as a promise that resolves only on a readline `line` event, without handling the interface closing before a line is supplied. The browser channel in `src/cli/oauth-login.ts:14` through `src/cli/oauth-login.ts:17` catches and converts browser launch rejection into only a warning, so failure of both channels leaves `authorization.waitForResult()` pending.

## Expected Behavior

If stdin closes before a callback value is entered and browser launch cannot start an authorization flow, `poe-code login` should reject promptly with an actionable non-interactive authentication error rather than continuing to display a waiting state indefinitely.

## Impact

Login can hang unattended CI, remote shells, containers, and headless automation whenever OAuth is selected without usable terminal input or browser integration. Callers receive neither a credential nor an error and must externally kill the process to recover.
