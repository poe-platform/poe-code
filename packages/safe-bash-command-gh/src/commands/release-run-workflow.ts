import { isFsError, resolvePath } from "@poe-code/safe-fs/core";
import { type CommandContext } from "safe-bash-contracts";
import {
  getBoolFlag,
  getIntFlag,
  getStringArrayFlag,
  getStringFlag,
  parseCommandArgs,
  type FlagSchema,
} from "../args.js";
import type { GitHubBackend } from "../backend.js";
import { bytesToHex, decodeUtf8, encodeUtf8, sha1Sync } from "../crypto-ssh.js";
import { resolveRepoFromContext } from "../git-vfs.js";
import { formatCommandOutput } from "../template.js";
import type {
  GhBrowserOpener,
  GhLimits,
  GhOpenSslProvider,
  GhRelease,
  GhReleaseAsset,
  GhWorkflow,
  GhWorkflowRun,
} from "../types.js";

export const RELEASE_JSON_FIELDS: readonly string[] = [
  "apiUrl",
  "assets",
  "author",
  "body",
  "createdAt",
  "databaseId",
  "id",
  "isDraft",
  "isImmutable",
  "isLatest",
  "isPrerelease",
  "name",
  "publishedAt",
  "tagName",
  "tarballUrl",
  "targetCommitish",
  "uploadUrl",
  "url",
  "zipballUrl",
];

export const RUN_JSON_FIELDS: readonly string[] = [
  "attempt",
  "conclusion",
  "createdAt",
  "databaseId",
  "displayTitle",
  "event",
  "headBranch",
  "headSha",
  "jobs",
  "name",
  "number",
  "startedAt",
  "status",
  "updatedAt",
  "url",
  "workflowDatabaseId",
  "workflowName",
];

export const WORKFLOW_JSON_FIELDS: readonly string[] = [
  "id",
  "name",
  "path",
  "state",
];

function globMatches(pattern: string, candidate: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*/gu, ".*")
    .replace(/\?/gu, ".");
  return new RegExp(`^${escaped}$`, "iu").test(candidate);
}

export interface ReleaseRunWorkflowEnv {
  readonly context: CommandContext;
  readonly backend: GitHubBackend;
  readonly openssl: GhOpenSslProvider;
  readonly openBrowser?: GhBrowserOpener | undefined;
  readonly limits: GhLimits;
  readonly readStdinText: () => Promise<string>;
  readonly writeOut: (text: string) => Promise<void>;
  readonly writeErr: (text: string) => Promise<void>;
}

