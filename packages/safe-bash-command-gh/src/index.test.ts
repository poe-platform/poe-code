import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createGitCommand } from "safe-bash-command-git";
import { createYqQuerySession } from "safe-bash-query-engine";
import type { CommandContext } from "safe-bash-contracts";
import {
  createDefaultOpenSslProvider,
  createDefaultSshProvider,
  createGhCommand,
  createGhCommands,
  createGitHubBackend,
  evalSyncGh,
  ghCommands,
} from "./index.js";

test("synchronous issue comments retain matching creation and update timestamps", () => {
  const backend = createGitHubBackend({ defaultUser: "octocat" });
  const command = createGhCommand({ backend });
  const repo = backend.getOrCreateRepo("octocat", "comments");
  assert.ok(evalSyncGh(command.execute, ["issue", "create", "-R", "octocat/comments", "-t", "Issue", "-b", "Body"], {}));
  const number = [...repo.issues.keys()][0]!;
  for (const args of [["comment", String(number), "--body", "Comment"], ["close", String(number), "--comment", "Closing"]]) {
    assert.notEqual(evalSyncGh(command.execute, ["issue", ...args, "-R", "octocat/comments"], {}), undefined);
    const comment = repo.issues.get(number)!.comments.at(-1)!;
    assert.equal(typeof comment.createdAt, "string");
    assert.equal(comment.updatedAt, comment.createdAt);
  }
});

function createTestHarness(options: Parameters<typeof createGhCommand>[0] = {}) {
  const fs = new MemoryFileSystem();
  const backend = options.backend ?? createGitHubBackend({ defaultUser: "octocat" });
  const gitCmd = createGitCommand();
  const ghCmd = createGhCommand({
    backend,
    git: gitCmd,
    ...options,
  });

  const run = async (
    commandName: "gh" | "git",
    args: readonly string[],
    opts: {
      readonly cwd?: string;
      readonly stdin?: string;
      readonly env?: Record<string, string>;
      readonly allowFailure?: boolean;
    } = {}
  ) => {
    let stdout = "";
    let stderr = "";
    const stdinBytes = opts.stdin ? new TextEncoder().encode(opts.stdin) : new Uint8Array();
    const ctx: CommandContext = {
      command: commandName,
      args,
      cwd: opts.cwd ?? "/work",
      env: { HOME: "/home/octocat", ...(opts.env ?? {}) },
      fs,
      signal: new AbortController().signal,
      stdin: (async function* () {
        if (stdinBytes.length > 0) yield stdinBytes;
      })(),
      stdout: {
        async write(bytes: Uint8Array) {
          stdout += new TextDecoder().decode(bytes);
        },
      },
      stderr: {
        async write(bytes: Uint8Array) {
          stderr += new TextDecoder().decode(bytes);
        },
      },
    };
    const cmd = commandName === "gh" ? ghCmd : gitCmd;
    const result = await cmd.execute(ctx);
    if (!opts.allowFailure) {
      assert.equal(
        result.exitCode,
        0,
        `Command "${commandName} ${args.join(" ")}" failed with exit ${result.exitCode}: ${stderr}`
      );
    }
    return { exitCode: result.exitCode, stdout, stderr };
  };

  return { fs, backend, run };
}

test("plugin and command factories follow safe-bash command contract", async () => {
  assert.equal(createGhCommands()[0]?.name, "gh");
  assert.equal(ghCommands().name, "gh-commands");
  const { run } = createTestHarness();
  await assert.doesNotReject(async () => {
    const ver = await run("gh", ["--version"]);
    assert.match(ver.stdout, /gh version/u);
  });
});

