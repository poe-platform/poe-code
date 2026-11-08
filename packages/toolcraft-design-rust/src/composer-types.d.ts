export type DashboardSubmission = {
  kind: "message" | "plan";
  text: string;
  afterPlanId?: string;
};
export type ComposerState = {
  kind: DashboardSubmission["kind"];
  text: string;
  /** UTF-16 offset at a grapheme boundary. */
  cursor: number;
  focused: boolean;
  afterPlanId?: string;
  error?: string;
  preferredColumn?: number;
  preferredWidth?: number;
};
