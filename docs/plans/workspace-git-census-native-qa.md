# Workspace Git census native QA

1. Execute the original control below independently with actual Node `execFileSync`, the imports, `unitFixture`, and `mockExecution` helpers from `scripts/build-workspaces.test.ts`. Do not install its Git census mock. Keep the original five-second deadline.
2. Verify every variable supplied by the installed Git census is cleared from child environments, while the parent environment and private/global configuration remain unchanged.
3. The maintained runner still performs a fresh actual Git census before real unit children. Fast unit fixtures use a controlled census including an additional synthetic local variable to verify the code derives membership from the response.
4. Store temporary evidence under `out` and purge it after verification.

```ts
  it("clears Git's repository-local hook environment without changing the parent or private configuration", async () => {
    const owned = unitFixture(), mock = mockExecution();
    try {
      const names = execFileSync("git", ["rev-parse", "--local-env-vars"], {
        cwd: owned.root, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
        encoding: "utf8", timeout: 5000, maxBuffer: 65536
      }).trim().split("\n");
      const retained = { GIT_CONFIG_GLOBAL: "/owned/private.gitconfig", GIT_CONFIG_SYSTEM: "/owned/system.gitconfig", GIT_CONFIG_NOSYSTEM: "1", GIT_SSH_COMMAND: "owned-ssh", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", HOME: owned.root };
      const environment = Object.freeze({ ...mock.environment, ...retained, ...Object.fromEntries(names.map(name => [name, `owned-hook-${name}`])) });
      await workspaceRunner.testWorkspaces(owned.root, { ...mock, environment });
      expect(mock.start).toHaveBeenCalledTimes(5);
      for (const call of mock.start.mock.calls) {
        for (const name of names) expect(call[2].env).not.toHaveProperty(name);
        expect(call[2].env).toMatchObject(retained);
      }
      for (const name of names) expect(environment[name as keyof typeof environment]).toBe(`owned-hook-${name}`);
    } finally { owned.remove(); }
  });

```
