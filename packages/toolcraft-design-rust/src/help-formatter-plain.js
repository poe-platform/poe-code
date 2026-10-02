import { createHelpFormatter } from "./help-runtime.js";
export const {formatColumns,formatCommandList,formatOptionList,stripAnsi}=createHelpFormatter(true);
