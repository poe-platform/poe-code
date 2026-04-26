import { requestApproval, osascriptProvider } from "./src/index.js";

const provider = osascriptProvider({ title: "agent-human-in-loop demo" });

const simple = await requestApproval({
  message: "Simple approval — click Approve or Decline.",
  provider,
});
console.log("simple:", simple);

const withReason = await requestApproval({
  message: "Decline-with-reason — click Decline, then type or cancel.",
  declineInputPrompt: "Why are you declining?",
  provider,
});
console.log("withReason:", withReason);
