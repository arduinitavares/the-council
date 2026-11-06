import { expect, it } from "vitest";
import {
  evaluateAgyPluginEnablement,
  type AgyPluginEnablement,
  type AgyPluginEnablementInputs,
  type RegistryEnabledOverride,
  type SourceDecision,
} from "../../src/pilot/agy-plugin-enablement.js";

const unknownInputs: AgyPluginEnablementInputs = {
  manifestDisabled: "unknown",
  builtin: "unknown",
  mcpVariablesPresent: "unknown",
  sidecarFeatureEnabled: "unknown",
  sidecarSetupPresent: "unknown",
  killSwitch: "unknown",
  registryOverride: "unknown",
};

// Break caught: unresolved inputs mask a decisive kill-switch.
it("disables with a true kill-switch even when every other input is unknown", () => {
  expect(evaluateAgyPluginEnablement({ ...unknownInputs, killSwitch: true })).toBe("disabled");
});

// Break caught: ignoring explicit false or letting true bypass the kill-switch.
it.each([
  { registryOverride: false, killSwitch: "unknown", want: "disabled" },
  { registryOverride: false, killSwitch: false, want: "disabled" },
  { registryOverride: true, killSwitch: false, want: "enabled" },
  { registryOverride: true, killSwitch: true, want: "disabled" },
  { registryOverride: true, killSwitch: "unknown", want: "unknown" },
] as const)("resolves explicit override $registryOverride with kill-switch $killSwitch", ({ want, ...inputs }) => {
  expect(evaluateAgyPluginEnablement({ ...unknownInputs, ...inputs })).toBe(want);
});

// Break caught: manifest/setup defeat an override, absence loses decisive
// evidence, builtin setup is treated as non-builtin, or unknown means absent.
const regressions: { name: string; input: Partial<AgyPluginEnablementInputs>; want: AgyPluginEnablement }[] = [
  { name: "true override defeats manifest and setup", input: { registryOverride: true, killSwitch: false, manifestDisabled: true, builtin: false, mcpVariablesPresent: true, sidecarFeatureEnabled: true, sidecarSetupPresent: true }, want: "enabled" },
  { name: "absent override and true manifest settle unknown kill-switch", input: { registryOverride: "absent", manifestDisabled: true }, want: "disabled" },
  { name: "absent override and MCP variables settle unknown kill-switch", input: { registryOverride: "absent", builtin: false, mcpVariablesPresent: true }, want: "disabled" },
  { name: "builtin ignores unresolved setup", input: { registryOverride: "absent", killSwitch: false, manifestDisabled: false, builtin: true }, want: "enabled" },
  { name: "builtin still respects manifest disabled", input: { registryOverride: "absent", killSwitch: false, manifestDisabled: true, builtin: true }, want: "disabled" },
  { name: "false feature gate ignores unknown sidecar setup", input: { registryOverride: "absent", killSwitch: false, manifestDisabled: false, builtin: false, mcpVariablesPresent: false, sidecarFeatureEnabled: false }, want: "enabled" },
  { name: "empty sidecar setup ignores unknown feature gate", input: { registryOverride: "absent", killSwitch: false, manifestDisabled: false, builtin: false, mcpVariablesPresent: false, sidecarSetupPresent: false }, want: "enabled" },
  { name: "gated sidecar setup disables non-builtin", input: { registryOverride: "absent", killSwitch: false, manifestDisabled: false, builtin: false, mcpVariablesPresent: false, sidecarFeatureEnabled: true, sidecarSetupPresent: true }, want: "disabled" },
  { name: "sidecar setup needs unresolved feature gate", input: { registryOverride: "absent", killSwitch: false, manifestDisabled: false, builtin: false, mcpVariablesPresent: false, sidecarSetupPresent: true }, want: "unknown" },
  { name: "MCP setup needs unresolved builtin category", input: { registryOverride: "absent", killSwitch: false, manifestDisabled: false, mcpVariablesPresent: true }, want: "unknown" },
  { name: "unknown registry refuses manifest-only disabled", input: { killSwitch: false, manifestDisabled: true }, want: "unknown" },
  { name: "unknown registry refuses builtin-only enabled", input: { killSwitch: false, manifestDisabled: false, builtin: true }, want: "unknown" },
];

it.each(regressions)("$name", ({ input, want }) => {
  expect(evaluateAgyPluginEnablement({ ...unknownInputs, ...input })).toBe(want);
});

const sourceKeys = ["manifestDisabled", "builtin", "mcpVariablesPresent", "sidecarFeatureEnabled", "sidecarSetupPresent", "killSwitch"] as const;

function assignments(decisions: readonly SourceDecision[], overrides: readonly RegistryEnabledOverride[]): AgyPluginEnablementInputs[] {
  let rows = [{ ...unknownInputs }];
  for (const key of sourceKeys) {
    rows = rows.flatMap(row => decisions.map(value => ({ ...row, [key]: value })));
  }
  return rows.flatMap(row => overrides.map(registryOverride => ({ ...row, registryOverride })));
}

const completeInputs = assignments([false, true], [false, true, "absent"]);

// Independent oracle: enumerate fully known worlds, then collect their literal
// branch outcomes. No three-valued operators or production helpers are reused.
function completeOutcome(input: AgyPluginEnablementInputs): "enabled" | "disabled" {
  if (input.killSwitch === true) return "disabled";
  if (input.registryOverride === false) return "disabled";
  if (input.registryOverride === true) return "enabled";
  if (input.manifestDisabled === true) return "disabled";
  if (input.builtin === true) return "enabled";
  if (input.mcpVariablesPresent === true) return "disabled";
  if (input.sidecarFeatureEnabled === true && input.sidecarSetupPresent === true) return "disabled";
  return "enabled";
}

function finiteCompletionOracle(partial: AgyPluginEnablementInputs): AgyPluginEnablement {
  const outcomes = new Set(completeInputs
    .filter(candidate => sourceKeys.every(key => partial[key] === "unknown" || partial[key] === candidate[key])
      && (partial.registryOverride === "unknown" || partial.registryOverride === candidate.registryOverride))
    .map(completeOutcome));
  if (outcomes.size !== 1) return "unknown";
  return outcomes.has("disabled") ? "disabled" : "enabled";
}

// Break caught: any wrong source-formula branch for a fully known observation.
it("matches all 192 known boolean and absent-override combinations", () => {
  expect(completeInputs).toHaveLength(192);
  for (const input of completeInputs) {
    expect(evaluateAgyPluginEnablement(input), JSON.stringify(input)).toBe(completeOutcome(input));
  }
});

// Break caught: either guesses through unknown observations or misses a result
// that is invariant over every permitted completion (2,916 partial assignments).
it("matches finite completions for every partial assignment without mutating inputs", () => {
  const partials = assignments([false, true, "unknown"], [false, true, "absent", "unknown"]);
  expect(partials).toHaveLength(2916);
  for (const partial of partials) {
    const input = Object.freeze(partial);
    expect(evaluateAgyPluginEnablement(input), JSON.stringify(input)).toBe(finiteCompletionOracle(input));
  }
});
