export interface GhLimits {
  readonly maxHttpRequests: number;
  readonly maxHttpBytes: number;
  readonly maxOutputBytes: number;
  readonly maxInputBytes: number;
  readonly maxFiles: number;
  readonly maxItems: number;
  readonly maxAliasDepth: number;
}

export const DEFAULT_GH_LIMITS: Readonly<GhLimits> = Object.freeze({
  maxHttpRequests: Infinity,
  maxHttpBytes: Infinity,
  maxOutputBytes: Infinity,
  maxInputBytes: Infinity,
  maxFiles: Infinity,
  maxItems: Infinity,
  maxAliasDepth: Infinity,
});

export interface GhHttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly signal: AbortSignal;
}

export interface GhHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export type GhHttpTransport = (request: GhHttpRequest) => Promise<GhHttpResponse>;

export interface GhSshKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly fingerprint: string;
  readonly algorithm: string;
  readonly bits: number;
  readonly comment: string;
}

export interface GhSshKeyInfo {
  readonly keyType: string;
  readonly base64Data: string;
  readonly comment: string;
  readonly fingerprint: string;
  readonly algorithm: string;
  readonly bits: number;
}

export interface GhSshProvider {
  keygen(options?: {
    readonly type?: "ed25519" | "rsa" | "ecdsa" | undefined;
    readonly bits?: number | undefined;
    readonly comment?: string | undefined;
    readonly passphrase?: string | undefined;
  }): Promise<GhSshKeyPair>;
  fingerprint(publicKey: string): Promise<GhSshKeyInfo>;
  parsePublicKey(publicKey: string): GhSshKeyInfo;
  sign(payload: Uint8Array | string, privateKey: string): Promise<string>;
  verify(payload: Uint8Array | string, signature: string, publicKey: string): Promise<boolean>;
  connect(
    host: string,
    user: string,
    command?: string
  ): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
}

export interface GhOpenSslProvider {
  sha1(data: Uint8Array | string): Promise<Uint8Array>;
  sha256(data: Uint8Array | string): Promise<Uint8Array>;
  hmacSha256(key: Uint8Array | string, data: Uint8Array | string): Promise<Uint8Array>;
  randomBytes(size: number): Uint8Array;
  generateRsaKeyPair(bits?: number): Promise<{
    readonly publicKeyPem: string;
    readonly privateKeyPem: string;
    readonly fingerprint: string;
  }>;
  x509SelfSignedCert(options: {
    readonly commonName: string;
    readonly days?: number | undefined;
  }): Promise<{
    readonly certPem: string;
    readonly privateKeyPem: string;
    readonly sha256Fingerprint: string;
  }>;
  encryptSecretForGitHub(
    secretValue: string,
    publicKeyBase64: string,
    keyId: string
  ): Promise<{ readonly encrypted_value: string; readonly key_id: string }>;
  verifyAttestationSignature(
    bundle: unknown,
    artifactBytes: Uint8Array
  ): Promise<{
    readonly verified: boolean;
    readonly subjectDigest: string;
    readonly issuer: string;
    readonly repository: string;
    readonly workflowRef: string;
  }>;
}

export type GhBrowserOpener = (url: string) => void | Promise<void>;

export interface GhUser {
  readonly login: string;
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly bio?: string | undefined;
  readonly company?: string | undefined;
  readonly type?: "User" | "Organization" | "Bot" | undefined;
}

export interface GhLabel {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly description: string;
  readonly isDefault?: boolean | undefined;
}

export interface GhMilestone {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly state: "open" | "closed";
  readonly dueOn?: string | null | undefined;
}

export interface GhFileChange {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: "added" | "modified" | "removed" | "renamed";
  readonly patch?: string | undefined;
  readonly previousPath?: string | undefined;
}

export interface GhCommitRecord {
  readonly oid: string;
  readonly messageHeadline: string;
  readonly messageBody: string;
  readonly author: {
    readonly name: string;
    readonly email: string;
    readonly login: string;
  };
  readonly committedDate: string;
  readonly parents: readonly string[];
  readonly files?: Readonly<Record<string, string>> | undefined;
}

export interface GhPrReview {
  readonly id: number;
  readonly author: { readonly login: string };
  readonly state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  readonly body: string;
  readonly submittedAt: string;
  readonly commitOid: string;
}

export interface GhComment {
  readonly id: number;
  readonly author: { readonly login: string };
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly url: string;
}