test("end-to-end PR workflow: clone -> branch -> commit -> pr create --fill -> view -> diff -> checks -> review -> merge --squash --delete-branch -> revert", async () => {
  const { fs, backend, run } = createTestHarness();
  await fs.mkdir("/work", { recursive: true });

  // 1. Clone octocat/Hello-World into /work/Hello-World
  const cloneRes = await run("gh", ["repo", "clone", "octocat/Hello-World"]);
  assert.match(cloneRes.stdout, /Cloning into 'Hello-World'/u);
  const repoDir = "/work/Hello-World";

  // Verify real Git repository state in VFS
  const branchRes = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir });
  assert.equal(branchRes.stdout.trim(), "main");
  const readmeText = new TextDecoder().decode(await fs.readFile(`${repoDir}/README.md`));
  assert.match(readmeText, /Welcome to Hello-World/u);

  // 2. Create feature branch and commit changes using real git
  await run("git", ["checkout", "-b", "feat/add-calculator"], { cwd: repoDir });
  await fs.writeFile(
    `${repoDir}/src/calc.ts`,
    new TextEncoder().encode("export const add = (a: number, b: number) => a + b;\n")
  );
  await fs.writeFile(
    `${repoDir}/src/index.ts`,
    new TextEncoder().encode('export const greeting = "Hello, Calculator!";\n')
  );
  await run("git", ["add", "."], { cwd: repoDir });
  await run(
    "git",
    ["commit", "-m", "feat: add calculator module\n\nImplements addition and updates greeting."],
    { cwd: repoDir }
  );

  // 3. Dry-run PR creation first
  const dryRunRes = await run(
    "gh",
    ["pr", "create", "--fill", "--draft", "--label", "enhancement,bug", "--dry-run"],
    { cwd: repoDir }
  );
  assert.match(dryRunRes.stdout, /Would have created a Pull Request in octocat\/Hello-World/u);
  assert.match(dryRunRes.stdout, /Title: feat: add calculator module/u);

  // 4. Create the PR with --fill, labels, assignees, reviewers, and draft
  const createRes = await run(
    "gh",
    [
      "pr",
      "create",
      "--fill",
      "--draft",
      "-l",
      "enhancement,bug",
      "-a",
      "@me",
      "-r",
      "hubot",
    ],
    { cwd: repoDir }
  );
  assert.equal(createRes.stdout.trim(), "https://github.com/octocat/Hello-World/pull/1");

  // Duplicate PR creation on same branch should fail cleanly
  const dupRes = await run("gh", ["pr", "create", "--fill"], {
    cwd: repoDir,
    allowFailure: true,
  });
  assert.equal(dupRes.exitCode, 1);
  assert.match(dupRes.stderr, /already exists/u);

  // 5. List PRs with filters, --json, --jq, and --template
  const listRes = await run("gh", ["pr", "list", "--draft"], { cwd: repoDir });
  assert.match(listRes.stdout, /1\tfeat: add calculator module\tfeat\/add-calculator\tDRAFT/u);

  const jqListRes = await run(
    "gh",
    [
      "pr",
      "list",
      "--search",
      "is:open is:draft label:enhancement",
      "--json",
      "number,title,headRefName,isDraft",
      "--jq",
      ".[0].title",
    ],
    { cwd: repoDir }
  );
  assert.equal(jqListRes.stdout.trim(), "feat: add calculator module");

  const tmplRes = await run(
    "gh",
    [
      "pr",
      "list",
      "--json",
      "number,title",
      "--template",
      "{{range .}}PR #{{.number}}: {{.title}}\\n{{end}}",
    ],
    { cwd: repoDir }
  );
  assert.equal(tmplRes.stdout, "PR #1: feat: add calculator module\n");

  // 6. Mark PR ready for review (and test --undo then ready again)
  const readyRes = await run("gh", ["pr", "ready", "1"], { cwd: repoDir });
  assert.match(readyRes.stdout, /marked as "ready for review"/u);
  await run("gh", ["pr", "ready", "1", "--undo"], { cwd: repoDir });
  await run("gh", ["pr", "ready", "1"], { cwd: repoDir });

  // 7. View PR diff (--name-only, --patch, and full unified diff)
  const diffNames = await run("gh", ["pr", "diff", "1", "--name-only"], { cwd: repoDir });
  assert.equal(diffNames.stdout.trim(), "src/calc.ts\nsrc/index.ts");

  const diffFull = await run("gh", ["pr", "diff", "1"], { cwd: repoDir });
  assert.match(diffFull.stdout, /\+export const add = \(a: number, b: number\) => a \+ b;/u);
  assert.match(diffFull.stdout, /-export const greeting = "Hello, World!";/u);
  assert.match(diffFull.stdout, /\+export const greeting = "Hello, Calculator!";/u);

  const diffPatch = await run("gh", ["pr", "diff", "1", "--patch"], { cwd: repoDir });
  assert.match(diffPatch.stdout, /Subject: \[PATCH\] feat: add calculator module/u);

  // 8. Check CI status codes (pass = 0, pending = 8, fail = 1)
  const checksPass = await run("gh", ["pr", "checks", "1"], { cwd: repoDir });
  assert.equal(checksPass.exitCode, 0);
  assert.match(checksPass.stdout, /build\tpass/u);

  const prObj = backend.getRepo("octocat", "Hello-World")!.pullRequests.get(1)!;
  prObj.statusCheckRollup.push({
    id: 999,
    name: "e2e",
    status: "in_progress",
    conclusion: null,
    workflowName: "CI",
    detailsUrl: "https://github.com/octocat/Hello-World/actions/runs/2",
    startedAt: "2026-09-28T12:00:00Z",
    isRequired: true,
  });
  const checksPending = await run("gh", ["pr", "checks", "1"], {
    cwd: repoDir,
    allowFailure: true,
  });
  assert.equal(checksPending.exitCode, 8);

  prObj.statusCheckRollup[prObj.statusCheckRollup.length - 1] = {
    ...prObj.statusCheckRollup[prObj.statusCheckRollup.length - 1]!,
    status: "completed",
    conclusion: "failure",
  };
  const checksFail = await run("gh", ["pr", "checks", "1"], {
    cwd: repoDir,
    allowFailure: true,
  });
  assert.equal(checksFail.exitCode, 1);
  // Restore passing check
  prObj.statusCheckRollup.pop();

  // 9. PR reviews (--request-changes -> --approve) and comments
  await run("gh", ["pr", "review", "1", "--request-changes", "-b", "Please add docs"], {
    cwd: repoDir,
  });
  const afterReqChanges = await run(
    "gh",
    ["pr", "view", "1", "--json", "reviewDecision", "--jq", ".reviewDecision"],
    { cwd: repoDir }
  );
  assert.equal(afterReqChanges.stdout.trim(), "CHANGES_REQUESTED");

  await run("gh", ["pr", "review", "1", "--approve", "-b", "LGTM now!"], {
    cwd: repoDir,
  });
  const afterApprove = await run(
    "gh",
    ["pr", "view", "1", "--json", "reviewDecision", "--jq", ".reviewDecision"],
    { cwd: repoDir }
  );
  assert.equal(afterApprove.stdout.trim(), "APPROVED");

  await run("gh", ["pr", "comment", "1", "-b", "First comment"], { cwd: repoDir });
  await run("gh", ["pr", "comment", "1", "--edit-last", "-b", "Edited comment"], {
    cwd: repoDir,
  });
  const viewWithComments = await run("gh", ["pr", "view", "1", "--comments"], { cwd: repoDir });
  assert.match(viewWithComments.stdout, /Edited comment/u);

  // 10. PR checkout in another directory
  await fs.mkdir("/work/reviewer-clone", { recursive: true });
  await run("gh", ["repo", "clone", "octocat/Hello-World", "/work/reviewer-clone"]);
  await run("gh", ["pr", "checkout", "1", "-b", "pr-1-local"], {
    cwd: "/work/reviewer-clone",
  });
  const revBranch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: "/work/reviewer-clone",
  });
  assert.equal(revBranch.stdout.trim(), "pr-1-local");
  const checkedOutCalc = new TextDecoder().decode(
    await fs.readFile("/work/reviewer-clone/src/calc.ts")
  );
  assert.match(checkedOutCalc, /export const add/u);

  // 11. Merge PR with --squash --delete-branch
  const mergeRes = await run("gh", ["pr", "merge", "1", "--squash", "--delete-branch"], {
    cwd: repoDir,
  });
  assert.match(mergeRes.stdout, /Merged pull request #1.*via squash and deleted branch feat\/add-calculator/u);

  // Verify local repo switched back to main and contains merged files
  const branchAfterMerge = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoDir,
  });
  assert.equal(branchAfterMerge.stdout.trim(), "main");
  const mainCalc = new TextDecoder().decode(await fs.readFile(`${repoDir}/src/calc.ts`));
  assert.match(mainCalc, /export const add/u);

  // 12. Revert the merged PR
  const revertRes = await run("gh", ["pr", "revert", "1", "-t", "Revert calculator PR"], {
    cwd: repoDir,
  });
  assert.equal(revertRes.stdout.trim(), "https://github.com/octocat/Hello-World/pull/2");
});

