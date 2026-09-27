# Workspace selector native QA

1. Run the original selector suite below with actual `/bin/sh`, keeping the five-second subprocess deadline. Use the imports and `runnerFilename` declaration from `scripts/build-workspaces.test.ts` in a temporary test under `out`.
2. Verify all workspace/event/enumeration combinations, coverage flag, current and future nested selectors, and stderr assertions.
3. Purge task evidence after validation.

```ts
describe("maintained literal workspace test selectors", () => {
  const root = path.dirname(path.dirname(runnerFilename));

  function captureArguments(
    workspace: string,
    event: "test" | "test:unit",
    enumeration: "unavailable" | "empty" | "nonempty"
  ) {
    const directory = path.join(root, "packages", workspace);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    const result = spawnSync(
      "/bin/sh",
      [
        "-c",
        [
          'sort() { /usr/bin/sort "$@"; }',
          'tr() { /usr/bin/tr "$@"; }',
          'vitest() { printf "%s\\000" "$@"; }',
          enumeration === "empty"
            ? "rg() { return 0; }"
            : enumeration === "nonempty"
              ? `rg() { printf '%s\\n' 'packages/${workspace}/src/current.test.ts' 'packages/${workspace}/src/future/nested.test.ts'; }`
              : "",
          manifest.scripts[event]
        ].join("\n")
      ],
      { cwd: directory, env: { ...process.env, PATH: "" }, encoding: "utf8", timeout: 5000 }
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    return { arguments: result.stdout.split("\0").slice(0, -1), stderr: result.stderr };
  }

  it("uses owned directories rather than shell-expanded wildcard file lists", () => {
    for (const workspace of ["agent-gaslight", "agent-spawn", "agent-trace-viewer", "agent-traces", "markdown-reader", "process-launcher", "process-runner", "workspace-resolver"]) {
      for (const event of ["test", "test:unit"] as const) {
        const captured = captureArguments(workspace, event, "unavailable");
        expect(captured.arguments.filter(argument => argument.startsWith("packages/")), `${workspace}:${event}`)
          .toEqual([`packages/${workspace}/src/`]);
        expect(captured.stderr).toBe("");
        if (workspace === "markdown-reader" && event === "test") {
          expect(captured.arguments).toContain("--coverage.thresholds.lines=90");
        }
      }
    }
  });

  for (const workspace of ["superintendent", "terminal-pilot"]) {
    for (const event of ["test", "test:unit"] as const) {
      for (const enumeration of ["unavailable", "empty", "nonempty"] as const) {
        it(`${workspace} ${event} keeps its directory filter when rg is ${enumeration}`, () => {
          expect(captureArguments(workspace, event, enumeration)).toEqual({
            arguments: ["run", `packages/${workspace}/src/`, ...(workspace === "terminal-pilot" ? ["--pool=forks"] : [])],
            stderr: ""
          });
        });
      }
    }

    it(`${workspace} retains current and future nested src paths without enumerating filenames in argv`, () => {
      const { arguments: capturedArguments } = captureArguments(workspace, "test:unit", "empty");
      const selector = capturedArguments[1];
      expect(selector).toBe(`packages/${workspace}/src/`);
      const current = fastGlob.sync(`packages/${workspace}/src/**/*.test.ts`, { cwd: root });
      expect(current.length).toBeGreaterThan(0);
      for (const filename of [
        ...current,
        `packages/${workspace}/src/future/deep/new.test.ts`,
        `packages/${workspace}/src/future/deep/new.spec.ts`
      ]) {
        expect(filename.startsWith(selector!)).toBe(true);
        expect(capturedArguments).not.toContain(filename);
      }
      expect(`packages/${workspace}/src-sibling/other.test.ts`.startsWith(selector!)).toBe(false);
      expect("packages/terminal-pilot/scripts/build-assets.test.ts".startsWith(selector!)).toBe(
        false
      );
    });
  }
});

```
