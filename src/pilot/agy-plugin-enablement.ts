export type SourceDecision = boolean | "unknown";

/** Absent means a verified missing/nil Enabled pointer, never an unread registry. */
export type RegistryEnabledOverride = boolean | "absent" | "unknown";

export interface AgyPluginEnablementInputs {
  readonly manifestDisabled: SourceDecision;
  readonly builtin: SourceDecision;
  readonly mcpVariablesPresent: SourceDecision;
  readonly sidecarFeatureEnabled: SourceDecision;
  readonly sidecarSetupPresent: SourceDecision;
  readonly killSwitch: SourceDecision;
  readonly registryOverride: RegistryEnabledOverride;
}

export type AgyPluginEnablement = "enabled" | "disabled" | "unknown";

const not = (value: SourceDecision): SourceDecision => value === "unknown" ? "unknown" : !value;
const or = (left: SourceDecision, right: SourceDecision): SourceDecision => {
  if (left === true || right === true) return true;
  return left === false && right === false ? false : "unknown";
};
const and = (left: SourceDecision, right: SourceDecision): SourceDecision => {
  if (left === false || right === false) return false;
  return left === true && right === true ? true : "unknown";
};

/** Calculate the reviewed successful-conversion rule from supplied observations.
 * This result carries no source-completeness, permission or launch authority.
 * Acquisition and binding observations to that rule belong to the caller. */
export function evaluateAgyPluginEnablement(input: AgyPluginEnablementInputs): AgyPluginEnablement {
  const setup = or(input.mcpVariablesPresent, and(input.sidecarFeatureEnabled, input.sidecarSetupPresent));
  const base = or(input.manifestDisabled, and(not(input.builtin), setup));
  const overrideDisabled = input.registryOverride === "absent"
    ? base
    : typeof input.registryOverride === "boolean" ? not(input.registryOverride) : "unknown";
  const disabled = or(input.killSwitch, overrideDisabled);
  return disabled === "unknown" ? "unknown" : disabled ? "disabled" : "enabled";
}