test("gh repo create, fork, sync, set-default, edit, and deploy-key workflows", async () => {
  const { fs, run } = createTestHarness();
  await fs.mkdir("/work", { recursive: true });

  // Create repo with --clone, --add-readme, --gitignore, --license
  const createRes = await run("gh", [
    "repo",
    "create",
    "octocat/widget-lib",
    "--public",
    "-d",
    "Widget library",
    "--add-readme",
    "--gitignore",
    "Node",
    "--license",
    "mit",
    "--clone",
  ]);
  assert.equal(createRes.stdout.trim(), "https://github.com/octocat/widget-lib");

  const widgetDir = "/work/widget-lib";
  assert.equal(
    (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: widgetDir })).stdout.trim(),
    "main"
  );

  // Fork octocat/widget-lib into org acme-corp and clone it
  const forkRes = await run("gh", [
    "repo",
    "fork",
    "octocat/widget-lib",
    "--org",
    "acme-corp",
    "--fork-name",
    "widget-lib-fork",
    "--clone",
  ]);
  assert.equal(forkRes.stdout.trim(), "https://github.com/acme-corp/widget-lib-fork");

  const forkDir = "/work/widget-lib-fork";
  const defaultRepo = await run("gh", ["repo", "set-default", "--view"], { cwd: forkDir });
  assert.equal(defaultRepo.stdout.trim(), "octocat/widget-lib");

  // Edit repo settings and topics
  await run("gh", [
    "repo",
    "edit",
    "octocat/widget-lib",
    "-d",
    "Updated Widget Library",
    "--add-topic",
    "typescript,safe-bash",
    "--delete-branch-on-merge",
  ]);
  const repoJson = await run("gh", [
    "repo",
    "view",
    "octocat/widget-lib",
    "--json",
    "description,deleteBranchOnMerge,repositoryTopics",
  ]);
  const parsedRepo = JSON.parse(repoJson.stdout);
  assert.equal(parsedRepo.description, "Updated Widget Library");
  assert.equal(parsedRepo.deleteBranchOnMerge, true);
  assert.equal(parsedRepo.repositoryTopics.length, 2);

  // Deploy keys
  await fs.writeFile(
    "/work/deploy.pub",
    new TextEncoder().encode("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIWidgetDeployKey deploy@ci\n")
  );
  await run("gh", [
    "repo",
    "deploy-key",
    "add",
    "/work/deploy.pub",
    "-t",
    "CI Deploy Key",
    "-w",
    "-R",
    "octocat/widget-lib",
  ]);
  const dkList = await run("gh", ["repo", "deploy-key", "list", "-R", "octocat/widget-lib"]);
  assert.match(dkList.stdout, /CI Deploy Key\tread-write/u);
});

