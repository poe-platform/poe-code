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

export type Plan = {
  version: number;
  project: string;
  overview?: string;
  goals: string[];
  nonGoals: string[];
  qualityGates: string[];
  stories: Story[];
  _extra?: Record<string, unknown>;
};

