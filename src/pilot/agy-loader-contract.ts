import type { InventoryProblem } from "./inventory-io.js";

/** Identity selection for the accepted conditional source subset only. Root
 * locations/order, inherited enablement, and filesystem/platform custody keep
 * their reviewed qualifications; a digest match does not prove those conditions
 * hold for current inputs. Runner dispatch, complete graph semantics, activity,
 * and native authority remain unresolved. This is not a LoaderBinding. */
export type AgySourceRuleSelection =
  | { state: "pinned-subset"; ruleSet: "agy-34423fc9-source-subset-v1"; executable: { path: string; sha256: string } }
  | { state: "unknown"; problem: InventoryProblem };

export function selectAgySourceRules(executable: { path: string; sha256: string }): AgySourceRuleSelection {
  if (executable.sha256 === "34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3") {
    return { state: "pinned-subset", ruleSet: "agy-34423fc9-source-subset-v1", executable };
  }
  return { state: "unknown", problem: { code: "AGY_SOURCE_CONTRACT_UNREVIEWED", path: executable.path, edge: null } };
}