test("injectable OpenSSH and OpenSSL providers are invoked and customizable", async () => {
  const sshCalls: string[] = [];
  const opensslCalls: string[] = [];

  const baseSsh = createDefaultSshProvider();
  const baseOpenSsl = createDefaultOpenSslProvider();

  const { fs, run } = createTestHarness({
    ssh: {
      async connect(host, user, command) {
        sshCalls.push(`connect:${user}@${host}:${command ?? ""}`);
        return baseSsh.connect(host, user, command);
      },
      async fingerprint(pubKey) {
        sshCalls.push(`fingerprint:${pubKey.slice(0, 15)}`);
        return baseSsh.fingerprint(pubKey);
      },
    },
    openssl: {
      async encryptSecretForGitHub(secretValue, pubKey, keyId) {
        opensslCalls.push(`encrypt:${keyId}:${secretValue}`);
        return baseOpenSsl.encryptSecretForGitHub(secretValue, pubKey, keyId);
      },
      async verifyAttestationSignature(bundle, artifactBytes) {
        opensslCalls.push(`verify:${artifactBytes.length}`);
        return baseOpenSsl.verifyAttestationSignature(bundle, artifactBytes);
      },
    },
  });

  await fs.mkdir("/work", { recursive: true });

  // 1. Clone via SSH URL -> triggers ssh.connect
  await run("gh", ["repo", "clone", "git@github.com:octocat/Hello-World.git", "/work/ssh-clone"]);
  assert.ok(sshCalls.some((c) => c.startsWith("connect:git@github.com:")));

  // 2. Add SSH key -> triggers ssh.fingerprint
  await fs.writeFile(
    "/work/id_ed25519.pub",
    new TextEncoder().encode("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey octocat@laptop\n")
  );
  const sshAdd = await run("gh", ["ssh-key", "add", "/work/id_ed25519.pub", "-t", "Laptop"]);
  assert.match(sshAdd.stdout, /Public key added to your account \(SHA256:/u);
  assert.ok(sshCalls.some((c) => c.startsWith("fingerprint:ssh-ed25519")));

  // 3. Set Actions secret -> triggers openssl.encryptSecretForGitHub
  await run("gh", ["secret", "set", "API_TOKEN", "-b", "super-secret-value", "-R", "octocat/Hello-World"]);
  assert.ok(opensslCalls.includes("encrypt:key_1:super-secret-value"));
  const secretList = await run("gh", ["secret", "list", "-R", "octocat/Hello-World"]);
  assert.match(secretList.stdout, /API_TOKEN/u);

  // 4. Verify attestation & release asset -> triggers openssl.verifyAttestationSignature
  await fs.writeFile("/work/artifact.tar.gz", new TextEncoder().encode("binary-payload-bytes"));
  const attestRes = await run("gh", [
    "attestation",
    "verify",
    "/work/artifact.tar.gz",
    "-R",
    "octocat/Hello-World",
  ]);
  assert.match(attestRes.stdout, /Verification succeeded!/u);
  assert.ok(opensslCalls.includes("verify:20"));
});

test("gh api supports REST & GraphQL, :owner/:repo placeholders, typed fields, and --jq/--template", async () => {
  const { fs, run } = createTestHarness();
  await fs.mkdir("/work", { recursive: true });
  await run("gh", ["repo", "clone", "octocat/Hello-World", "/work/Hello-World"]);
  const repoDir = "/work/Hello-World";

  // Create PR via gh api POST
  const postRes = await run(
    "gh",
    [
      "api",
      "repos/:owner/:repo/pulls",
      "-f",
      "title=API Created PR",
      "-f",
      "head=api-branch",
      "-f",
      "base=main",
      "-F",
      "draft=true",
      "--jq",
      ".number",
    ],
    { cwd: repoDir }
  );
  assert.equal(postRes.stdout.trim(), "1");

  // Query GraphQL endpoint
  const gqlRes = await run(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      "query=query($owner: String!, $name: String!) { viewer { login } repository(owner: $owner, name: $name) { nameWithOwner pullRequests { totalCount } } }",
      "-f",
      "owner=octocat",
      "-f",
      "name=Hello-World",
      "--jq",
      ".data.repository.pullRequests.totalCount",
    ],
    { cwd: repoDir }
  );
  assert.equal(gqlRes.stdout.trim(), "1");
});

