import type { ApprovalRequest, ApprovalResult } from "../types.js";

export function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildScript(request: ApprovalRequest, title: string): string {
  const escapedMessage = escapeAppleScriptString(request.message);
  const escapedTitle = escapeAppleScriptString(title);

  if (request.declineInputPrompt === undefined) {
    return `button returned of (display dialog "${escapedMessage}" with title "${escapedTitle}" buttons {"Decline","Approve"} default button "Approve")`;
  }

  const escapedPrompt = escapeAppleScriptString(request.declineInputPrompt);

  return `set firstResp to button returned of (display dialog "${escapedMessage}" with title "${escapedTitle}" buttons {"Decline","Approve"} default button "Approve")
if firstResp is "Approve" then
  return "APPROVED"
end if
try
  set reason to text returned of (display dialog "${escapedPrompt}" default answer "" with title "${escapedTitle}" buttons {"Cancel","Submit"} default button "Submit")
  return "DECLINED:" & reason
on error number -128
  return "DECLINED:"
end try`;
}

export function parseStdout(out: string): ApprovalResult {
  const value = out.endsWith("\r\n")
    ? out.slice(0, -2)
    : out.endsWith("\n")
      ? out.slice(0, -1)
      : out.endsWith("\r")
        ? out.slice(0, -1)
        : out;

  switch (value) {
    case "Approve":
    case "APPROVED":
      return { outcome: "approved" };
    case "Decline":
      return { outcome: "declined" };
    default:
      break;
  }

  if (value.startsWith("DECLINED:")) {
    const reason = value.slice("DECLINED:".length);
    return reason === ""
      ? { outcome: "declined" }
      : { outcome: "declined", reason };
  }

  throw new Error(`unexpected osascript output: ${out}`);
}
