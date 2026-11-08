import * as native from "../dist/index.js";
import * as reference from "@poe-code/agent-human-in-loop";
const a: typeof reference = native;
const b: typeof native = reference;
const provider: reference.HumanInLoopProvider = native.mockProvider({ outcome: "approved" });
const result: Promise<native.ApprovalResult> = reference.requestApproval({ message: "Approve?", provider });
void [a, b, result];
