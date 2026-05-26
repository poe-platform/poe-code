# Logout reports already logged out after deleting stored credential

## Summary

After a successful credential-only Poe login, running top-level `logout` removes the stored authentication files but prints `Already logged out.` instead of reporting that it performed the logout.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and stubbed Poe identity response

## Reproduction

From the repository root, log in without configuring any agents, then log out and inspect credential status:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(
  JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
  { status: 200, headers: { 'content-type': 'application/json' } }
);
EOF
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run login --api-key logged-in-secret
find "$probe/home/.poe-code" -type f -print | sort
run logout
find "$probe/home/.poe-code" -type f -print | sort 2>/dev/null || true
run auth status
```

## Observed Behavior

- After `login --api-key logged-in-secret`, both `~/.poe-code/credentials.enc` and `~/.poe-code/credentials.poe.enc` exist.
- `logout` exits successfully and removes the stored credential files, as confirmed by the empty post-logout file listing and a later `auth status` response of `Not logged in`.
- Despite performing the authentication deletion, `logout` prints `Already logged out.`.

## Expected Behavior

When top-level logout deletes an existing stored credential, it must report that the logout occurred, regardless of whether there was a global configuration file to delete.

## Impact

- Users receive contradictory feedback for a successful credential deletion operation.
- Scripts and support diagnostics cannot distinguish “no authenticated state existed” from “stored authentication was removed but no service config file existed.”
- The message undermines confidence in whether secret-bearing state was actually deleted.

## Supporting Evidence

In `src/cli/commands/logout.ts`, `executeLogout(...)` calls `container.deleteApiKey()` and then chooses between `Logged out.` and `Already logged out.` solely from the boolean returned by `deleteConfig(...)` for the global config file. Credential deletion success is not included in the completion decision, so credential-only logouts are misreported.

## Suspected Area

Logout completion status needs to incorporate whether stored Poe authentication was deleted, not only whether `~/.poe-code/config.json` existed.
