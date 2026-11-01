import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgyRecipeInputs } from "./agy-inventory-witness.js";
import { sha256 } from "./wrapper-contract.js";
import { listInventoryDirectory, readInventoryFile, readInventoryJson,
  type BoundedFile, type DirectoryListing, type InventoryBudget, type InventoryProblem,
  type InventoryRead, type NodeIdentity, type ReadReceipt } from "./inventory-io.js";

export type MaterializationDirectoryObservation = {
  path: string; observation: InventoryRead<DirectoryListing>;
};
export type StaticMaterializationState =
  | { state: "absent" | "complete"; receipts: readonly ReadReceipt[];
      directoryObservations: readonly MaterializationDirectoryObservation[] }
  | { state: "unknown"; problems: readonly InventoryProblem[];
      directoryObservations: readonly MaterializationDirectoryObservation[] };

/** Physical evidence only; this supplies no loader or normalization authority.
 * Absent observations identify missing paths and verified existing parents.
 * Any later creation must follow the current materializer: directories 0o700,
 * owned by the current user. No future inode/metadata is invented here. Existing
 * directory modes are recorded, not changed; explicit recipe file modes apply.
 */
export function inspectAgyMaterializationState(workspace: string,
  inputs: AgyRecipeInputs, budget: InventoryBudget): StaticMaterializationState {
  const problems: InventoryProblem[] = [], directoryObservations: MaterializationDirectoryObservation[] = [];
  const reported = new Set<string>();
  const problem = (code: string, path: string) => {
    const key = JSON.stringify([code, path]);
    if (!reported.has(key)) { reported.add(key); problems.push({ code, path, edge: null }); }
  };
  const unknown = (): StaticMaterializationState => ({ state: "unknown", problems, directoryObservations });
  const packet = join(workspace, ".council/native-packets");
  const canonical = (path: string) => isAbsolute(path) && resolve(path) === path &&
    !path.includes("\0") && path.split(sep).filter(Boolean).length <= 128;
  if (!canonical(workspace) || inputs.protocol !== "agy-stream" || inputs.selection.route !== "antigravity" ||
      inputs.materializations.length !== 2 || inputs.cwd !== packet) {
    problem("MATERIALIZATION_RECIPE_INVALID", workspace); return unknown();
  }
  // Snapshot the finite recipe before acquisition; never derive static membership
  // from a runtime hook prefix, filename extension, or a caller completeness flag.
  const materials = inputs.materializations.map(material => ({ ...material }));
  const agentPath = join(packet, ".agents/agents/council-packet/agent.md");
  const agent = materials.find(material => material.path === agentPath);
  const settings = materials.find(material => material.path !== agentPath);
  if (!agent || !settings || settings.path !== join(packet, ".council-profiles", settings.sha256, "session-settings.json")) {
    problem("MATERIALIZATION_STATIC_SET_INVALID", packet); return unknown();
  }
  for (const material of materials) {
    if (!canonical(material.path) || !/^[a-f0-9]{64}$/.test(material.sha256) ||
        Buffer.byteLength(material.content) > 1048576 ||
        (material.mode !== undefined && ![0o400, 0o500, 0o600].includes(material.mode)) ||
        sha256(material.content) !== material.sha256) {
      problem("MATERIALIZATION_RECIPE_INVALID", material.path);
    }
  }
  if (problems.length) return unknown();
  materials.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const beneath = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
  const parents = new Set<string>();
  for (const material of materials) {
    let child = material.path, reachedWorkspace = false;
    for (let depth = 0; depth < 128; depth++) {
      const parent = dirname(child);
      if (parent === child || !beneath(child, parent) || !beneath(parent, workspace)) {
        problem("MATERIALIZATION_PARENT_INVALID", child); return unknown();
      }
      parents.add(parent);
      if (parent === workspace) { reachedWorkspace = true; break; }
      child = parent;
    }
    if (!reachedWorkspace) { problem("MATERIALIZATION_PARENT_LIMIT", material.path); return unknown(); }
  }
  const owner = process.geteuid?.();
  if (owner === undefined) { problem("MATERIALIZATION_OWNER_UNAVAILABLE", workspace); return unknown(); }
  const receipts: ReadReceipt[] = [];
  const identities = new Map<string, NodeIdentity>(), missing = new Set<string>();
  const identityKeys = ["dev", "ino", "uid", "gid", "mode", "size", "mtimeMs", "ctimeMs", "type"] as const;
  const custodyKeys = ["dev", "ino", "uid", "gid", "mode", "type"] as const;
  const remember = (path: string, identity: NodeIdentity) => {
    const previous = identities.get(path);
    // Every observed workspace node retains full identity and membership checks.
    const keys = beneath(path, workspace) ? identityKeys : custodyKeys;
    if (previous && keys.some(key => previous[key] !== identity[key])) {
      problem("MATERIALIZATION_COMPONENT_CHANGED", path);
    }
    if (beneath(path, workspace) && identity.uid !== owner) problem("MATERIALIZATION_OWNER_INVALID", path);
    for (const absent of missing) if (beneath(path, absent)) problem("MATERIALIZATION_PRESENCE_CHANGED", absent);
    if (!previous) identities.set(path, identity);
  };
  const retain = <T>(observation: InventoryRead<T>) => {
    if (observation.state === "unknown") {
      for (const item of observation.problems) problems.push(item);
      return;
    }
    const components = observation.state === "present" ? observation.receipt.components : observation.verifiedParents;
    for (const component of components) remember(component.path, component.identity);
    if (observation.state === "present") {
      const receipt = observation.receipt;
      remember(receipt.path, receipt.before); remember(receipt.path, receipt.after);
      receipts.push(receipt);
    } else {
      // The first unverified component is absent, as are its requested descendants.
      // Retain the original full absent observation; this set is only a consistency check.
      const last = observation.verifiedParents.at(-1);
      if (!last) { problem("MATERIALIZATION_ABSENCE_UNVERIFIED", observation.path); return; }
      const first = relative(last.path, observation.path).split(sep)[0]!;
      const absent = join(last.path, first);
      missing.add(absent);
      for (const path of identities.keys()) if (beneath(path, absent)) problem("MATERIALIZATION_PRESENCE_CHANGED", absent);
    }
  };
  for (const path of [...parents].sort()) {
    const observation = listInventoryDirectory(path, budget);
    directoryObservations.push({ path, observation });
    retain(observation);
    if (path === workspace && observation.state === "absent") problem("MATERIALIZATION_WORKSPACE_ABSENT", workspace);
  }
  const files = new Map<string, InventoryRead<BoundedFile>>();
  let installed = 0;
  for (const material of materials) {
    let observation: InventoryRead<BoundedFile>;
    if (material.path === settings.path) {
      const json = readInventoryJson(material.path, budget);
      observation = json.state === "present" ? { ...json, value: json.value.file } : json;
    } else observation = readInventoryFile(material.path, 1048576, budget);
    files.set(material.path, observation); retain(observation);
    if (observation.state === "present") {
      installed++;
      if (observation.value.sha256 !== material.sha256 || !Buffer.from(observation.value.bytes).equals(Buffer.from(material.content))) {
        problem("MATERIALIZATION_CONTENT_MISMATCH", material.path);
      }
      if (material.mode !== undefined && (observation.receipt.before.mode & 0o7777) !== material.mode) {
        problem("MATERIALIZATION_MODE_INVALID", material.path);
      }
    }
  }
  const directories = new Map(directoryObservations.map(item => [item.path, item.observation]));
  const checkMembership = <T>(path: string, observation: InventoryRead<T>, type: "file" | "directory") => {
    const parent = directories.get(dirname(path));
    if (parent?.state !== "present" || observation.state === "unknown") return;
    const entry = parent.value.entries.find(item => item.name === basename(path));
    if (observation.state === "present" ? entry?.type !== type : entry !== undefined) {
      problem("MATERIALIZATION_LISTING_CHANGED", path);
    }
  };
  for (const item of directoryObservations) if (item.path !== workspace) checkMembership(item.path, item.observation, "directory");
  for (const material of materials) {
    checkMembership(material.path, files.get(material.path)!, "file");
    const parent = directories.get(dirname(material.path));
    if (parent?.state === "present") {
      for (const entry of parent.value.entries) {
        if (entry.name !== basename(material.path) || entry.type !== "file") {
          problem("MATERIALIZATION_MANAGED_LEAF_EXTRA", join(dirname(material.path), entry.name));
        }
      }
    }
  }
  if (installed === 1) problem("MATERIALIZATION_PARTIAL", packet);
  return problems.length ? unknown() : { state: installed === 0 ? "absent" : "complete", receipts, directoryObservations };
}
