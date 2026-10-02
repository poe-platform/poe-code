import type {ComposerState, DashboardSubmission} from "./composer-types.js";
import type {KeypressEvent} from "./dashboard-keypress.js";
export type {ComposerState, DashboardSubmission} from "./composer-types.js";
export declare function createComposerState(kind: DashboardSubmission["kind"], afterPlanId?: string): ComposerState;
export declare function editComposer(state: ComposerState, event: KeypressEvent, width?: number): {
  state: ComposerState;
  handled: boolean;
  submit?: DashboardSubmission;
};
