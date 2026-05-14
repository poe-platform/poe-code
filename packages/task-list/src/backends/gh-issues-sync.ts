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

const CREATE_STATUS_OPTION_MUTATION = `mutation CreateStatusOption($input: CreateProjectV2SingleSelectFieldOptionInput!) {
  createProjectV2SingleSelectFieldOption(input: $input) {
    singleSelectFieldOption {
      id
      name
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
  const client = resolveGhClient(opts);
  const verified = await verifyGhProject({ ...opts, client });
  const created: string[] = [];

  if (verified.ok) {
    return {
      ...verified,
      created,
      updated: []
    };
  }

  let project = verified.project;
  let statusField = verified.statusField;
  let missingOptions = [...verified.missingOptions];

  if (project === null) {
    project = await createProject(client, opts);
    created.push("project");
    statusField = null;
    missingOptions = [...opts.requiredStates];
  }

  if (statusField === null) {
    const createdStatusField = await createStatusField(client, project.id, opts.requiredStates);
    statusField = createdStatusField;
    created.push("field");
    missingOptions = opts.requiredStates.filter(
      (state) => !createdStatusField.options.includes(state)
    );
  } else if (missingOptions.length > 0) {
    for (const optionName of missingOptions) {
      await createStatusOption(client, statusField.id, optionName);
      created.push(`option:${optionName}`);
    }

    statusField = {
      id: statusField.id,
      options: [...statusField.options, ...missingOptions]
    };
    missingOptions = [];
  }

  return {
    ok: statusField !== null && missingOptions.length === 0,
    project,
    statusField,
    missingProject: false,
    missingStatusField: statusField === null,
    missingOptions,
    created,
    updated: []
  };
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

interface CreateStatusOptionResponse {
  createProjectV2SingleSelectFieldOption?: {
    singleSelectFieldOption?: {
      id: string;
      name: string;
    } | null;
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

async function createStatusField(
  client: GhClient,
  projectId: string,
  requiredStates: readonly string[]
): Promise<{ id: string; options: string[] }> {
  try {
    const result = await client.graphql<CreateStatusFieldResponse>(CREATE_STATUS_FIELD_MUTATION, {
      input: {
        projectId,
        dataType: "SINGLE_SELECT",
        name: "Status",
        singleSelectOptions: requiredStates.map((name) => ({ name, color: "GRAY" }))
      }
    });
    const field = result.createProjectV2Field?.projectV2Field;
    if (!isStatusField(field)) {
      throw new Error("createProjectV2Field returned no Status field");
    }

    return {
      id: field.id,
      options: field.options.map((option) => option.name)
    };
  } catch (error) {
    throw new GhProjectSyncError({
      op: "createField",
      target: "Status",
      cause: error,
      message: errorMessage(error)
    });
  }
}

async function createStatusOption(
  client: GhClient,
  fieldId: string,
  name: string
): Promise<void> {
  try {
    await client.graphql<CreateStatusOptionResponse>(CREATE_STATUS_OPTION_MUTATION, {
      input: {
        fieldId,
        name,
        color: "GRAY"
      }
    });
  } catch (error) {
    throw new GhProjectSyncError({
      op: "createOption",
      target: name,
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