export interface GhCheckRun {
  readonly id: number;
  readonly name: string;
  readonly status: "queued" | "in_progress" | "completed" | "waiting" | "pending";
  readonly conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | null;
  readonly workflowName: string;
  readonly detailsUrl: string;
  readonly startedAt: string;
  readonly completedAt?: string | null | undefined;
  readonly isRequired?: boolean | undefined;
  readonly description?: string | undefined;
}

export interface GhPullRequest {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  url: string;
  headRefName: string;
  headRefOid: string;
  headRepositoryOwner: { readonly login: string };
  headRepository: { readonly name: string };
  baseRefName: string;
  baseRefOid: string;
  author: { readonly login: string };
  assignees: Array<{ readonly login: string }>;
  labels: GhLabel[];
  reviewRequests: Array<{ readonly login: string }>;
  reviews: GhPrReview[];
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "";
  comments: GhComment[];
  commits: GhCommitRecord[];
  files: GhFileChange[];
  diff: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus: "CLEAN" | "BLOCKED" | "BEHIND" | "DIRTY" | "DRAFT" | "UNSTABLE" | "HAS_HOOKS";
  statusCheckRollup: GhCheckRun[];
  milestone: GhMilestone | null;
  projectItems: Array<{ readonly title: string }>;
  maintainerCanModify: boolean;
  locked: boolean;
  activeLockReason?: string | null | undefined;
  autoMergeRequest: { readonly mergeMethod: "MERGE" | "SQUASH" | "REBASE"; readonly enabledAt: string } | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  mergedBy: { readonly login: string } | null;
  mergeCommit: { readonly oid: string } | null;
}

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  stateReason?: "COMPLETED" | "NOT_PLANNED" | "REOPENED" | null | undefined;
  url: string;
  author: { readonly login: string };
  assignees: Array<{ readonly login: string }>;
  labels: GhLabel[];
  comments: GhComment[];
  milestone: GhMilestone | null;
  projectItems: Array<{ readonly title: string }>;
  isPinned: boolean;
  locked: boolean;
  activeLockReason?: string | null | undefined;
  linkedBranches: string[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface GhDeployKey {
  readonly id: number;
  readonly title: string;
  readonly key: string;
  readonly readOnly: boolean;
  readonly createdAt: string;
}

export interface GhReleaseAsset {
  readonly id: number;
  readonly name: string;
  readonly label: string;
  readonly size: number;
  readonly contentType: string;
  readonly downloadCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly url: string;
  readonly data: Uint8Array;
}

export interface GhRelease {
  id: number;
  tagName: string;
  name: string;
  body: string;
  isDraft: boolean;
  isPrerelease: boolean;
  isLatest: boolean;
  targetCommitish: string;
  author: { readonly login: string };
  createdAt: string;
  publishedAt: string;
  url: string;
  assets: GhReleaseAsset[];
}

export interface GhWorkflow {
  id: number;
  name: string;
  path: string;
  state: "active" | "disabled_manually" | "disabled_inactivity";
  content: string;
}

export interface GhWorkflowJob {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  startedAt: string;
  completedAt: string | null;
  steps: Array<{
    readonly name: string;
    readonly status: string;
    readonly conclusion: string | null;
    readonly number: number;
    readonly log?: string | undefined;
  }>;
  log: string;
}

export interface GhWorkflowArtifact {
  readonly id: number;
  readonly name: string;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

export interface GhWorkflowRun {
  databaseId: number;
  name: string;
  displayTitle: string;
  workflowName: string;
  workflowDatabaseId: number;
  headBranch: string;
  headSha: string;
  event: string;
  status: "queued" | "in_progress" | "completed" | "waiting";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | "neutral" | "timed_out" | null;
  attempt: number;
  url: string;
  actor: { readonly login: string };
  createdAt: string;
  updatedAt: string;
  jobs: GhWorkflowJob[];
  artifacts: GhWorkflowArtifact[];
}

export interface GhSecret {
  name: string;
  updatedAt: string;
  visibility?: "all" | "private" | "selected" | undefined;
  encryptedValue?: string | undefined;
  environment?: string | undefined;
  org?: string | undefined;
}

export interface GhVariable {
  name: string;
  value: string;
  createdAt: string;
  updatedAt: string;
  environment?: string | undefined;
  org?: string | undefined;
}

export interface GhCacheEntry {
  readonly id: number;
  readonly key: string;
  readonly version: string;
  readonly ref: string;
  readonly sizeInBytes: number;
  readonly createdAt: string;
  readonly lastAccessedAt: string;
}

export interface GhRepo {
  id: number;
  name: string;
  owner: { readonly login: string };
  nameWithOwner: string;
  description: string;
  homepageUrl: string;
  url: string;
  sshUrl: string;
  cloneUrl: string;
  visibility: "PUBLIC" | "PRIVATE" | "INTERNAL";
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  isTemplate: boolean;
  defaultBranchRef: { readonly name: string };
  parent: { readonly nameWithOwner: string; readonly owner: { readonly login: string }; readonly name: string; readonly defaultBranchRef: { readonly name: string } } | null;
  primaryLanguage: { readonly name: string } | null;
  repositoryTopics: Array<{ readonly name: string }>;
  hasIssuesEnabled: boolean;
  hasWikiEnabled: boolean;
  hasProjectsEnabled: boolean;
  hasDiscussionsEnabled: boolean;
  mergeCommitAllowed: boolean;
  squashMergeAllowed: boolean;
  rebaseMergeAllowed: boolean;
  autoMergeAllowed: boolean;
  deleteBranchOnMerge: boolean;
  stargazerCount: number;
  forkCount: number;
  viewerPermission: "ADMIN" | "WRITE" | "READ";
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  branches: Map<string, string>;
  commits: Map<string, GhCommitRecord>;
  branchFiles: Map<string, Record<string, string>>;
  pullRequests: Map<number, GhPullRequest>;
  issues: Map<number, GhIssue>;
  labels: Map<string, GhLabel>;
  milestones: Map<number, GhMilestone>;
  releases: Map<string, GhRelease>;
  workflows: Map<number, GhWorkflow>;
  workflowRuns: Map<number, GhWorkflowRun>;
  deployKeys: Map<number, GhDeployKey>;
  secrets: Map<string, GhSecret>;
  variables: Map<string, GhVariable>;
  caches: Map<number, GhCacheEntry>;
  autolinks?: Map<number, GhAutolink> | undefined;
  rulesets?: Map<number, GhRuleset> | undefined;
  nextNumber: number;
}

export interface GhAutolink {
  readonly id: number;
  readonly keyPrefix: string;
  readonly urlTemplate: string;
  readonly isAlphanumeric: boolean;
}

export interface GhRuleset {
  readonly id: number;
  readonly name: string;
  readonly target: "branch" | "tag" | "push";
  readonly enforcement: "active" | "disabled" | "evaluate";
  readonly source: string;
  readonly rules: ReadonlyArray<{ readonly type: string }>;
}

export interface GhProjectField {
  readonly id: string;
  readonly name: string;
  readonly dataType: string;
}

export interface GhProjectItem {
  readonly id: string;
  title: string;
  body: string;
  type: "DRAFT_ISSUE" | "ISSUE" | "PULL_REQUEST";
  contentUrl?: string | undefined;
  archived?: boolean | undefined;
  fieldValues: Record<string, string>;
}

export interface GhProject {
  number: number;
  id: string;
  title: string;
  shortDescription: string;
  readme: string;
  public: boolean;
  closed: boolean;
  isTemplate: boolean;
  owner: string;
  url: string;
  fields: Map<string, GhProjectField>;
  items: Map<string, GhProjectItem>;
  linkedRepos: Set<string>;
}

export interface GhCodespace {
  name: string;
  displayName: string;
  repository: string;
  branch: string;
  state: "Available" | "Shutdown" | "Rebuilding";
  machineName: string;
  createdAt: string;
}

export interface GhGistFile {
  filename: string;
  content: string;
  size: number;
  language?: string | undefined;
}

export interface GhGist {
  id: string;
  description: string;
  public: boolean;
  owner: { readonly login: string };
  files: Record<string, GhGistFile>;
  htmlUrl: string;
  gitPullUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface GhSshKey {
  readonly id: number;
  readonly title: string;
  readonly key: string;
  readonly type: "authentication" | "signing";
  readonly createdAt: string;
}

export interface GhGpgKey {
  readonly id: number;
  readonly keyId: string;
  readonly name: string;
  readonly rawKey: string;
  readonly emails: ReadonlyArray<{ readonly email: string }>;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export interface GhHostAuthEntry {
  user: string;
  oauthToken: string;
  gitProtocol: "https" | "ssh";
  scopes: string[];
  active: boolean;
}

export interface GhConfigState {
  gitProtocol: "https" | "ssh";
  editor: string;
  prompt: "enabled" | "disabled";
  pager: string;
  httpUnixSocket: string;
  browser: string;
  aliases: Record<string, string>;
  hosts: Record<string, GhHostAuthEntry[]>;
}
