import { PROJECT_ORGANIZATION_QUERY, PROJECT_USER_QUERY } from "./gh-issues.js";
import { createGhClient, type GhClient } from "./gh-issues-client.js";

const OWNER_ORGANIZATION_QUERY = `query ProjectOwner($owner: String!) {
  organization(login: $owner) {
    id
  }
}`;

const OWNER_USER_QUERY = `query ProjectOwner($owner: String!) {
  user(login: $owner) {
    id
  }
}`;

const CREATE_PROJECT_MUTATION = `mutation CreateProject($input: CreateProjectV2Input!) {
  createProjectV2(input: $input) {
    projectV2 {
      id
      number
    }
  }
}`;

const CREATE_STATUS_FIELD_MUTATION = `mutation CreateStatusField($input: CreateProjectV2FieldInput!) {
  createProjectV2Field(input: $input) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
        options { id name }
      }
    }
  }
}`;

const UPDATE_STATUS_FIELD_OPTIONS_MUTATION = `mutation UpdateStatusFieldOptions($input: UpdateProjectV2FieldInput!) {
  updateProjectV2Field(input: $input) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
        options { id name color description }
      }
    }
  }
}`;

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
  validateRequiredStates(opts.requiredStates);
  const client = resolveGhClient(opts);
  const lookup = await lookupProject(client, opts.owner, opts.number);
  return buildVerifyReport(lookup, opts);
}

interface ProjectLookup {
  project: ProjectV2 | null;
  statusField: StatusField | null;
}

async function lookupProject(
  client: GhClient,
  owner: string,
  number: number
): Promise<ProjectLookup> {
  const target = `project:${owner}/${number}`;
  const variables = { owner, number };

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

  return {
    project,
    statusField: project === null ? null : selectStatusField(project)
  };
}

function buildVerifyReport(
  lookup: ProjectLookup,
  opts: VerifyGhProjectOptions
): VerifyGhProjectReport {
  if (lookup.project === null) {
    return {
      ok: false,
      project: null,
      statusField: null,
      missingProject: true,
      missingStatusField: true,
      missingOptions: opts.requiredStates
    };
  }

  if (lookup.statusField === null) {
    return {
      ok: false,
      project: {
        id: lookup.project.id,
        number: opts.number,
        owner: opts.owner
      },
      statusField: null,
      missingProject: false,
      missingStatusField: true,
      missingOptions: opts.requiredStates
    };
  }

  const options = lookup.statusField.options.map((option) => option.name);
  const missingOptions = opts.requiredStates.filter((state) => !options.includes(state));

  return {
    ok: missingOptions.length === 0,
    project: {
      id: lookup.project.id,
      number: opts.number,
      owner: opts.owner
    },
    statusField: {
      id: lookup.statusField.id,
      options
    },
    missingProject: false,
    missingStatusField: false,
    missingOptions
  };
}

export async function syncGhProject(opts: SyncGhProjectOptions): Promise<SyncGhProjectReport> {
  validateRequiredStates(opts.requiredStates);
  const client = resolveGhClient(opts);
  let lookup = await lookupProject(client, opts.owner, opts.number);
  const initialReport = buildVerifyReport(lookup, opts);
  if (initialReport.ok || opts.yes !== true) {
    return {
      ...initialReport,
      created: [],
      updated: []
    };
  }

  let resolvedNumber = opts.number;
  const created: string[] = [];

  if (lookup.project === null) {
    const newProject = await createProject(client, opts);
    created.push("project");
    resolvedNumber = newProject.number;
    // Re-look up against the new project number so we can pick up any
    // auto-created Status field (GitHub adds one by default).
    lookup = await lookupProject(client, opts.owner, resolvedNumber);
  }

  if (lookup.project === null) {
    throw new GhProjectSyncError({
      op: "createProject",
      target: `${opts.owner}/${opts.number}`,
      message: "project was not found after creation"
    });
  }

  let statusField = lookup.statusField;
  if (statusField === null) {
    statusField = await createStatusField(client, lookup.project.id);
    created.push("field");
  }

  const existingNames = new Set(statusField.options.map((option) => option.name));
  const missingOptionNames = opts.requiredStates.filter((state) => !existingNames.has(state));

  if (missingOptionNames.length > 0) {
    statusField = await addStatusOptions(client, statusField, missingOptionNames);
    for (const name of missingOptionNames) {
      created.push(`option:${name}`);
    }
  }

  const optionNames = statusField.options.map((option) => option.name);
  const missingOptions = opts.requiredStates.filter((state) => !optionNames.includes(state));

  return {
    ok: missingOptions.length === 0,
    project: {
      id: lookup.project.id,
      number: resolvedNumber,
      owner: opts.owner
    },
    statusField: {
      id: statusField.id,
      options: optionNames
    },
    missingProject: false,
    missingStatusField: false,
    missingOptions,
    created,
    updated: []
  };
}

