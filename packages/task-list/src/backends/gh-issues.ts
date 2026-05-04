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
import { TaskNotFoundError } from "../types.js";
import { createGhClient, type GhClient } from "./gh-issues-client.js";
import { applyOrder, sortTasks } from "./utils.js";

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

const PROJECT_ITEMS_QUERY = `query Items($projectId: ID!, $after: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        nodes {
          id
          content {
            __typename
            ... on Issue {
              number
              title
              body
              url
              createdAt
              labels(first: 50) { nodes { name } }
              assignees(first: 20) { nodes { login } }
              milestone { title }
            }
          }
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const ISSUE_QUERY = `query Issue($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      number
      title
      body
      url
      createdAt
      labels(first: 50) { nodes { name } }
      assignees(first: 20) { nodes { login } }
      milestone { title }
      projectItems(first: 10) {
        nodes {
          id
          project { id }
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue {
              name
            }
          }
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

interface GhIssuesTasksContext {
  client: GhClient;
  repoOwner: string;
  repoName: string;
}

interface ProjectItemsResponse {
  node?: {
    items?: ProjectItemsConnection | null;
  } | null;
}

interface ProjectItemsConnection {
  nodes?: ProjectItemNode[];
  pageInfo?: {
    hasNextPage?: boolean;
    endCursor?: string | null;
  };
}

interface ProjectItemNode {
  id: string;
  content?: IssueNode | { __typename?: string } | null;
  fieldValueByName?: StatusValue | null;
}

interface IssueResponse {
  repository?: {
    issue?: IssueNodeWithProjectItems | null;
  } | null;
}

interface IssueNode {
  __typename?: "Issue";
  number: number;
  title: string;
  body?: string | null;
  url: string;
  createdAt: string;
  labels?: {
    nodes?: Array<{ name: string } | null>;
  } | null;
  assignees?: {
    nodes?: Array<{ login: string } | null>;
  } | null;
  milestone?: {
    title: string;
  } | null;
}

interface IssueNodeWithProjectItems extends IssueNode {
  projectItems?: {
    nodes?: ProjectItemMembership[];
  } | null;
}

interface ProjectItemMembership {
  id: string;
  project?: {
    id?: string;
  } | null;
  fieldValueByName?: StatusValue | null;
}

interface StatusValue {
  name?: string | null;
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
  const repoParts = parseRepo(deps.repo);
  const context = {
    client,
    repoOwner: repoParts.owner,
    repoName: repoParts.name
  };

  function list(name: string): Tasks {
    assertSingleList(name, listName);
    return createTasksView(listName, session, context);
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

function createTasksView(
  name: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Tasks {
  return {
    name,
    stateMachine: session.stateMachine,
    async all(filter?: ListFilter): Promise<Task[]> {
      if (filter?.includeArchived === true) {
        return [];
      }

      const tasks = await fetchProjectTasks(name, session, context);
      const filteredTasks =
        filter?.state === undefined ? tasks : tasks.filter((task) => task.state === filter.state);

      if (filter?.order === "alphabetical") {
        return sortTasks(filteredTasks);
      }

      if (filter?.order === "created") {
        return applyOrder(
          filteredTasks.map((task) => ({
            task,
            raw: {
              created: task.metadata.created
            }
          })),
          "created"
        );
      }

      return filteredTasks;
    },
    async get(id: string): Promise<Task> {
      return fetchIssueTask(id, name, session, context);
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

async function fetchProjectTasks(
  listName: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<Task[]> {
  const tasks: Task[] = [];
  let after: string | null = null;

  do {
    const result: ProjectItemsResponse = await context.client.graphql<ProjectItemsResponse>(
      PROJECT_ITEMS_QUERY,
      {
        projectId: session.projectId,
        after
      }
    );
    const items: ProjectItemsConnection | null | undefined = result.node?.items;

    for (const item of items?.nodes ?? []) {
      const task = mapProjectItemToTask(item, listName, session);
      if (task !== null) {
        tasks.push(task);
      }
    }

    after = items?.pageInfo?.hasNextPage === true ? (items.pageInfo.endCursor ?? null) : null;
  } while (after !== null);

  return tasks;
}

async function fetchIssueTask(
  id: string,
  listName: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<Task> {
  const issueNumber = Number(id);
  if (!Number.isInteger(issueNumber) || issueNumber < 1) {
    throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
  }

  const result = await context.client.graphql<IssueResponse>(ISSUE_QUERY, {
    owner: context.repoOwner,
    repo: context.repoName,
    number: issueNumber
  });
  const issue = result.repository?.issue ?? null;
  if (issue === null) {
    throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
  }

  const projectItem =
    issue.projectItems?.nodes?.find((item) => item.project?.id === session.projectId) ?? null;
  if (projectItem === null) {
    throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
  }

  return mapIssueToTask({
    issue,
    projectItemId: projectItem.id,
    statusName: projectItem.fieldValueByName?.name ?? null,
    listName,
    initialState: session.stateMachine.initial
  });
}

function mapProjectItemToTask(
  item: ProjectItemNode,
  listName: string,
  session: GhIssuesSession
): Task | null {
  const content = item.content;
  if (!isIssueNode(content)) {
    return null;
  }

  return mapIssueToTask({
    issue: content,
    projectItemId: item.id,
    statusName: item.fieldValueByName?.name ?? null,
    listName,
    initialState: session.stateMachine.initial
  });
}

function isIssueNode(value: unknown): value is IssueNode {
  return (
    isRecord(value) &&
    value.__typename === "Issue" &&
    typeof value.number === "number" &&
    typeof value.title === "string" &&
    typeof value.url === "string" &&
    typeof value.createdAt === "string"
  );
}

function mapIssueToTask(options: {
  issue: IssueNode;
  projectItemId: string;
  statusName: string | null;
  listName: string;
  initialState: string;
}): Task {
  const id = String(options.issue.number);
  const labels = (options.issue.labels?.nodes ?? [])
    .filter((node): node is { name: string } => node !== null)
    .map((node) => node.name);
  const assignees = (options.issue.assignees?.nodes ?? [])
    .filter((node): node is { login: string } => node !== null)
    .map((node) => node.login);

  return {
    list: options.listName,
    id,
    qualifiedId: `${options.listName}/${id}`,
    name: options.issue.title,
    description: options.issue.body ?? "",
    state: options.statusName ?? options.initialState,
    metadata: {
      url: options.issue.url,
      labels,
      assignees,
      milestone: options.issue.milestone?.title ?? null,
      projectItemId: options.projectItemId,
      created: options.issue.createdAt
    }
  };
}

function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split("/");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    throw new Error(`Invalid GitHub repository "${repo}". Expected "owner/name".`);
  }

  return {
    owner: parts[0],
    name: parts[1]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatusOption(value: unknown): value is StatusOption {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
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
