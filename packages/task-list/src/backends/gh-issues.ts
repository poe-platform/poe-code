import {
  eventsFromState,
  findEvent,
  validateMachine,
  type StateMachineDef
} from "../state-machine.js";
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
import {
  AnchorNotFoundError,
  InvalidTransitionError,
  OrderMismatchError,
  TaskNotFoundError
} from "../types.js";
import { createGhClient, type GhClient } from "./gh-issues-client.js";
import { applyOrder, sortTasks } from "./utils.js";

export const PROJECT_ORGANIZATION_QUERY = `query Project($owner: String!, $number: Int!) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      title
      field(name: "Status") {
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name color description }
        }
      }
      fields(first: 100) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name color description }
          }
        }
      }
    }
  }
}`;

export const PROJECT_USER_QUERY = `query Project($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      title
      field(name: "Status") {
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name color description }
        }
      }
      fields(first: 100) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name color description }
          }
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

const REPOSITORY_ISSUES_QUERY = `query Issues($owner: String!, $repo: String!, $labels: [String!], $after: String) {
  repository(owner: $owner, name: $repo) {
    issues(first: 100, after: $after, labels: $labels, states: OPEN) {
      nodes {
        __typename
        number
        title
        body
        url
        createdAt
        labels(first: 50) { nodes { name } }
        assignees(first: 20) { nodes { login } }
        milestone { title }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const ISSUE_QUERY = `query Issue($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
      number
      title
      body
      url
      createdAt
      labels(first: 50) { nodes { name } }
      assignees(first: 20) { nodes { login } }
      milestone { title }
      projectItems(first: 100, after: $after) {
        nodes {
          id
          project { id }
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

const REPOSITORY_ISSUE_QUERY = `query Issue($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
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
}`;

const ISSUE_STATE_LABELS_QUERY = `query IssueStateLabels($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
      labels(first: 50) { nodes { id name } }
      projectItems(first: 100, after: $after) {
        nodes {
          id
          project { id }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const REPOSITORY_ISSUE_STATE_LABELS_QUERY = `query IssueStateLabels($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
      labels(first: 50) { nodes { id name } }
    }
  }
}`;

const REPOSITORY_QUERY = `query Repository($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
  }
}`;

const ISSUE_ID_QUERY = `query IssueId($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
    }
  }
}`;

const REPOSITORY_LABEL_QUERY = `query RepositoryLabel($owner: String!, $repo: String!, $name: String!) {
  repository(owner: $owner, name: $repo) {
    label(name: $name) {
      id
    }
  }
}`;

const CREATE_ISSUE_MUTATION = `mutation CreateIssue($input: CreateIssueInput!) {
  createIssue(input: $input) {
    issue {
      id
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
}`;

const ADD_PROJECT_ITEM_MUTATION = `mutation AddProjectItem($input: AddProjectV2ItemByIdInput!) {
  addProjectV2ItemById(input: $input) {
    item {
      id
    }
  }
}`;

const UPDATE_STATUS_MUTATION = `mutation UpdateProjectItemStatus($input: UpdateProjectV2ItemFieldValueInput!) {
  updateProjectV2ItemFieldValue(input: $input) {
    projectV2Item {
      id
    }
  }
}`;

const UPDATE_ISSUE_MUTATION = `mutation UpdateIssue($input: UpdateIssueInput!) {
  updateIssue(input: $input) {
    issue {
      id
    }
  }
}`;

const ADD_LABELS_MUTATION = `mutation AddLabels($input: AddLabelsToLabelableInput!) {
  addLabelsToLabelable(input: $input) {
    clientMutationId
  }
}`;

const REMOVE_LABELS_MUTATION = `mutation RemoveLabels($input: RemoveLabelsFromLabelableInput!) {
  removeLabelsFromLabelable(input: $input) {
    clientMutationId
  }
}`;

const ADD_COMMENT_MUTATION = `mutation AddComment($input: AddCommentInput!) {
  addComment(input: $input) {
    commentEdge {
      node {
        id
      }
    }
  }
}`;

const UPDATE_PROJECT_ITEM_POSITION_MUTATION = `mutation UpdateProjectItemPosition($input: UpdateProjectV2ItemPositionInput!) {
  updateProjectV2ItemPosition(input: $input) {
    clientMutationId
  }
}`;

const DELETE_PROJECT_ITEM_MUTATION = `mutation DeleteProjectItem($input: DeleteProjectV2ItemInput!) {
  deleteProjectV2Item(input: $input) {
    deletedItemId
  }
}`;

export interface GhIssuesBackendDeps {
  repo: string;
  project?: { owner: string; number: number };
  filter?: string;
  state?: { labelPrefix?: string };
  stateMachine?: StateMachineDef;
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
  projectId?: string;
  statusFieldId?: string;
  statusOptions: ReadonlyMap<string, string>;
  stateMachine: StateMachineDef;
  labelPrefix?: string;
  labelIds: Map<string, string>;
}

interface GhIssuesTasksContext {
  client: GhClient;
  repoOwner: string;
  repoName: string;
  issueIds: Map<number, string>;
  repositoryId?: string;
  labels?: readonly string[];
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

interface RepositoryIssuesResponse {
  repository?: {
    issues?: {
      nodes?: IssueNode[];
      pageInfo?: {
        hasNextPage?: boolean;
        endCursor?: string | null;
      };
    } | null;
  } | null;
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

interface RepositoryResponse {
  repository?: {
    id?: string | null;
  } | null;
}

interface IssueIdResponse {
  repository?: {
    issue?: {
      id?: string | null;
    } | null;
  } | null;
}

interface RepositoryLabelResponse {
  repository?: {
    label?: {
      id?: string | null;
    } | null;
  } | null;
}

interface IssueStateLabelsResponse {
  repository?: {
    issue?: {
      id?: string | null;
      labels?: IssueNode["labels"];
      projectItems?: {
        nodes?: ProjectItemMembership[];
        pageInfo?: PageInfo;
      } | null;
    } | null;
  } | null;
}

interface CreateIssueResponse {
  createIssue?: {
    issue?: IssueNode | null;
  } | null;
}

interface AddProjectItemResponse {
  addProjectV2ItemById?: {
    item?: {
      id?: string | null;
    } | null;
  } | null;
}

interface IssueNode {
  __typename?: "Issue";
  id?: string;
  number: number;
  title: string;
  body?: string | null;
  url: string;
  createdAt: string;
  labels?: {
    nodes?: Array<{ id?: string; name: string } | null>;
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
    pageInfo?: PageInfo;
  } | null;
}

interface PageInfo {
  hasNextPage?: boolean;
  endCursor?: string | null;
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
  if (deps.state?.labelPrefix === "") {
    throw new Error("gh-issues state.labelPrefix must be a non-empty string when configured.");
  }

  if (deps.stateMachine !== undefined) {
    validateMachine(deps.stateMachine);
  }

  const client = createGhClient({
    token: deps.token,
    endpoint: deps.endpoint,
    fetch: deps.fetch
  });
  const repoParts = parseRepo(deps.repo);
  const project = deps.project;
  let listName: string;
  let session: GhIssuesSession;

  if (project === undefined) {
    if (deps.state?.labelPrefix === undefined || deps.stateMachine === undefined) {
      throw new Error("gh-issues requires project or label-backed stateMachine configuration.");
    }

    listName = deps.repo;
    session = createLabelSession(deps.stateMachine, deps.state.labelPrefix);
  } else {
    listName = `${project.owner}/${project.number}`;
    const variables = { owner: project.owner, number: project.number };
    const organizationResult = await client.graphql<ProjectResponse>(
      PROJECT_ORGANIZATION_QUERY,
      variables
    );
    let resolvedProject = organizationResult.organization?.projectV2 ?? null;

    if (resolvedProject === null) {
      const userResult = await client.graphql<ProjectResponse>(PROJECT_USER_QUERY, variables);
      resolvedProject = userResult.user?.projectV2 ?? null;
    }

    if (resolvedProject === null) {
      throw new Error(`Project ${listName} not found or inaccessible.`);
    }

    const field = resolvedProject.field;
    if (!isStatusField(field)) {
      throw new Error(`Project ${listName} has no Status field; gh-issues requires one.`);
    }

    if (field.options.length === 0) {
      throw new Error(`Project ${listName} Status field has no options.`);
    }

    session = createProjectSession(resolvedProject, field, deps.state?.labelPrefix);
  }

  const context = {
    client,
    repoOwner: repoParts.owner,
    repoName: repoParts.name,
    issueIds: new Map<number, string>(),
    labels: resolveLabelsFilter(deps.filter)
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

function createProjectSession(
  project: ProjectV2,
  field: StatusField,
  labelPrefix?: string
): GhIssuesSession {
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
    stateMachine,
    labelPrefix,
    labelIds: new Map<string, string>()
  });
}

function createLabelSession(stateMachine: StateMachineDef, labelPrefix: string): GhIssuesSession {
  return Object.freeze({
    statusOptions: new Map(stateMachine.states.map((state) => [state, state])),
    stateMachine,
    labelPrefix,
    labelIds: new Map<string, string>()
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

      const tasks = await fetchTasks(name, session, context);
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
    /**
     * GitHub Issues assigns the issue number, so TaskCreate.id is intentionally ignored.
     */
    async create(input: TaskCreate): Promise<Task> {
      const repositoryId = await resolveRepositoryId(context);
      const labelIds = await resolveConfiguredLabelIds(session, context);
      const created = await context.client.graphql<CreateIssueResponse>(CREATE_ISSUE_MUTATION, {
        input: {
          repositoryId,
          title: input.name,
          body: input.description ?? "",
          ...(labelIds.length === 0 ? {} : { labelIds })
        }
      });
      const issue = created.createIssue?.issue;
      const issueId = issue?.id ?? null;
      const issueNumber = issue?.number ?? null;
      if (issue === undefined || issue === null || issueId === null || issueNumber === null) {
        throw new Error("GitHub createIssue response did not include issue id and number.");
      }

      context.issueIds.set(issueNumber, issueId);
      let projectItemId: string | undefined;
      try {
        if (session.projectId !== undefined) {
          const added = await context.client.graphql<AddProjectItemResponse>(
            ADD_PROJECT_ITEM_MUTATION,
            {
              input: {
                projectId: session.projectId,
                contentId: issueId
              }
            }
          );
          projectItemId = added.addProjectV2ItemById?.item?.id ?? undefined;
          if (projectItemId === undefined) {
            throw new Error(
              "GitHub addProjectV2ItemById response did not include project item id."
            );
          }
        }

        if (session.labelPrefix === undefined) {
          if (projectItemId === undefined) {
            throw new Error("gh-issues project-backed state requires a project item id.");
          }
          await updateProjectItemStatus(
            projectItemId,
            session.stateMachine.initial,
            session,
            context
          );
        } else {
          await addStateLabel(issueId, session.stateMachine.initial, session, context);
        }
      } catch (error) {
        if (projectItemId !== undefined && session.projectId !== undefined) {
          await context.client.graphql(DELETE_PROJECT_ITEM_MUTATION, {
            input: { projectId: session.projectId, itemId: projectItemId }
          });
        }
        await context.client.graphql(UPDATE_ISSUE_MUTATION, {
          input: { id: issueId, state: "CLOSED" }
        });
        throw error;
      }

      const task = mapIssueToTask({
        issue: {
          ...issue,
          number: issueNumber,
          title: input.name,
          body: input.description ?? "",
          url: issue.url,
          createdAt: issue.createdAt,
          labels: {
            nodes: [
              ...(context.labels ?? []).map((label) => ({ name: label })),
              ...(session.labelPrefix === undefined
                ? []
                : [{ name: `${session.labelPrefix}${session.stateMachine.initial}` }])
            ]
          }
        },
        projectItemId,
        statusName: session.stateMachine.initial,
        listName: name,
        session
      });
      return session.labelPrefix === undefined
        ? task
        : { ...task, state: session.stateMachine.initial };
    },
    async update(id: string, patch: TaskUpdate): Promise<Task> {
      const task = await fetchIssueTask(id, name, session, context);
      const input: Record<string, unknown> = {};

      if (patch.name !== undefined) {
        input.title = patch.name;
      }

      if (patch.description !== undefined) {
        input.body = patch.description;
      }

      // metadata writes are out of scope for v1 on gh-issues.
      if (Object.keys(input).length > 0) {
        input.id = await resolveIssueId(id, name, context);
        await context.client.graphql(UPDATE_ISSUE_MUTATION, {
          input
        });
      }

      return {
        ...task,
        name: patch.name ?? task.name,
        description: patch.description ?? task.description
      };
    },
    async fire(id: string, event: string, _opts?: TaskFireOptions): Promise<Task> {
      if (!session.statusOptions.has(event)) {
        throw new InvalidTransitionError({
          event,
          to: event,
          reason: `Unknown gh-issues Status state "${event}".`
        });
      }

      const task = await fetchIssueTask(id, name, session, context);
      const transition = findEvent(session.stateMachine, task.state, event);
      if (transition === undefined) {
        throw new InvalidTransitionError({
          task,
          event,
          to: event,
          reason: `Cannot fire event "${event}" from task state "${task.state}".`
        });
      }

      // opts.metadataPatch writes are out of scope for v1 on gh-issues.
      if (session.labelPrefix === undefined) {
        const projectItemId = projectItemIdFromTask(task);
        await updateProjectItemStatus(projectItemId, event, session, context);
      } else {
        await updateIssueStateLabel(id, name, event, session, context);
      }
      return { ...task, state: event };
    },
    async comment(id: string, body: string): Promise<void> {
      await fetchIssueTask(id, name, session, context);
      await context.client.graphql(ADD_COMMENT_MUTATION, {
        input: {
          subjectId: await resolveIssueId(id, name, context),
          body
        }
      });
    },
    async canFire(id: string, event: string): Promise<boolean> {
      const task = await fetchIssueTask(id, name, session, context);
      return findEvent(session.stateMachine, task.state, event) !== undefined;
    },
    async events(id: string): Promise<readonly string[]> {
      const task = await fetchIssueTask(id, name, session, context);
      return eventsFromState(session.stateMachine, task.state);
    },
    async delete(id: string): Promise<void> {
      if (session.projectId === undefined) {
        await context.client.graphql(UPDATE_ISSUE_MUTATION, {
          input: {
            id: await resolveIssueId(id, name, context),
            state: "CLOSED"
          }
        });
        return;
      }

      const projectItemId = await resolveProjectItemId(id, name, session, context);
      await context.client.graphql(DELETE_PROJECT_ITEM_MUTATION, {
        input: {
          projectId: session.projectId,
          itemId: projectItemId
        }
      });
    },
    async move(id: string, anchor: MoveAnchor): Promise<Task> {
      assertProjectBacked(session, "move");
      const task = await fetchIssueTask(id, name, session, context);
      const projectItemId = projectItemIdFromTask(task);
      const afterId = await resolveMoveAfterId(id, anchor, name, session, context);

      await updateProjectItemPosition(projectItemId, afterId, session, context);

      return task;
    },
    async reorder(ids: readonly string[]): Promise<readonly Task[]> {
      assertProjectBacked(session, "reorder");
      const currentTasks = await fetchProjectTasks(name, session, context);
      const currentIds = currentTasks.map((task) => task.id);
      const currentSet = new Set(currentIds);
      const inputSet = new Set(ids);
      const seenInputIds = new Set<string>();
      const missing = currentIds.filter((id) => !inputSet.has(id));
      const extra = ids.filter((id) => {
        if (!currentSet.has(id)) {
          return true;
        }

        if (seenInputIds.has(id)) {
          return true;
        }

        seenInputIds.add(id);
        return false;
      });

      if (missing.length > 0 || extra.length > 0) {
        throw new OrderMismatchError({ missing, extra });
      }

      const itemIdsByTaskId = new Map(
        currentTasks.map((task) => [task.id, projectItemIdFromTask(task)])
      );
      let afterId: string | null = null;

      try {
        for (const id of ids) {
          const projectItemId = itemIdsByTaskId.get(id);
          if (projectItemId === undefined) {
            throw new OrderMismatchError({ missing: [id], extra: [] });
          }

          await updateProjectItemPosition(projectItemId, afterId, session, context);
          afterId = projectItemId;
        }
      } catch (error) {
        await restoreProjectOrder(currentTasks, session, context);
        throw error;
      }

      return fetchProjectTasks(name, session, context);
    }
  };
}

async function restoreProjectOrder(
  tasks: readonly Task[],
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<void> {
  let afterId: string | null = null;

  for (const task of tasks) {
    const projectItemId = projectItemIdFromTask(task);
    await updateProjectItemPosition(projectItemId, afterId, session, context);
    afterId = projectItemId;
  }
}

async function resolveRepositoryId(context: GhIssuesTasksContext): Promise<string> {
  if (context.repositoryId !== undefined) {
    return context.repositoryId;
  }

  const result = await context.client.graphql<RepositoryResponse>(REPOSITORY_QUERY, {
    owner: context.repoOwner,
    repo: context.repoName
  });
  const repositoryId = result.repository?.id ?? null;
  if (repositoryId === null) {
    throw new Error(
      `Repository ${context.repoOwner}/${context.repoName} not found or inaccessible.`
    );
  }

  context.repositoryId = repositoryId;
  return repositoryId;
}

async function resolveIssueId(
  id: string,
  listName: string,
  context: GhIssuesTasksContext
): Promise<string> {
  const issueNumber = parseIssueNumber(id, listName);
  const cachedIssueId = context.issueIds.get(issueNumber);
  if (cachedIssueId !== undefined) {
    return cachedIssueId;
  }

  const result = await context.client.graphql<IssueIdResponse>(ISSUE_ID_QUERY, {
    owner: context.repoOwner,
    repo: context.repoName,
    number: issueNumber
  });
  const issueId = result.repository?.issue?.id ?? null;
  if (issueId === null) {
    throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
  }

  context.issueIds.set(issueNumber, issueId);
  return issueId;
}

async function resolveProjectItemId(
  id: string,
  listName: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<string> {
  assertProjectBacked(session, "resolve project item");
  const issueNumber = parseIssueNumber(id, listName);
  let after: string | null | undefined;

  while (true) {
    const result = await context.client.graphql<IssueStateLabelsResponse>(
      ISSUE_STATE_LABELS_QUERY,
      {
        owner: context.repoOwner,
        repo: context.repoName,
        number: issueNumber,
        after
      }
    );
    const issue = result.repository?.issue ?? null;
    if (issue === null) {
      throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
    }

    if (issue.id !== undefined && issue.id !== null) {
      context.issueIds.set(issueNumber, issue.id);
    }

    const projectItem =
      issue.projectItems?.nodes?.find((item) => item.project?.id === session.projectId) ?? null;
    if (projectItem !== null) {
      return projectItem.id;
    }

    const pageInfo = issue.projectItems?.pageInfo;
    if (
      pageInfo?.hasNextPage !== true ||
      pageInfo.endCursor === undefined ||
      pageInfo.endCursor === null
    ) {
      throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
    }

    after = pageInfo.endCursor;
  }
}

async function updateProjectItemStatus(
  projectItemId: string,
  state: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<void> {
  assertProjectBacked(session, "set project status");
  const optionId = session.statusOptions.get(state);
  if (optionId === undefined) {
    throw new InvalidTransitionError({
      to: state,
      reason: `Unknown gh-issues Status state "${state}".`
    });
  }

  await context.client.graphql(UPDATE_STATUS_MUTATION, {
    input: {
      projectId: session.projectId,
      itemId: projectItemId,
      fieldId: session.statusFieldId,
      value: {
        singleSelectOptionId: optionId
      }
    }
  });
}

async function addStateLabel(
  issueId: string,
  state: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<void> {
  const labelId = await resolveStateLabelId(state, session, context);
  await context.client.graphql(ADD_LABELS_MUTATION, {
    input: {
      labelableId: issueId,
      labelIds: [labelId]
    }
  });
}

async function updateIssueStateLabel(
  id: string,
  listName: string,
  state: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<void> {
  const issueNumber = parseIssueNumber(id, listName);
  let after: string | null | undefined;
  let issue: NonNullable<IssueStateLabelsResponse["repository"]>["issue"] = null;
  let isInProject = session.projectId === undefined;

  while (true) {
    const result = await context.client.graphql<IssueStateLabelsResponse>(
      session.projectId === undefined
        ? REPOSITORY_ISSUE_STATE_LABELS_QUERY
        : ISSUE_STATE_LABELS_QUERY,
      {
        owner: context.repoOwner,
        repo: context.repoName,
        number: issueNumber,
        after
      }
    );
    const currentIssue = result.repository?.issue ?? null;
    if (currentIssue === null) {
      throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
    }
    if (typeof currentIssue.id === "string") {
      context.issueIds.set(issueNumber, currentIssue.id);
    }
    issue ??= currentIssue;
    if (session.projectId === undefined) {
      break;
    }
    if (currentIssue.projectItems?.nodes?.some((item) => item.project?.id === session.projectId)) {
      isInProject = true;
      break;
    }
    const pageInfo = currentIssue.projectItems?.pageInfo;
    if (
      pageInfo?.hasNextPage !== true ||
      pageInfo.endCursor === undefined ||
      pageInfo.endCursor === null
    ) {
      break;
    }
    after = pageInfo.endCursor;
  }

  if (issue === null) {
    throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
  }
  const issueId = issue.id ?? null;
  if (issueId === null) {
    throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
  }
  if (!isInProject) {
    throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
  }

  const targetLabel = `${session.labelPrefix}${state}`;
  const stateLabels = (issue.labels?.nodes ?? []).filter(
    (node): node is { id?: string; name: string } =>
      node !== null && node.name.startsWith(session.labelPrefix ?? "")
  );
  const targetNode = stateLabels.find((node) => node.name === targetLabel);
  if (targetNode === undefined) {
    await addStateLabel(issueId, state, session, context);
  }

  const labelIdsToRemove = stateLabels
    .filter((node) => node.name !== targetLabel && node.id !== undefined)
    .map((node) => node.id as string);
  if (labelIdsToRemove.length > 0) {
    await context.client.graphql(REMOVE_LABELS_MUTATION, {
      input: {
        labelableId: issueId,
        labelIds: labelIdsToRemove
      }
    });
  }
}

async function resolveStateLabelId(
  state: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<string> {
  return resolveLabelId(`${session.labelPrefix}${state}`, session, context);
}

async function resolveConfiguredLabelIds(
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<string[]> {
  return Promise.all((context.labels ?? []).map((name) => resolveLabelId(name, session, context)));
}

async function resolveLabelId(
  name: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<string> {
  const cachedLabelId = session.labelIds.get(name);
  if (cachedLabelId !== undefined) {
    return cachedLabelId;
  }

  const result = await context.client.graphql<RepositoryLabelResponse>(REPOSITORY_LABEL_QUERY, {
    owner: context.repoOwner,
    repo: context.repoName,
    name
  });
  const labelId = result.repository?.label?.id ?? null;
  if (labelId === null) {
    throw new Error(`GitHub label "${name}" not found or inaccessible.`);
  }

  session.labelIds.set(name, labelId);
  return labelId;
}

async function updateProjectItemPosition(
  projectItemId: string,
  afterId: string | null,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<void> {
  assertProjectBacked(session, "update project position");
  await context.client.graphql(UPDATE_PROJECT_ITEM_POSITION_MUTATION, {
    input: {
      projectId: session.projectId,
      itemId: projectItemId,
      afterId
    }
  });
}

async function resolveMoveAfterId(
  movingId: string,
  anchor: MoveAnchor,
  listName: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<string | null> {
  if ("position" in anchor) {
    if (anchor.position === "top") {
      return null;
    }

    const tasks = await fetchProjectTasks(listName, session, context);
    for (let index = tasks.length - 1; index >= 0; index -= 1) {
      const task = tasks[index];
      if (task.id !== movingId) {
        return projectItemIdFromTask(task);
      }
    }

    return null;
  }

  const anchorId = "before" in anchor ? anchor.before : anchor.after;
  let anchorProjectItemId: string;
  try {
    anchorProjectItemId = await resolveProjectItemId(anchorId, listName, session, context);
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      throw new AnchorNotFoundError(anchorId);
    }

    throw error;
  }

  if ("after" in anchor) {
    return anchorProjectItemId;
  }

  const tasks = await fetchProjectTasks(listName, session, context);
  const anchorIndex = tasks.findIndex((task) => task.id === anchorId);
  if (anchorIndex < 0) {
    throw new AnchorNotFoundError(anchorId);
  }

  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const predecessor = tasks[index];
    if (predecessor.id !== movingId) {
      return projectItemIdFromTask(predecessor);
    }
  }

  return null;
}

async function fetchProjectTasks(
  listName: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<Task[]> {
  assertProjectBacked(session, "list project items");
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

async function fetchTasks(
  listName: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<Task[]> {
  if (session.projectId !== undefined) {
    return fetchProjectTasks(listName, session, context);
  }

  const tasks: Task[] = [];
  let after: string | null = null;

  do {
    const result: RepositoryIssuesResponse = await context.client.graphql<RepositoryIssuesResponse>(
      REPOSITORY_ISSUES_QUERY,
      {
        owner: context.repoOwner,
        repo: context.repoName,
        labels: context.labels,
        after
      }
    );
    const issues: NonNullable<RepositoryIssuesResponse["repository"]>["issues"] =
      result.repository?.issues;

    for (const issue of issues?.nodes ?? []) {
      tasks.push(mapIssueToTask({ issue, statusName: null, listName, session }));
    }

    after = issues?.pageInfo?.hasNextPage === true ? (issues.pageInfo.endCursor ?? null) : null;
  } while (after !== null);

  return tasks;
}

async function fetchIssueTask(
  id: string,
  listName: string,
  session: GhIssuesSession,
  context: GhIssuesTasksContext
): Promise<Task> {
  const issueNumber = parseIssueNumber(id, listName);
  let after: string | null | undefined;
  let issue: IssueNodeWithProjectItems | null = null;
  let projectItem: ProjectItemMembership | null = null;

  while (true) {
    const result = await context.client.graphql<IssueResponse>(
      session.projectId === undefined ? REPOSITORY_ISSUE_QUERY : ISSUE_QUERY,
      {
        owner: context.repoOwner,
        repo: context.repoName,
        number: issueNumber,
        after
      }
    );
    const currentIssue = result.repository?.issue ?? null;
    if (currentIssue === null) {
      throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
    }
    if (currentIssue.id !== undefined) {
      context.issueIds.set(issueNumber, currentIssue.id);
    }
    issue ??= currentIssue;
    if (session.projectId === undefined) {
      break;
    }
    projectItem =
      currentIssue.projectItems?.nodes?.find((item) => item.project?.id === session.projectId) ??
      null;
    if (projectItem !== null) {
      break;
    }
    const pageInfo = currentIssue.projectItems?.pageInfo;
    if (
      pageInfo?.hasNextPage !== true ||
      pageInfo.endCursor === undefined ||
      pageInfo.endCursor === null
    ) {
      throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
    }
    after = pageInfo.endCursor;
  }

  return mapIssueToTask({
    issue,
    projectItemId: projectItem?.id,
    statusName: projectItem?.fieldValueByName?.name ?? null,
    listName,
    session
  });
}

function parseIssueNumber(id: string, listName: string): number {
  if (!isCanonicalDecimalIssueId(id)) {
    throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
  }

  const issueNumber = Number(id);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new TaskNotFoundError(`Task "${listName}/${id}" not found.`);
  }
  return issueNumber;
}

function isCanonicalDecimalIssueId(id: string): boolean {
  if (id.length === 0 || id[0] === "0") {
    return false;
  }

  for (let index = 0; index < id.length; index += 1) {
    const charCode = id.charCodeAt(index);
    if (charCode < 48 || charCode > 57) {
      return false;
    }
  }

  return true;
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
    session
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
  projectItemId?: string;
  statusName: string | null;
  listName: string;
  session: GhIssuesSession;
}): Task {
  const id = String(options.issue.number);
  const labels = (options.issue.labels?.nodes ?? [])
    .filter((node): node is { id?: string; name: string } => node !== null)
    .map((node) => node.name);
  const assignees = (options.issue.assignees?.nodes ?? [])
    .filter((node): node is { login: string } => node !== null)
    .map((node) => node.login);

  return {
    list: options.listName,
    id,
    qualifiedId: `${options.listName}#${id}`,
    name: options.issue.title,
    description: options.issue.body ?? "",
    state: resolveTaskState(labels, options.statusName, options.session),
    metadata: {
      url: options.issue.url,
      labels,
      assignees,
      milestone: options.issue.milestone?.title ?? null,
      ...(options.projectItemId === undefined ? {} : { projectItemId: options.projectItemId }),
      created: options.issue.createdAt
    }
  };
}

function resolveTaskState(
  labels: readonly string[],
  statusName: string | null,
  session: GhIssuesSession
): string {
  if (session.labelPrefix === undefined) {
    return statusName ?? session.stateMachine.initial;
  }

  return (
    session.stateMachine.states.find((state) =>
      labels.includes(`${session.labelPrefix}${state}`)
    ) ?? session.stateMachine.initial
  );
}

function projectItemIdFromTask(task: Task): string {
  const projectItemId = task.metadata.projectItemId;
  if (typeof projectItemId !== "string") {
    throw new Error(`Task "${task.qualifiedId}" is missing GitHub project item metadata.`);
  }

  return projectItemId;
}

function assertProjectBacked(
  session: GhIssuesSession,
  operation: string
): asserts session is GhIssuesSession & { projectId: string; statusFieldId: string } {
  if (session.projectId === undefined || session.statusFieldId === undefined) {
    throw new Error(`gh-issues ${operation} requires a configured GitHub Project.`);
  }
}

function resolveLabelsFilter(filter: string | undefined): readonly string[] | undefined {
  if (filter === undefined) {
    return undefined;
  }

  const prefix = "label:";
  if (!filter.startsWith(prefix)) {
    throw new Error('gh-issues filter currently supports only "label:<name>".');
  }

  const label = filter.slice(prefix.length).trim();
  if (label.length === 0) {
    throw new Error('gh-issues filter requires a non-empty label after "label:".');
  }

  return [label];
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
  const prefix = `${listName}#`;

  if (!qualifiedId.startsWith(prefix) || qualifiedId.length === prefix.length) {
    throw new Error(`Invalid qualified task id "${qualifiedId}".`);
  }

  return qualifiedId.slice(prefix.length);
}