export async function handleReleaseCommand(
  env: ReleaseRunWorkflowEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, openssl, openBrowser, readStdinText, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  const restArgs = rawArgs.slice(1);

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut(
      [
        "Manage GitHub releases.",
        "",
        "USAGE",
        "  gh release <command> [flags]",
        "",
        "AVAILABLE COMMANDS",
        "  create:        Create a new release",
        "  list (ls):     List releases in a repository",
        "  view:          View information about a release",
        "  edit:          Edit a release",
        "  upload:        Upload assets to a release",
        "  download:      Download assets from a release",
        "  delete:        Delete a release",
        "  delete-asset:  Delete an asset from a release",
        "  verify:        Verify the attestation for a release",
        "  verify-asset:  Verify that a given asset originated from a release",
        "",
      ].join("\n")
    );
    return 0;
  }

  const coords = await resolveRepoFromContext(
    context,
    parseCommandArgs(restArgs, []).repoFlag,
    backend.defaultHost,
    backend.getActiveUser()
  );
  const repo = backend.getOrCreateRepo(coords.owner, coords.name);

  const serializeRelease = (r: GhRelease) => ({
    ...r,
    databaseId: r.id,
    apiUrl: `https://api.github.com/repos/${repo.nameWithOwner}/releases/${r.id}`,
    tarballUrl: `${repo.url}/archive/refs/tags/${r.tagName}.tar.gz`,
    zipballUrl: `${repo.url}/archive/refs/tags/${r.tagName}.zip`,
    uploadUrl: `https://uploads.github.com/repos/${repo.nameWithOwner}/releases/${r.id}/assets`,
    isImmutable: false,
    assets: r.assets.map((a) => ({
      id: a.id,
      name: a.name,
      label: a.label,
      size: a.size,
      contentType: a.contentType,
      downloadCount: a.downloadCount,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      url: a.url,
    })),
  });

  if (subcommand === "create") {
    const schemas: FlagSchema[] = [
      { short: "t", long: "title", type: "string" },
      { short: "n", long: "notes", type: "string" },
      { short: "F", long: "notes-file", type: "string" },
      { long: "generate-notes", type: "boolean" },
      { short: "d", long: "draft", type: "boolean" },
      { short: "p", long: "prerelease", type: "boolean" },
      { long: "target", type: "string" },
      { long: "latest", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const tagName = parsed.positionals[0];
    if (!tagName) {
      await writeErr("release tag required\n");
      return 1;
    }

    const notesFile = getStringFlag(parsed, "notes-file");
    let body =
      notesFile !== undefined
        ? notesFile === "-"
          ? await readStdinText()
          : decodeUtf8(await context.fs.readFile(resolvePath(context.cwd, notesFile), { signal: context.signal }))
        : (getStringFlag(parsed, "notes") ?? "");

    if (!body && getBoolFlag(parsed, "generate-notes")) {
      const prs = Array.from(repo.pullRequests.values());
      body =
        "## What's Changed\n" +
        (prs.length > 0
          ? prs.map((p) => `* ${p.title} by @${p.author.login} in #${p.number}`).join("\n")
          : `* Release ${tagName}`);
    }

    const ts = backend.isoNow();
    const isDraft = getBoolFlag(parsed, "draft");
    const isPrerelease = getBoolFlag(parsed, "prerelease");
    const isLatest = parsed.flags.has("latest")
      ? getBoolFlag(parsed, "latest")
      : !isDraft && !isPrerelease;

    if (isLatest) {
      for (const existing of repo.releases.values()) existing.isLatest = false;
    }

    const assets: GhReleaseAsset[] = [];
    for (const fileSpec of parsed.positionals.slice(1)) {
      const hashIdx = fileSpec.indexOf("#");
      const rawPath = hashIdx === -1 ? fileSpec : fileSpec.slice(0, hashIdx);
      const label = hashIdx === -1 ? "" : fileSpec.slice(hashIdx + 1);
      const resolved = resolvePath(context.cwd, rawPath);
      const data = await context.fs.readFile(resolved, { signal: context.signal });
      const fileName = resolved.split("/").pop() ?? rawPath;
      assets.push({
        id: backend.nextId(),
        name: fileName,
        label,
        size: data.length,
        contentType: "application/octet-stream",
        downloadCount: 0,
        createdAt: ts,
        updatedAt: ts,
        url: `${repo.url}/releases/download/${tagName}/${fileName}`,
        data,
      });
    }

    const rel: GhRelease = {
      id: backend.nextId(),
      tagName,
      name: getStringFlag(parsed, "title") ?? tagName,
      body,
      isDraft,
      isPrerelease,
      isLatest,
      targetCommitish: getStringFlag(parsed, "target") ?? repo.defaultBranchRef.name,
      author: { login: backend.getActiveUser() },
      createdAt: ts,
      publishedAt: ts,
      url: `${repo.url}/releases/tag/${tagName}`,
      assets,
    };
    repo.releases.set(tagName, rel);
    await writeOut(`${rel.url}\n`);
    return 0;
  }

  if (subcommand === "list" || subcommand === "ls") {
    const schemas: FlagSchema[] = [
      { short: "L", long: "limit", type: "string" },
      { long: "exclude-drafts", type: "boolean" },
      { long: "exclude-pre-releases", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    let list = Array.from(repo.releases.values());
    if (getBoolFlag(parsed, "exclude-drafts")) list = list.filter((r) => !r.isDraft);
    if (getBoolFlag(parsed, "exclude-pre-releases")) list = list.filter((r) => !r.isPrerelease);
    list = list.slice(0, getIntFlag(parsed, "limit", 30));

    const formatted = await formatCommandOutput({
      data: list.map(serializeRelease),
      availableFields: RELEASE_JSON_FIELDS,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }

    const lines = list.map((r) => {
      const type = r.isDraft ? "Draft" : r.isPrerelease ? "Pre-release" : r.isLatest ? "Latest" : "";
      return `${r.name}\t${type}\t${r.tagName}\t${r.publishedAt}`;
    });
    await writeOut(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    return 0;
  }

  if (subcommand === "view") {
    const parsed = parseCommandArgs(restArgs, []);
    const tag = parsed.positionals[0];
    const rel = tag
      ? repo.releases.get(tag)
      : (Array.from(repo.releases.values()).find((r) => r.isLatest) ??
        Array.from(repo.releases.values())[0]);
    if (!rel) {
      await writeErr(`release ${tag ?? "latest"} not found\n`);
      return 1;
    }
    if (getBoolFlag(parsed, "web")) {
      if (openBrowser) await openBrowser(rel.url);
      await writeOut(`Opening ${rel.url} in your browser.\n`);
      return 0;
    }
    const formatted = await formatCommandOutput({
      data: serializeRelease(rel),
      availableFields: RELEASE_JSON_FIELDS,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    await writeOut(
      [
        `${rel.tagName}`,
        `${rel.name}`,
        rel.body || "No release notes.",
        ...(rel.assets.length > 0
          ? ["", "Assets:", ...rel.assets.map((a) => `  ${a.name}\t${a.size} B`)]
          : []),
        "",
        `View on GitHub: ${rel.url}`,
        "",
      ].join("\n")
    );
    return 0;
  }

  if (subcommand === "upload") {
    const schemas: FlagSchema[] = [{ long: "clobber", type: "boolean" }];
    const parsed = parseCommandArgs(restArgs, schemas);
    const tag = parsed.positionals[0];
    if (!tag) {
      await writeErr("release tag required\n");
      return 1;
    }
    const rel = repo.releases.get(tag);
    if (!rel) {
      await writeErr(`release ${tag} not found\n`);
      return 1;
    }
    const clobber = getBoolFlag(parsed, "clobber");
    const ts = backend.isoNow();
    for (const fileSpec of parsed.positionals.slice(1)) {
      const hashIdx = fileSpec.indexOf("#");
      const rawPath = hashIdx === -1 ? fileSpec : fileSpec.slice(0, hashIdx);
      const label = hashIdx === -1 ? "" : fileSpec.slice(hashIdx + 1);
      const resolved = resolvePath(context.cwd, rawPath);
      const data = await context.fs.readFile(resolved, { signal: context.signal });
      const fileName = resolved.split("/").pop() ?? rawPath;
      const existingIdx = rel.assets.findIndex((a) => a.name === fileName);
      if (existingIdx !== -1 && !clobber) {
        await writeErr(`asset ${fileName} already exists (use --clobber to overwrite)\n`);
        return 1;
      }
      const asset: GhReleaseAsset = {
        id: backend.nextId(),
        name: fileName,
        label,
        size: data.length,
        contentType: "application/octet-stream",
        downloadCount: 0,
        createdAt: ts,
        updatedAt: ts,
        url: `${repo.url}/releases/download/${tag}/${fileName}`,
        data,
      };
      if (existingIdx !== -1) rel.assets[existingIdx] = asset;
      else rel.assets.push(asset);
    }
    await writeOut(`✓ Uploaded assets to ${tag}\n`);
    return 0;
  }

  if (subcommand === "download") {
    const schemas: FlagSchema[] = [
      { short: "p", long: "pattern", type: "string[]" },
      { short: "A", long: "archive", type: "string" },
      { short: "D", long: "dir", type: "string" },
      { short: "O", long: "output", type: "string" },
      { long: "clobber", type: "boolean" },
      { long: "skip-existing", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const tag = parsed.positionals[0];
    const rel = tag
      ? repo.releases.get(tag)
      : (Array.from(repo.releases.values()).find((r) => r.isLatest) ??
        Array.from(repo.releases.values())[0]);
    if (!rel) {
      await writeErr(`release ${tag ?? "latest"} not found\n`);
      return 1;
    }

    const outDir = resolvePath(context.cwd, getStringFlag(parsed, "dir") ?? ".");
    await context.fs.mkdir(outDir, { recursive: true, signal: context.signal });

    const clobber = getBoolFlag(parsed, "clobber");
    const skipExisting = getBoolFlag(parsed, "skip-existing");
    const download = async (dest: string, data: Uint8Array): Promise<boolean> => {
      try {
        await context.fs.writeFile(dest, data, {
          signal: context.signal,
          flag: clobber ? "w" : "wx",
        });
        return true;
      } catch (error) {
        if (!isFsError(error, "EEXIST")) throw error;
        if (skipExisting) return true;
        await writeErr(`${dest} already exists (use --clobber to overwrite or --skip-existing to skip)\n`);
        return false;
      }
    };

    const archiveFormat = getStringFlag(parsed, "archive");
    if (archiveFormat) {
      const fileName = `${repo.name}-${rel.tagName}.${archiveFormat}`;
      const dest = getStringFlag(parsed, "output")
        ? resolvePath(context.cwd, getStringFlag(parsed, "output")!)
        : `${outDir === "/" ? "" : outDir}/${fileName}`;
      return await download(dest, encodeUtf8(`ARCHIVE:${repo.nameWithOwner}:${rel.tagName}`)) ? 0 : 1;
    }

    const patterns = getStringArrayFlag(parsed, "pattern");
    const matching = rel.assets.filter(
      (a) => patterns.length === 0 || patterns.some((pat) => globMatches(pat, a.name))
    );
    for (const asset of matching) {
      const dest = getStringFlag(parsed, "output")
        ? resolvePath(context.cwd, getStringFlag(parsed, "output")!)
        : `${outDir === "/" ? "" : outDir}/${asset.name}`;
      if (!await download(dest, asset.data)) return 1;
    }
    return 0;
  }

  if (subcommand === "edit") {
    const schemas: FlagSchema[] = [
      { short: "t", long: "title", type: "string" },
      { short: "n", long: "notes", type: "string" },
      { short: "F", long: "notes-file", type: "string" },
      { long: "draft", type: "boolean" },
      { long: "prerelease", type: "boolean" },
      { long: "tag", type: "string" },
      { long: "target", type: "string" },
      { long: "latest", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const tag = parsed.positionals[0] ?? "";
    const rel = repo.releases.get(tag);
    if (!rel) {
      await writeErr(`release ${tag} not found\n`);
      return 1;
    }
    const title = getStringFlag(parsed, "title");
    if (title !== undefined) rel.name = title;
    const notesFile = getStringFlag(parsed, "notes-file");
    const notes = notesFile !== undefined
      ? notesFile === "-"
        ? await readStdinText()
        : decodeUtf8(await context.fs.readFile(resolvePath(context.cwd, notesFile), { signal: context.signal }))
      : getStringFlag(parsed, "notes");
    if (notes !== undefined) rel.body = notes;
    if (parsed.flags.has("draft")) rel.isDraft = getBoolFlag(parsed, "draft");
    if (parsed.flags.has("prerelease")) rel.isPrerelease = getBoolFlag(parsed, "prerelease");
    const target = getStringFlag(parsed, "target");
    if (target !== undefined) rel.targetCommitish = target;
    if (parsed.flags.has("latest")) {
      rel.isLatest = getBoolFlag(parsed, "latest");
      if (rel.isLatest) {
        for (const existing of repo.releases.values()) {
          if (existing !== rel) existing.isLatest = false;
        }
      }
    }
    const newTag = getStringFlag(parsed, "tag");
    if (newTag && newTag !== tag) {
      repo.releases.delete(tag);
      rel.tagName = newTag;
      rel.url = `${repo.url}/releases/tag/${newTag}`;
      rel.assets = rel.assets.map((asset) => ({
        ...asset,
        url: `${repo.url}/releases/download/${newTag}/${asset.name}`,
      }));
      repo.releases.set(newTag, rel);
    }
    await writeOut(`${rel.url}\n`);
    return 0;
  }

  if (subcommand === "delete") {
    const parsed = parseCommandArgs(restArgs, [{ long: "cleanup-tag", type: "boolean" }]);
    const tag = parsed.positionals[0] ?? "";
    repo.releases.delete(tag);
    await writeOut(`✓ Deleted release ${tag}\n`);
    return 0;
  }

  if (subcommand === "delete-asset") {
    const parsed = parseCommandArgs(restArgs, []);
    const tag = parsed.positionals[0] ?? "";
    const assetName = parsed.positionals[1] ?? "";
    const rel = repo.releases.get(tag);
    if (!rel) {
      await writeErr(`release ${tag} not found\n`);
      return 1;
    }
    rel.assets = rel.assets.filter((a) => a.name !== assetName);
    await writeOut(`✓ Deleted asset ${assetName} from release ${tag}\n`);
    return 0;
  }

  if (subcommand === "verify" || subcommand === "verify-asset") {
    const parsed = parseCommandArgs(restArgs, []);
    const targetTagOrFile = parsed.positionals[0] ?? "v1.0.0";
    let bytes = encodeUtf8(targetTagOrFile);
    if (subcommand === "verify-asset") {
      const assetFile = parsed.positionals[1] ?? parsed.positionals[0]!;
      bytes = await context.fs.readFile(resolvePath(context.cwd, assetFile), { signal: context.signal });
    }
    const verification = await openssl.verifyAttestationSignature(
      { repository: repo.nameWithOwner },
      bytes
    );
    await writeOut(
      `✓ Verification succeeded! Digest ${verification.subjectDigest} signed by ${verification.issuer} for ${verification.repository}\n`
    );
    return 0;
  }

  await writeErr(`unknown command "${subcommand}" for "gh release"\n`);
  return 1;
}

export async function handleRunCommand(
  env: ReleaseRunWorkflowEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, limits, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  const restArgs = rawArgs.slice(1);

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut(
      [
        "View details about workflow runs.",
        "",
        "USAGE",
        "  gh run <command> [flags]",
        "",
        "AVAILABLE COMMANDS",
        "  list (ls):   List recent workflow runs",
        "  view:        View a summary of a workflow run",
        "  watch:       Watch a run until it completes",
        "  rerun:       Rerun a run",
        "  cancel:      Cancel a workflow run",
        "  delete:      Delete a workflow run",
        "  download:    Download artifacts generated by a workflow run",
        "",
      ].join("\n")
    );
    return 0;
  }

  const coords = await resolveRepoFromContext(
    context,
    parseCommandArgs(restArgs, []).repoFlag,
    backend.defaultHost,
    backend.getActiveUser()
  );
  const repo = backend.getOrCreateRepo(coords.owner, coords.name);

  if (repo.workflowRuns.size === 0) {
    const defaultRunId = 101;
    const ts = backend.isoNow();
    repo.workflowRuns.set(defaultRunId, {
      databaseId: defaultRunId,
      name: "CI",
      displayTitle: "Initial commit",
      workflowName: "CI",
      workflowDatabaseId: Array.from(repo.workflows.keys())[0] ?? 1,
      headBranch: repo.defaultBranchRef.name,
      headSha: repo.branches.get(repo.defaultBranchRef.name) ?? bytesToHex(sha1Sync("init")),
      event: "push",
      status: "completed",
      conclusion: "success",
      attempt: 1,
      url: `${repo.url}/actions/runs/${defaultRunId}`,
      actor: { login: repo.owner.login },
      createdAt: ts,
      updatedAt: ts,
      jobs: [
        {
          id: 201,
          name: "test",
          status: "completed",
          conclusion: "success",
          startedAt: ts,
          completedAt: ts,
          steps: [{ name: "Run tests", status: "completed", conclusion: "success", number: 1, log: "All tests passed!" }],
          log: "test\tRun tests\t2026-09-28T12:00:00Z All tests passed!\n",
        },
      ],
      artifacts: [
        {
          id: 301,
          name: "build-output",
          files: {
            "report.txt": encodeUtf8("Build report OK\n"),
          },
        },
      ],
    });
  }

  if (subcommand === "list" || subcommand === "ls") {
    const schemas: FlagSchema[] = [
      { short: "b", long: "branch", type: "string" },
      { short: "w", long: "workflow", type: "string" },
      { short: "s", long: "status", type: "string" },
      { short: "u", long: "user", type: "string" },
      { short: "e", long: "event", type: "string" },
      { short: "L", long: "limit", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    let runs = Array.from(repo.workflowRuns.values());
    const branchFilter = getStringFlag(parsed, "branch");
    const wfFilter = getStringFlag(parsed, "workflow")?.toLowerCase();
    const statusFilter = getStringFlag(parsed, "status")?.toLowerCase();
    const userFilter = getStringFlag(parsed, "user")?.toLowerCase();
    const eventFilter = getStringFlag(parsed, "event")?.toLowerCase();

    runs = runs.filter((r) => {
      if (branchFilter && r.headBranch !== branchFilter) return false;
      if (wfFilter && r.workflowName.toLowerCase() !== wfFilter) return false;
      if (statusFilter && r.status !== statusFilter && r.conclusion !== statusFilter) return false;
      if (userFilter && r.actor.login.toLowerCase() !== userFilter) return false;
      if (eventFilter && r.event.toLowerCase() !== eventFilter) return false;
      return true;
    });
    runs = runs.slice(0, getIntFlag(parsed, "limit", 20));

    const formatted = await formatCommandOutput({
      data: runs.map((r) => ({ ...r, number: r.databaseId, startedAt: r.createdAt })),
      availableFields: RUN_JSON_FIELDS,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }

    const lines = runs.map(
      (r) =>
        `${r.status}\t${r.conclusion ?? ""}\t${r.displayTitle}\t${r.workflowName}\t${r.headBranch}\t${r.event}\t${r.databaseId}`
    );
    await writeOut(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    return 0;
  }

  if (subcommand === "view") {
    const schemas: FlagSchema[] = [
      { long: "log", type: "boolean" },
      { long: "log-failed", type: "boolean" },
      { short: "j", long: "job", type: "string" },
      { short: "v", long: "verbose", type: "boolean" },
      { long: "exit-status", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const runId = parsed.positionals[0] ? Number(parsed.positionals[0]) : Array.from(repo.workflowRuns.keys())[0]!;
    const run = repo.workflowRuns.get(runId);
    if (!run) {
      await writeErr(`run ${runId} not found\n`);
      return 1;
    }

    const formatted = await formatCommandOutput({
      data: { ...run, number: run.databaseId, startedAt: run.createdAt },
      availableFields: RUN_JSON_FIELDS,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return getBoolFlag(parsed, "exit-status") && run.conclusion === "failure" ? 1 : 0;
    }

    if (getBoolFlag(parsed, "log") || getBoolFlag(parsed, "log-failed")) {
      const logs = run.jobs
        .filter((j) => !getBoolFlag(parsed, "log-failed") || j.conclusion === "failure")
        .map((j) => j.log)
        .join("");
      await writeOut(logs);
      return getBoolFlag(parsed, "exit-status") && run.conclusion === "failure" ? 1 : 0;
    }

    await writeOut(
      [
        `${run.headBranch} ${run.workflowName} · ${run.databaseId}`,
        `Triggered via ${run.event} by ${run.actor.login}`,
        "",
        "JOBS",
        ...run.jobs.map((j) => `✓ ${j.name} in 1s (ID ${j.id})`),
        "",
        `View this run on GitHub: ${run.url}`,
        "",
      ].join("\n")
    );
    return getBoolFlag(parsed, "exit-status") && run.conclusion === "failure" ? 1 : 0;
  }

  if (subcommand === "watch") {
    const parsed = parseCommandArgs(restArgs, [{ long: "exit-status", type: "boolean" }]);
    const runId = parsed.positionals[0] ? Number(parsed.positionals[0]) : Array.from(repo.workflowRuns.keys())[0]!;
    const run = repo.workflowRuns.get(runId);
    if (!run) {
      await writeErr(`run ${runId} not found\n`);
      return 1;
    }
    run.status = "completed";
    if (!run.conclusion) run.conclusion = "success";
    await writeOut(`✓ Run ${run.workflowName} (${run.databaseId}) completed with '${run.conclusion}'\n`);
    return getBoolFlag(parsed, "exit-status") && run.conclusion === "failure" ? 1 : 0;
  }

  if (subcommand === "rerun") {
    const parsed = parseCommandArgs(restArgs, [{ long: "failed", type: "boolean" }]);
    const runId = parsed.positionals[0] ? Number(parsed.positionals[0]) : Array.from(repo.workflowRuns.keys())[0]!;
    const run = repo.workflowRuns.get(runId);
    if (!run) {
      await writeErr(`run ${runId} not found\n`);
      return 1;
    }
    run.attempt += 1;
    run.status = "completed";
    run.conclusion = "success";
    await writeOut(`✓ Requested rerun of run ${runId}\n`);
    return 0;
  }

  if (subcommand === "cancel") {
    const parsed = parseCommandArgs(restArgs, []);
    const runId = parsed.positionals[0] ? Number(parsed.positionals[0]) : Array.from(repo.workflowRuns.keys())[0]!;
    const run = repo.workflowRuns.get(runId);
    if (run) {
      run.status = "completed";
      run.conclusion = "cancelled";
    }
    await writeOut(`✓ Requested cancellation of workflow run ${runId}\n`);
    return 0;
  }

  if (subcommand === "delete") {
    const parsed = parseCommandArgs(restArgs, []);
    const runId = Number(parsed.positionals[0]);
    repo.workflowRuns.delete(runId);
    await writeOut(`✓ Deleted workflow run ${runId}\n`);
    return 0;
  }

  if (subcommand === "download") {
    const schemas: FlagSchema[] = [
      { short: "n", long: "name", type: "string[]" },
      { short: "p", long: "pattern", type: "string[]" },
      { short: "D", long: "dir", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const runId = parsed.positionals[0] ? Number(parsed.positionals[0]) : Array.from(repo.workflowRuns.keys())[0]!;
    const run = repo.workflowRuns.get(runId);
    if (!run) {
      await writeErr(`run ${runId} not found\n`);
      return 1;
    }
    const outDir = resolvePath(context.cwd, getStringFlag(parsed, "dir") ?? ".");
    await context.fs.mkdir(outDir, { recursive: true, signal: context.signal });
    const nameFilters = getStringArrayFlag(parsed, "name");
    for (const art of run.artifacts) {
      if (nameFilters.length > 0 && !nameFilters.includes(art.name)) continue;
      for (const [relPath, bytes] of Object.entries(art.files)) {
        const dest = `${outDir === "/" ? "" : outDir}/${relPath}`;
        await context.fs.writeFile(dest, bytes, { signal: context.signal });
      }
    }
    return 0;
  }

  await writeErr(`unknown command "${subcommand}" for "gh run"\n`);
  return 1;
}

export async function handleWorkflowCommand(
  env: ReleaseRunWorkflowEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  const restArgs = rawArgs.slice(1);

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut(
      [
        "List, view, and run workflows in GitHub Actions.",
        "",
        "USAGE",
        "  gh workflow <command> [flags]",
        "",
        "AVAILABLE COMMANDS",
        "  list (ls):   List workflows",
        "  view:        View the summary of a workflow",
        "  run:         Run a workflow by creating a workflow_dispatch event",
        "  enable:      Enable a workflow",
        "  disable:     Disable a workflow",
        "",
      ].join("\n")
    );
    return 0;
  }

  const coords = await resolveRepoFromContext(
    context,
    parseCommandArgs(restArgs, []).repoFlag,
    backend.defaultHost,
    backend.getActiveUser()
  );
  const repo = backend.getOrCreateRepo(coords.owner, coords.name);

  const findWorkflow = (selector?: string): GhWorkflow | undefined => {
    const all = Array.from(repo.workflows.values());
    if (!selector) return all[0];
    return all.find(
      (w) =>
        String(w.id) === selector ||
        w.name.toLowerCase() === selector.toLowerCase() ||
        w.path.endsWith(selector)
    );
  };

  if (subcommand === "list" || subcommand === "ls") {
    const parsed = parseCommandArgs(restArgs, [{ short: "a", long: "all", type: "boolean" }]);
    const workflows = Array.from(repo.workflows.values()).filter(
      (w) => getBoolFlag(parsed, "all") || w.state === "active"
    );
    const formatted = await formatCommandOutput({
      data: workflows,
      availableFields: WORKFLOW_JSON_FIELDS,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    const lines = workflows.map((w) => `${w.name}\t${w.state}\t${w.id}`);
    await writeOut(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    return 0;
  }

  if (subcommand === "view") {
    const parsed = parseCommandArgs(restArgs, [{ short: "y", long: "yaml", type: "boolean" }]);
    const wf = findWorkflow(parsed.positionals[0]);
    if (!wf) {
      await writeErr("workflow not found\n");
      return 1;
    }
    if (getBoolFlag(parsed, "yaml")) {
      await writeOut(wf.content);
      return 0;
    }
    await writeOut(`${wf.name} - ${wf.path}\nID: ${wf.id}\nState: ${wf.state}\n`);
    return 0;
  }

  if (subcommand === "run") {
    const schemas: FlagSchema[] = [
      { short: "r", long: "ref", type: "string" },
      { short: "f", long: "raw-field", type: "string[]" },
      { short: "F", long: "field", type: "string[]" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const wf = findWorkflow(parsed.positionals[0]);
    if (!wf) {
      await writeErr("workflow not found\n");
      return 1;
    }
    const branch = getStringFlag(parsed, "ref") ?? repo.defaultBranchRef.name;
    const runId = backend.nextId();
    const ts = backend.isoNow();
    const newRun: GhWorkflowRun = {
      databaseId: runId,
      name: wf.name,
      displayTitle: `Manual run of ${wf.name}`,
      workflowName: wf.name,
      workflowDatabaseId: wf.id,
      headBranch: branch,
      headSha: repo.branches.get(branch) ?? bytesToHex(sha1Sync(`wf:${runId}`)),
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      attempt: 1,
      url: `${repo.url}/actions/runs/${runId}`,
      actor: { login: backend.getActiveUser() },
      createdAt: ts,
      updatedAt: ts,
      jobs: [
        {
          id: backend.nextId(),
          name: "build",
          status: "completed",
          conclusion: "success",
          startedAt: ts,
          completedAt: ts,
          steps: [],
          log: `${wf.name}\tbuild\t${ts} Completed workflow_dispatch\n`,
        },
      ],
      artifacts: [],
    };
    repo.workflowRuns.set(runId, newRun);
    await writeOut(`✓ Created workflow_dispatch event for ${wf.path} at ${branch}\n`);
    return 0;
  }

  if (subcommand === "enable" || subcommand === "disable") {
    const parsed = parseCommandArgs(restArgs, []);
    const wf = findWorkflow(parsed.positionals[0]);
    if (!wf) {
      await writeErr("workflow not found\n");
      return 1;
    }
    wf.state = subcommand === "enable" ? "active" : "disabled_manually";
    await writeOut(`✓ ${subcommand === "enable" ? "Enabled" : "Disabled"} ${wf.name}\n`);
    return 0;
  }

  await writeErr(`unknown command "${subcommand}" for "gh workflow"\n`);
  return 1;
}