test("gh issue, release, workflow, run, gist, search, auth, alias, and resource limits", async () => {
  const { fs, run } = createTestHarness();
  await fs.mkdir("/work", { recursive: true });

  // Issue creation + develop --checkout
  await run("gh", ["repo", "clone", "octocat/Hello-World", "/work/Hello-World"]);
  const repoDir = "/work/Hello-World";
  const issueCreate = await run(
    "gh",
    ["issue", "create", "-t", "Fix login crash", "-b", "Steps to reproduce", "-l", "bug"],
    { cwd: repoDir }
  );
  assert.equal(issueCreate.stdout.trim(), "https://github.com/octocat/Hello-World/issues/1");

  const devBranch = await run("gh", ["issue", "develop", "1", "--checkout"], { cwd: repoDir });
  assert.match(devBranch.stdout, /1-fix-login-crash/u);
  assert.equal(
    (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir })).stdout.trim(),
    "1-fix-login-crash"
  );

  // Release create + download
  await fs.writeFile("/work/bundle.zip", new TextEncoder().encode("PK-ZIP-CONTENT"));
  const relCreate = await run(
    "gh",
    ["release", "create", "v1.2.0", "/work/bundle.zip#Release Bundle", "--generate-notes"],
    { cwd: repoDir }
  );
  assert.equal(relCreate.stdout.trim(), "https://github.com/octocat/Hello-World/releases/tag/v1.2.0");

  await run("gh", ["release", "download", "v1.2.0", "-D", "/work/downloaded"], { cwd: repoDir });
  assert.equal(
    new TextDecoder().decode(await fs.readFile("/work/downloaded/bundle.zip")),
    "PK-ZIP-CONTENT"
  );

  // Workflow & Run
  await run("gh", ["workflow", "run", "CI", "-r", "main"], { cwd: repoDir });
  const runList = await run("gh", ["run", "list", "--json", "workflowName,status", "--jq", ".[0].workflowName"], {
    cwd: repoDir,
  });
  assert.equal(runList.stdout.trim(), "CI");

  // Gist create & clone
  const gistCreate = await run("gh", ["gist", "create", "-f", "hello.ts", "-d", "Sample gist"], {
    stdin: 'console.log("hi");\n',
  });
  const gistId = gistCreate.stdout.trim().split("/").pop()!;
  await run("gh", ["gist", "clone", gistId, "/work/my-gist"]);
  assert.equal(
    new TextDecoder().decode(await fs.readFile("/work/my-gist/hello.ts")),
    'console.log("hi");\n'
  );

  // Alias set & invoke
  await run("gh", ["alias", "set", "iv", "issue view $1"]);
  const aliasRes = await run("gh", ["iv", "1"], { cwd: repoDir });
  assert.match(aliasRes.stdout, /Fix login crash #1/u);

  // Auth login --with-token & token
  await run("gh", ["auth", "login", "--with-token", "-u", "kamilio"], {
    stdin: "ghp_custom_secret_token_999\n",
  });
  const tokenRes = await run("gh", ["auth", "token"]);
  assert.equal(tokenRes.stdout.trim(), "ghp_custom_secret_token_999");

  // Resource limit enforcement
  const limited = createTestHarness({ limits: { maxHttpRequests: 0 } });
  const limitRes = await limited.run("gh", ["api", "user"], { allowFailure: true });
  assert.equal(limitRes.exitCode, 1);
  assert.match(limitRes.stderr, /HTTP request limit exceeded/u);
});

