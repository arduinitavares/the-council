const imported = await import('../../prototype/council-walkthroughs.js');
const protoWalkthroughs = imported.default || globalThis.CouncilWalkthroughs || imported;

export const WALKTHROUGHS = protoWalkthroughs.WALKTHROUGHS;

export function getWalkthrough(id) {
  const wt = WALKTHROUGHS.find((w) => w.id === id);
  if (!wt) {
    throw new Error(`Walkthrough with id "${id}" not found.`);
  }
  return wt;
}
