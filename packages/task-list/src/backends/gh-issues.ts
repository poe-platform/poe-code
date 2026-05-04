import { eventsFromState, findEvent, type StateMachineDef } from "../state-machine.js";
import type {
  ListFilter,
  MoveAnchor,
  Task,
  TaskCreate,
  TaskDefaults,
  TaskFireOptions,
  TaskList,
  Tasks,
  TaskUpdate
} from "../types.js";
import { createGhClient } from "./gh-issues-client.js";

const PROJECT_ORGANIZATION_QUERY = `query Project($owner: String!, $number: Int!) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      title
      field(name: "Status") {
        ... on ProjectV2SingleSelectField {
          id
          options { id name }
        }
      }
    }
  }
}`;

const PROJECT_USER_QUERY = `query Project($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      title
      field(name: "Status") {
        ... on ProjectV2SingleSelectField {
          id
          options { id name }
        }
      }
    }
  }
}`;

const NOT_IMPLEMENTED = "not yet implemented";

export interface GhIssuesBackendDeps {
  repo: string;
  project: { owner: string; number: number };
  defaults: Required<TaskDefaults>;
  token: string;
  endpoint: string;
  fetch?: typeof fetch;
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
  title: string;
  field?: unknown;
}

interface StatusField {
  id: string;
  options: StatusOption[];
}

interface StatusOption {
  id: string;
  name: string;
}

interface GhIssuesSession {
  projectId: string;
  statusFieldId: string;
  statusOptions: ReadonlyMap<string, string>;
  stateMachine: StateMachineDef;
}

export async function ghIssuesBackend(deps: GhIssuesBackendDeps): Promise<TaskList> {
  const client = createGhClient({
    token: deps.token,
    endpoint: deps.endpoint,
    fetch: deps.fetch
  });
  const listName = `${deps.project.owner}/${deps.project.number}`;
  const variables = {
    owner: deps.project.owner,
    number: deps.project.number
  };

  const organizationResult = await client.graphql<ProjectResponse>(
    PROJECT_ORGANIZATION_QUERY,
    variables
  );
  let project = organizationResult.organization?.projectV2 ?? null;

  if (project === null) {
    const userResult = await client.graphql<ProjectResponse>(PROJECT_USER_QUERY, variables);
    project = userResult.user?.projectV2 ?? null;
  }

  if (project === null) {
    throw new Error(`Project ${listName} not found or inaccessible.`);
  }

  const field = project.field;
  if (!isStatusField(field)) {
    throw new Error(`Project ${listName} has no Status field; gh-issues requires one.`);
  }

  if (field.options.length === 0) {
    throw new Error(`Project ${listName} Status field has no options.`);
  }

  const session = createSession(project, field);

  function list(name: string): Tasks {
    assertSingleList(name, listName);
    return createTasksView(listName, session);
  }

  return {
    list,
    async lists(): Promise<string[]> {
      return [listName];
    },
    async allTasks(filter?: ListFilter): Promise<Task[]> {
      return list(listName).all(filter);
    },
    async get(qualifiedId: string): Promise<Task> {
      const id = parseQualifiedId(qualifiedId, listName);
      return list(listName).get(id);
    },
    async moveBetweenLists(_qualifiedId: string, _targetList: string): Promise<Task> {
      throw singleListError(listName);
    }
  };
}

function createSession(project: ProjectV2, field: StatusField): GhIssuesSession {
  const statusOptions = new Map(field.options.map((option) => [option.name, option.id]));
  const states = field.options.map((option) => option.name);
  const events = Object.fromEntries(
    states.map((state) => [state, Object.freeze({ from: "*" as const, to: state })])
  );
  const stateMachine = Object.freeze({
    states: Object.freeze([...states]),
    initial: states[0],
    events: Object.freeze(events)
  }) satisfies StateMachineDef;

  return Object.freeze({
    projectId: project.id,
    statusFieldId: field.id,
    statusOptions,
    stateMachine
  });
}

function createTasksView(name: string, session: GhIssuesSession): Tasks {
  return {
    name,
    stateMachine: session.stateMachine,
    async all(_filter?: ListFilter): Promise<Task[]> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async get(_id: string): Promise<Task> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async create(_input: TaskCreate): Promise<Task> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async update(_id: string, _patch: TaskUpdate): Promise<Task> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async fire(_id: string, _event: string, _opts?: TaskFireOptions): Promise<Task> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async canFire(id: string, event: string): Promise<boolean> {
      return findEvent(session.stateMachine, id, event) !== undefined;
    },
    async events(id: string): Promise<readonly string[]> {
      return eventsFromState(session.stateMachine, id);
    },
    async delete(_id: string): Promise<void> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async move(_id: string, _anchor: MoveAnchor): Promise<Task> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async reorder(_ids: readonly string[]): Promise<readonly Task[]> {
      throw new Error(NOT_IMPLEMENTED);
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatusOption(value: unknown): value is StatusOption {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string"
  );
}

function isStatusField(value: unknown): value is StatusField {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.options) &&
    value.options.every(isStatusOption)
  );
}

function assertSingleList(name: string, listName: string): void {
  if (name !== listName) {
    throw singleListError(listName);
  }
}

function singleListError(listName: string): Error {
  return new Error(`gh-issues backend has a single list ${listName}`);
}

function parseQualifiedId(qualifiedId: string, listName: string): string {
  const prefix = `${listName}/`;

  if (!qualifiedId.startsWith(prefix) || qualifiedId.length === prefix.length) {
    throw new Error(`Invalid qualified task id "${qualifiedId}".`);
  }

  return qualifiedId.slice(prefix.length);
}