function validateRequiredStates(requiredStates: readonly string[]): void {
  if (requiredStates.some((state) => state.trim().length === 0)) {
    throw new Error("requiredStates must not contain empty state names.");
  }
}

interface OwnerResponse {
  organization?: { id: string } | null;
  user?: { id: string } | null;
}

interface CreateProjectResponse {
  createProjectV2?: {
    projectV2?: {
      id: string;
      number: number;
    } | null;
  } | null;
}

interface CreateStatusFieldResponse {
  createProjectV2Field?: {
    projectV2Field?: unknown;
  } | null;
}

interface UpdateStatusFieldResponse {
  updateProjectV2Field?: {
    projectV2Field?: unknown;
  } | null;
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

async function createProject(
  client: GhClient,
  opts: SyncGhProjectOptions
): Promise<{ id: string; number: number; owner: string }> {
  const target = `${opts.owner}/${opts.number}`;

  try {
    const ownerId = await lookupOwnerId(client, opts.owner);
    const result = await client.graphql<CreateProjectResponse>(CREATE_PROJECT_MUTATION, {
      input: {
        ownerId,
        title: opts.title ?? `${opts.owner}/${opts.number}`
      }
    });
    const project = result.createProjectV2?.projectV2;
    if (project === undefined || project === null) {
      throw new Error("createProjectV2 returned no project");
    }

    return {
      id: project.id,
      number: project.number,
      owner: opts.owner
    };
  } catch (error) {
    throw new GhProjectSyncError({
      op: "createProject",
      target,
      cause: error,
      message: errorMessage(error)
    });
  }
}

async function lookupOwnerId(client: GhClient, owner: string): Promise<string> {
  const organizationResult = await client.graphql<OwnerResponse>(OWNER_ORGANIZATION_QUERY, {
    owner
  });
  const organizationId = organizationResult.organization?.id;
  if (organizationId !== undefined) {
    return organizationId;
  }

  const userResult = await client.graphql<OwnerResponse>(OWNER_USER_QUERY, {
    owner
  });
  const userId = userResult.user?.id;
  if (userId !== undefined) {
    return userId;
  }

  throw new Error(`GitHub owner not found: ${owner}`);
}

async function createStatusField(client: GhClient, projectId: string): Promise<StatusField> {
  try {
    const result = await client.graphql<CreateStatusFieldResponse>(CREATE_STATUS_FIELD_MUTATION, {
      input: {
        projectId,
        dataType: "SINGLE_SELECT",
        name: "Status",
        singleSelectOptions: []
      }
    });
    const field = result.createProjectV2Field?.projectV2Field;
    if (!isStatusField(field)) {
      throw new Error("createProjectV2Field returned no Status field");
    }

    return field;
  } catch (error) {
    throw new GhProjectSyncError({
      op: "createField",
      target: "Status",
      cause: error,
      message: errorMessage(error)
    });
  }
}

async function addStatusOptions(
  client: GhClient,
  field: StatusField,
  missingNames: readonly string[]
): Promise<StatusField> {
  const singleSelectOptions = [
    ...field.options.map((option) => ({
      id: option.id,
      name: option.name,
      color: option.color ?? "GRAY",
      description: option.description ?? ""
    })),
    ...missingNames.map((name) => ({
      name,
      color: "GRAY",
      description: ""
    }))
  ];

  try {
    const result = await client.graphql<UpdateStatusFieldResponse>(
      UPDATE_STATUS_FIELD_OPTIONS_MUTATION,
      {
        input: {
          fieldId: field.id,
          singleSelectOptions
        }
      }
    );
    const updated = result.updateProjectV2Field?.projectV2Field;
    if (!isStatusField(updated)) {
      throw new Error("updateProjectV2Field returned no Status field");
    }

    return updated;
  } catch (error) {
    throw new GhProjectSyncError({
      op: "createOption",
      target: missingNames.join(","),
      cause: error,
      message: errorMessage(error)
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface StatusField {
  id: string;
  name?: string;
  options: StatusOption[];
}

interface StatusOption {
  id: string;
  name: string;
  color?: string;
  description?: string;
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
    hasOwnProperty(value, "id") &&
    typeof value.id === "string" &&
    hasOwnProperty(value, "name") &&
    typeof value.name === "string" &&
    (!hasOwnProperty(value, "color") || typeof value.color === "string") &&
    (!hasOwnProperty(value, "description") || typeof value.description === "string")
  );
}

function isStatusField(value: unknown): value is StatusField {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwnProperty(value, "id") &&
    typeof value.id === "string" &&
    (!hasOwnProperty(value, "name") || typeof value.name === "string") &&
    hasOwnProperty(value, "options") &&
    Array.isArray(value.options) &&
    value.options.every(isStatusOption)
  );
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}