test("advanced PR flags (--fill-first, --fill-verbose, --template, --auto, --disable-auto, --match-head-commit, edit, close, reopen, lock, unlock, update-branch, status)", async () => {
  const { fs, backend, run } = createTestHarness();
  await fs.mkdir("/work", { recursive: true });
  await run("gh", ["repo", "clone", "octocat/Hello-World", "/work/Hello-World"]);
  const repoDir = "/work/Hello-World";

  // Create PR template in .github/pull_request_template.md
  await fs.mkdir(`${repoDir}/.github`, { recursive: true });
  await fs.writeFile(
    `${repoDir}/.github/pull_request_template.md`,
    new TextEncoder().encode("## Summary\nTemplate body content\n")
  );

  // Branch 1: test PR template auto-discovery
  await run("git", ["checkout", "-b", "feat/tmpl-branch"], { cwd: repoDir });
  await fs.writeFile(`${repoDir}/a.txt`, new TextEncoder().encode("a\n"));
  await run("git", ["add", "."], { cwd: repoDir });
  await run("git", ["commit", "-m", "Commit A"], { cwd: repoDir });
  await run("gh", ["pr", "create", "-t", "PR with template"], { cwd: repoDir });

  const pr1Body = await run("gh", ["pr", "view", "1", "--json", "body", "--jq", ".body"], {
    cwd: repoDir,
  });
  assert.match(pr1Body.stdout, /Template body content/u);

  // Edit PR #1 (title, labels, reviewers, milestone)
  await run(
    "gh",
    [
      "pr",
      "edit",
      "1",
      "-t",
      "Edited PR Title",
      "--add-label",
      "documentation",
      "--add-reviewer",
      "octocat",
      "-m",
      "v2.0",
    ],
    { cwd: repoDir }
  );

  // Check gh pr status
  const prStatus = await run("gh", ["pr", "status"], { cwd: repoDir });
  assert.match(prStatus.stdout, /#1\s+Edited PR Title \[feat\/tmpl-branch\]/u);

  // Enable and disable auto-merge
  const autoOn = await run("gh", ["pr", "merge", "1", "--auto", "--squash"], { cwd: repoDir });
  assert.match(autoOn.stdout, /Enabled auto-merge \(squash\) for pull request #1/u);
  const autoOff = await run("gh", ["pr", "merge", "1", "--disable-auto"], { cwd: repoDir });
  assert.match(autoOff.stdout, /Disabled auto-merge for pull request #1/u);

  // Test --match-head-commit rejection when SHA mismatches
  const badShaMerge = await run(
    "gh",
    ["pr", "merge", "1", "--match-head-commit", "0000000000000000"],
    { cwd: repoDir, allowFailure: true }
  );
  assert.equal(badShaMerge.exitCode, 1);
  assert.match(badShaMerge.stderr, /does not match expected/u);

  // Lock, unlock, close, reopen, update-branch
  await run("gh", ["pr", "lock", "1", "-r", "resolved"], { cwd: repoDir });
  assert.equal(backend.getRepo("octocat", "Hello-World")!.pullRequests.get(1)!.locked, true);
  await run("gh", ["pr", "unlock", "1"], { cwd: repoDir });
  assert.equal(backend.getRepo("octocat", "Hello-World")!.pullRequests.get(1)!.locked, false);

  await run("gh", ["pr", "close", "1", "-c", "Closing temporarily"], { cwd: repoDir });
  assert.equal(backend.getRepo("octocat", "Hello-World")!.pullRequests.get(1)!.state, "CLOSED");
  await run("gh", ["pr", "reopen", "1", "-c", "Reopening now"], { cwd: repoDir });
  assert.equal(backend.getRepo("octocat", "Hello-World")!.pullRequests.get(1)!.state, "OPEN");

  await run("gh", ["pr", "update-branch", "1", "--rebase"], { cwd: repoDir });
});

test("custom HTTP transport intercepts GitHub API calls and enforces HTTP byte limits", async () => {
  const seenUrls: string[] = [];
  const { run } = createTestHarness({
    http: async (req) => {
      seenUrls.push(`${req.method} ${req.url}`);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify({ login: "custom-http-user", id: 42 })),
      };
    },
  });

  const res = await run("gh", ["api", "user", "--jq", ".login"]);
  assert.equal(res.stdout.trim(), "custom-http-user");
  assert.deepEqual(seenUrls, ["GET https://api.github.com/user"]);
});

test("gh search, label, variable, cache, gpg-key, config, status, and browse commands", async () => {
  const { run } = createTestHarness();
  await run("gh", ["label", "create", "priority:high", "-c", "ff0000", "-d", "High priority", "-R", "octocat/Hello-World"]);
  const lbls = await run("gh", ["label", "list", "-R", "octocat/Hello-World"]);
  assert.match(lbls.stdout, /priority:high\tHigh priority\t#ff0000/u);

  await run("gh", ["variable", "set", "DEPLOY_ENV", "-b", "production", "-R", "octocat/Hello-World"]);
  const varGet = await run("gh", ["variable", "get", "DEPLOY_ENV", "-R", "octocat/Hello-World"]);
  assert.equal(varGet.stdout.trim(), "production");

  const cacheList = await run("gh", ["cache", "list", "-R", "octocat/Hello-World"]);
  assert.match(cacheList.stdout, /node-modules-main/u);
  await run("gh", ["cache", "delete", "--all", "-R", "octocat/Hello-World"]);

  const gpgAdd = await run("gh", ["gpg-key", "add", "-t", "Work GPG"], {
    stdin: "-----BEGIN PGP PUBLIC KEY BLOCK-----\nTESTKEY\n-----END PGP PUBLIC KEY BLOCK-----\n",
  });
  assert.match(gpgAdd.stdout, /GPG key [0-9A-F]{16} added/u);

  await run("gh", ["config", "set", "editor", "nano"]);
  const cfgGet = await run("gh", ["config", "get", "editor"]);
  assert.equal(cfgGet.stdout.trim(), "nano");

  const searchRepos = await run("gh", ["search", "repos", "Hello-World"]);
  assert.match(searchRepos.stdout, /octocat\/Hello-World/u);

  const browseUrl = await run("gh", ["browse", "src/index.ts", "-n", "-R", "octocat/Hello-World"]);
  assert.equal(browseUrl.stdout.trim(), "https://github.com/octocat/Hello-World/blob/main/src/index.ts");

  const statusOut = await run("gh", ["status"]);
  assert.match(statusOut.stdout, /Assigned Pull Requests/u);
});

test("gh and git plugins work seamlessly inside @poe-platform/safe-bash Shell scripts and pipelines", async () => {
  const { Shell, standardCommands, gitCommands } = await import(
    "@poe-platform/safe-bash"
  );
  const { ghCommands } = await import("@poe-platform/safe-bash/commands/gh");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/workspace", { recursive: true });

  const script = [
    "set -e",
    "cd /workspace",
    "gh repo clone octocat/Hello-World",
    "cd Hello-World",
    "git checkout -b feat/shell-script-pr",
    "printf 'export const version = 2;\\n' > src/version.ts",
    "git add src/version.ts",
    "git commit -m 'feat: add version export'",
    "PR_URL=$(gh pr create --fill -l enhancement)",
    "PR_NUM=$(gh pr view --json number -q .number)",
    "gh pr review \"$PR_NUM\" --approve -b 'Ship it'",
    "gh pr merge \"$PR_NUM\" --squash --delete-branch",
    "printf 'MERGED:%s:%s\\n' \"$PR_NUM\" \"$(git rev-parse --abbrev-ref HEAD)\"",
  ].join("\n");

  await fs.writeFile("/workspace/workflow.sh", new TextEncoder().encode(script));

  const shell = new Shell({
    fs,
    cwd: "/workspace",
  })
    .use(standardCommands())
    .use(gitCommands())
    .use(ghCommands());

  const result = await shell.exec("sh /workspace/workflow.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /MERGED:1:main/u);
  assert.equal(
    new TextDecoder().decode(await fs.readFile("/workspace/Hello-World/src/version.ts")),
    "export const version = 2;\n"
  );
});

test("gh project, ruleset, org, extension, codespace, repo autolink, and built-in co alias work end to end", async () => {
  const { run } = createTestHarness();
  const repoCwd = "/work/safe-bash";

  // Clone repo & create PR to test built-in `gh co` alias
  await run("gh", ["repo", "clone", "poe-platform/safe-bash"]);
  await run("git", ["checkout", "-b", "feat/co-alias"], { cwd: repoCwd });
  await run("git", ["commit", "--allow-empty", "-m", "feat: alias checkout"], { cwd: repoCwd });
  await run("gh", ["pr", "create", "--title", "Test co alias", "--body", "Body"], { cwd: repoCwd });
  await run("git", ["checkout", "main"], { cwd: repoCwd });
  const coRes = await run("gh", ["co", "1"], { cwd: repoCwd });
  assert.equal(coRes.exitCode, 0, coRes.stderr);
  const branchRes = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoCwd });
  assert.equal(branchRes.stdout.trim(), "feat/co-alias");

  // repo autolink
  await run("gh", ["repo", "autolink", "create", "JIRA-", "https://jira.example.com/browse/<num>"], { cwd: repoCwd });
  const autolinkList = await run("gh", ["repo", "autolink", "list", "--json", "keyPrefix,urlTemplate"], { cwd: repoCwd });
  assert.equal(JSON.parse(autolinkList.stdout)[0].keyPrefix, "JIRA-");

  // org list
  const orgList = await run("gh", ["org", "list"]);
  assert.match(orgList.stdout, /poe-platform/u);

  // ruleset list / view / check
  const rulesetList = await run("gh", ["ruleset", "list"], { cwd: repoCwd });
  assert.match(rulesetList.stdout, /main-branch-protection/u);
  const rulesetCheck = await run("gh", ["ruleset", "check", "main"], { cwd: repoCwd });
  assert.match(rulesetCheck.stdout, /required_status_checks/u);

  // project create / field-create / item-create / item-list / view / close
  await run("gh", ["project", "create", "--title", "Roadmap 2026", "--owner", "poe-platform"]);
  await run("gh", ["project", "field-create", "1", "--name", "Priority", "--data-type", "SINGLE_SELECT"]);
  await run("gh", ["project", "item-create", "1", "--title", "Ship safe-bash-command-gh", "--body", "Complete"]);
  const projItems = await run("gh", ["project", "item-list", "1", "--format", "json"]);
  assert.equal(JSON.parse(projItems.stdout).totalCount, 1);

  // extension install / list / remove
  await run("gh", ["extension", "install", "dlhdr/gh-dash"]);
  const extList = await run("gh", ["extension", "list"]);
  assert.match(extList.stdout, /gh-dash/u);
  await run("gh", ["extension", "remove", "gh-dash"]);

  // codespace create / list / stop / delete
  const csCreate = await run("gh", ["codespace", "create", "-r", "poe-platform/safe-bash", "-b", "main"]);
  const csName = csCreate.stdout.trim();
  const csList = await run("gh", ["codespace", "list", "--json", "name,state"]);
  assert.equal(JSON.parse(csList.stdout)[0].name, csName);
  await run("gh", ["codespace", "stop", "-c", csName]);
  await run("gh", ["codespace", "delete", "-c", csName]);
});

test("release edits apply notes, target, latest, and renamed URLs", async () => {
  const { fs, run } = createTestHarness();
  await fs.mkdir("/work", { recursive: true });
  await fs.writeFile("/work/asset.bin", new TextEncoder().encode("asset"));
  await fs.writeFile("/work/notes.md", new TextEncoder().encode("file notes\n"));
  const repo = ["-R", "octocat/Hello-World"];
  await run("gh", ["release", "create", "stable", ...repo]);
  await run("gh", ["release", "create", "old", "/work/asset.bin", "--prerelease", ...repo]);
  await run("gh", ["release", "edit", "old", "-F", "notes.md", "--target", "release-branch", "--latest", "--tag", "new", ...repo]);
  const fields = "tagName,body,targetCommitish,isLatest,url,assets";
  const result = JSON.parse((await run("gh", ["release", "view", "new", "--json", fields, ...repo])).stdout);
  assert.equal(result.body, "file notes\n");
  assert.equal(result.targetCommitish, "release-branch");
  assert.equal(result.isLatest, true);
  assert.equal(result.tagName, "new");
  assert.equal(result.url, "https://github.com/octocat/Hello-World/releases/tag/new");
  assert.equal(result.assets[0].url, "https://github.com/octocat/Hello-World/releases/download/new/asset.bin");
  assert.equal(JSON.parse((await run("gh", ["release", "view", "stable", "--json", "isLatest", ...repo])).stdout).isLatest, false);
  await run("gh", ["release", "edit", "new", "--notes-file", "-", "--latest=false", ...repo], { stdin: "stdin notes" });
  const edited = JSON.parse((await run("gh", ["release", "view", "new", "--json", "body,isLatest", ...repo])).stdout);
  assert.deepEqual(edited, { body: "stdin notes", isLatest: false });
});

test("release downloads protect existing assets and archives unless clobbered", async () => {
  const { fs, run } = createTestHarness();
  await fs.mkdir("/work", { recursive: true });
  await fs.writeFile("/work/asset.bin", new TextEncoder().encode("asset"));
  const repo = ["-R", "octocat/Hello-World"];
  await run("gh", ["release", "create", "v1", "/work/asset.bin", ...repo]);
  for (const flags of [[], ["-O", "custom.bin"], ["--archive", "zip"], ["--archive", "zip", "-O", "custom.zip"]]) {
    const dest = flags.includes("custom.bin") ? "/work/custom.bin" : flags.includes("custom.zip") ? "/work/custom.zip" : flags.includes("zip") ? "/work/Hello-World-v1.zip" : "/work/asset.bin";
    await fs.writeFile(dest, new TextEncoder().encode("keep"));
    const args = ["release", "download", "v1", ...flags, ...repo];
    const failed = await run("gh", args, { allowFailure: true });
    assert.equal(failed.exitCode, 1);
    assert.ok(failed.stderr.includes("already exists"));
    assert.equal(new TextDecoder().decode(await fs.readFile(dest)), "keep");
    await run("gh", [...args, "--skip-existing"]);
    assert.equal(new TextDecoder().decode(await fs.readFile(dest)), "keep");
    await run("gh", [...args, "--clobber"]);
    assert.notEqual(new TextDecoder().decode(await fs.readFile(dest)), "keep");
  }
});

test("release jq formatting receives the configured output limit", async (t) => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  const prototype = Object.getPrototypeOf(session.ownedWork) as typeof session.ownedWork;
  const stringify = prototype.stringifyJson;
  const caps: (number | undefined)[] = [];
  t.mock.method(prototype, "stringifyJson", function (
    this: typeof session.ownedWork,
    ...args: Parameters<typeof stringify>
  ) {
    caps.push(args[1]?.maxBytes);
    return stringify.apply(this, args);
  });
  await session.close();
  const { run } = createTestHarness({ limits: { maxOutputBytes: 100 } });
  await run("gh", ["release", "create", "v1", "-R", "octocat/Hello-World", "--notes", "x".repeat(200)]);
  const result = await run("gh", ["release", "view", "v1", "-R", "octocat/Hello-World", "--json", "body", "--jq", ". | length"], { allowFailure: true });
  // Serialization of the selected object must respect the configured query limit.
  const bounded = await run("gh", ["release", "view", "v1", "-R", "octocat/Hello-World", "--json", "body", "--jq", "."], { allowFailure: true });
  assert.equal(result.exitCode, 0);
  assert.equal(bounded.exitCode, 1);
  assert.ok(caps.length > 0);
  assert.ok(caps.every((cap) => cap === 100));
});
