# Detached hook repository native QA

1. Run the original detached-hook control below independently with the imports, `unitFixture`, and `mockExecution` helpers from `scripts/build-workspaces.test.ts`. Keep the original five-second Vitest and Git deadlines. Store any temporary test under `out`.
2. Verify a foreign fixture creates its own branch and local configuration while the parent detached repository config and HEAD bytes remain unchanged. Preserve every assertion below.
3. The fast unit controls in the maintained suite verify all local hook variables are cleared from child environments and preserve caller/global/private configuration.
4. Purge temporary task evidence after verification.

```ts
  describe("detached hook repository isolation", () => {
    let owned: Fixture, decoy: string, foreign: string;
    let environment: NodeJS.ProcessEnv, config: Buffer, head: Buffer;
    const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = environment) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, env, encoding: "utf8", timeout: 5000, maxBuffer: 1048576, stdio: ["ignore", "pipe", "pipe"] });

    beforeAll(() => {
      owned = unitFixture();
      decoy = path.join(owned.root, "decoy");
      foreign = path.join(owned.root, "foreign");
      fs.mkdirSync(decoy); fs.mkdirSync(foreign);
      environment = { PATH: process.env.PATH, HOME: owned.root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
      git(decoy, ["init", "--initial-branch=main"]);
      git(decoy, ["config", "user.name", "Owned Decoy"]);
      git(decoy, ["config", "user.email", "decoy@example.invalid"]);
      git(decoy, ["commit", "--allow-empty", "-m", "owned"]);
      git(decoy, ["checkout", "--detach"]);
      config = fs.readFileSync(path.join(decoy, ".git/config"));
      head = fs.readFileSync(path.join(decoy, ".git/HEAD"));
    });
    afterAll(() => owned?.remove());

    it("keeps foreign fixture configuration and branch creation out of an owned detached hook repository", async () => {
      const mock = mockExecution();
      const parent = Object.freeze({ ...mock.environment, ...environment, GIT_DIR: path.join(decoy, ".git"), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: path.join(decoy, ".git/index") });
      await workspaceRunner.testWorkspaces(owned.root, { ...mock, environment: parent });
      const childEnvironment = mock.start.mock.calls.find(call => call[1][4] === "test:unit")![2].env;
      git(foreign, ["init"], childEnvironment);
      git(foreign, ["config", "user.name", "Owned Fixture"], childEnvironment);
      git(foreign, ["branch", "-M", "main"], childEnvironment);
      expect(git(foreign, ["config", "--local", "user.name"], childEnvironment).trim()).toBe("Owned Fixture");
      expect(git(foreign, ["symbolic-ref", "HEAD"], childEnvironment).trim()).toBe("refs/heads/main");
      expect(fs.readFileSync(path.join(decoy, ".git/config"))).toEqual(config);
      expect(fs.readFileSync(path.join(decoy, ".git/HEAD"))).toEqual(head);
      expect(parent.GIT_DIR).toBe(path.join(decoy, ".git"));
    });
  });

```
