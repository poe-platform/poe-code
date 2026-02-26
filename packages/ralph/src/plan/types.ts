export type StoryStatus = "open" | "in_progress" | "done";

export type Story = {
  id: string;
  title: string;
  status: StoryStatus;
  dependsOn: string[];
  description?: string;
  acceptanceCriteria: string[];
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  _extra?: Record<string, unknown>;
};

export type RequirementStatus = "pending" | "verifying" | "passed" | "failed";

export type RequirementScenario = {
  name: string;
  when: string;
  then: string;
};

export type Requirement = {
  id: string;
  title: string;
  description?: string;
  scenarios: RequirementScenario[];
  status: RequirementStatus;
  verifiedAt?: string;
  _extra?: Record<string, unknown>;
};

export type Plan = {
  version: number;
  project: string;
  overview?: string;
  goals: string[];
  nonGoals: string[];
  qualityGates: string[];
  requirements: Requirement[];
  stories: Story[];
  _extra?: Record<string, unknown>;
};

