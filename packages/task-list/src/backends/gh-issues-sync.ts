import { PROJECT_ORGANIZATION_QUERY, PROJECT_USER_QUERY } from "./gh-issues.js";
import { createGhClient, type GhClient } from "./gh-issues-client.js";

export interface VerifyGhProjectOptions {
  owner: string;
  number: number;
  requiredStates: readonly string[];
  client?: GhClient;
  fetch?: typeof fetch;
  auth?: { token: string };
}

export interface VerifyGhProjectReport {
  ok: boolean;
  project: { id: string; number: number; owner: string } | null;
  statusField: { id: string; options: readonly string[] } | null;
  missingProject: boolean;
  missingStatusField: boolean;
  missingOptions: readonly string[];
}

export interface SyncGhProjectOptions extends VerifyGhProjectOptions {
  title?: string;
  yes?: boolean;
}

export interface SyncGhProjectReport extends VerifyGhProjectReport {
  created: readonly string[];
  updated: readonly string[];
}

export class GhProjectSyncError extends Error {
  readonly op: "lookup" | "createProject" | "createField" | "createOption";
  readonly target: string;

  constructor(options: {
    op: "lookup" | "createProject" | "createField" | "createOption";
    target: string;
    cause?: unknown;
    message: string;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "GhProjectSyncError";
    this.op = options.op;
    this.target = options.target;
  }
}

export async function verifyGhProject(
  opts: VerifyGhProjectOptions
): Promise<VerifyGhProjectReport> {
  const client = resolveGhClient(opts);
  const target = `project:${opts.owner}/${opts.number}`;
  const variables = {
    owner: opts.owner,
    number: opts.number
  };

  let project: ProjectV2 | null;
  try {
    const organizationResult = await client.graphql<ProjectResponse>(
      PROJECT_ORGANIZATION_QUERY,
      variables
    );
    project = organizationResult.organization?.projectV2 ?? null;

    if (project === null) {
      const userResult = await client.graphql<ProjectResponse>(PROJECT_USER_QUERY, variables);
      project = userResult.user?.projectV2 ?? null;
    }
  } catch (error) {
    throw new GhProjectSyncError({
      op: "lookup",
      target,
      cause: error,
      message: "lookup_failed"
    });
  }

  if (project === null) {
    return {
      ok: false,
      project: null,
      statusField: null,
      missingProject: true,
      missingStatusField: true,
      missingOptions: opts.requiredStates
    };
  }

  const statusField = selectStatusField(project);
  if (statusField === null) {
    return {
      ok: false,
      project: {
        id: project.id,
        number: opts.number,
        owner: opts.owner
      },
      statusField: null,
      missingProject: false,
      missingStatusField: true,
      missingOptions: opts.requiredStates
    };
  }

  const options = statusField.options.map((option) => option.name);
  const missingOptions = opts.requiredStates.filter((state) => !options.includes(state));

  return {
    ok: missingOptions.length === 0,
    project: {
      id: project.id,
      number: opts.number,
      owner: opts.owner
    },
    statusField: {
      id: statusField.id,
      options
    },
    missingProject: false,
    missingStatusField: false,
    missingOptions
  };
}

export async function syncGhProject(opts: SyncGhProjectOptions): Promise<SyncGhProjectReport> {
  void opts;
  throw new GhProjectSyncError({
    op: "lookup",
    target: "syncGhProject",
    message: "not_implemented"
  });
}

interface ProjectResponse {
  organization?: ProjectOwner | null;
  user?: ProjectOwner | null;
}

interface ProjectOwner {
  projectV2?: ProjectV2 | null;
}

interface ProjectV2 {
  id: string;
  field?: unknown;
  fields?: {
    nodes?: unknown[] | null;
  } | null;
}

interface StatusField {
  id: string;
  name?: string;
  options: StatusOption[];
}

interface StatusOption {
  id: string;
  name: string;
}

function resolveGhClient(opts: VerifyGhProjectOptions): GhClient {
  if (opts.client !== undefined) {
    return opts.client;
  }

  const token = opts.auth?.token;
  if (token === undefined || token.length === 0) {
    throw new GhProjectSyncError({
      op: "lookup",
      target: "auth",
      message: "missing_auth"
    });
  }

  return createGhClient({
    token,
    fetch: opts.fetch
  });
}

function selectStatusField(project: ProjectV2): StatusField | null {
  const fields = project.fields?.nodes?.filter(isStatusField) ?? [];
  const exactStatusField = fields.find((field) => field.name === "Status");
  if (exactStatusField !== undefined) {
    return exactStatusField;
  }

  if (isStatusField(project.field) && isExactStatusField(project.field)) {
    return project.field;
  }

  return null;
}

function isExactStatusField(field: StatusField): boolean {
  return field.name === undefined || field.name === "Status";
}

function isStatusOption(value: unknown): value is StatusOption {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string"
  );
}

function isStatusField(value: unknown): value is StatusField {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    (!("name" in value) || typeof value.name === "string") &&
    "options" in value &&
    Array.isArray(value.options) &&
    value.options.every(isStatusOption)
  );
}
