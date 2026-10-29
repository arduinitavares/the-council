import type { PilotConfig } from "../../src/pilot/config.js";
export const incidentRoster: PilotConfig = {
  version: 1,
  reviewers: {
    openai: { route: "codex", model: "gpt-6.1-sol", effort: "max" },
    gemini: {
      route: "antigravity",
      model: "gemini-4-argon-high",
      effort: "high",
    },
    xai: {
      route: "cursor",
      model: "grok-4.7-xhigh",
      effort: "xhigh",
      effortEncoding: "model",
    },
  },
  judge: { route: "codex", model: "gpt-6-astra", effort: "max" },
};

// Synthetic policy fixture copied from the canonical policy table, no credentials.
export const policyTable = `| Route | Exact model | Effort |
| --- | --- | --- |
| Codex | \`gpt-6.1-sol\` | \`max\` |
| Codex | \`gpt-6-astra\` | \`max\` |
| AGY | \`gemini-4-argon-high\` | \`high\` |
| Cursor, pending host/action qualification | \`grok-4.7-xhigh\` | Matching \`xhigh\` |
`;
