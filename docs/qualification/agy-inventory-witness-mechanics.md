# Gemini inventory witness mechanics

This increment adds bounded filesystem observations, a canonical inventory witness, immutable project storage, and exact static-file observations. It does not yet integrate those helpers into production startup acquisition, audit adoption, reuse, or retained-recipe launch. Issue #3 remains open.

## Reproduced defect

The unchanged-source native fixture first established authenticated audit reuse. It then changed a plugin-root entry from a regular file to a directory with the same name and restored the observed root metadata. All existing audit-source digests remained equal, but reuse incorrectly remained verified. The reproduction uses a fake home, inert files and a native-host fixture. It executes no real AGY plugin, hook or provider.

The new helpers provide the mechanics needed to bind a complete inventory. They do not establish which inputs the installed AGY loader consumes.

## Implemented boundaries

- `inventory-io.ts` provides bounded no-follow file, JSON and complete directory observations. Absence requires verified parents. Explicit path, entry, byte and depth limits remain in force.
- `agy-inventory-witness.ts` binds ordered records, edges, source projections, qualified root listings, absences, executable/loader evidence, recipe inputs and context. Canonical home and raw `HOME` are separate values.
- `agy-inventory-store.ts` stores only a witness bound to the canonical requesting workspace. It verifies private file custody before payload reads, refuses relocated artifacts and changed leaf identities, and never repairs an interrupted or unequal collision.
- `agy-materialization-state.ts` checks the exact generated agent/settings pair and retains all eight affected parent observations. It distinguishes missing generated files beneath an existing workspace from a missing workspace. Parent traversal is bounded. Ordinary siblings remain visible. Extra managed-leaf entries cause `unknown`.

The hash preimages are:

```text
F = sha256(canonicalJson(core))
W = sha256(canonicalJson({ version: 1, fingerprint: F, core }) + "\n")
Q = sha256(canonicalJson({ recipeInputs, inventoryFingerprint: F, inventoryContext }))
```

The immutable file is `<workspace>/.council/control-audits/inventories/<F>.json`. Encoding or storing a synthetic core does not grant audit, effect, loader or native authority. Physical parent listings do not automatically become semantic loader roots. Creation requirements remain separate from observed absence; no future inode or creation grant is fabricated.

## Loader evidence and unresolved rules

The pinned [AGY changelog](https://github.com/google-antigravity/antigravity-cli/blob/841f45db2226ce15f5d1f52c580e35181e74ff68/CHANGELOG.md) documents persistent enablement in `config.json`, seeded once from manifests (1.1.11). It also documents a separate initially-disabled condition for directly placed plugins requiring MCP configuration variables (1.2.11). Markdown-agent inheritance has its own switch (1.1.14); empty plugin arrays alone do not prove environmental startup suppression.

Installed AGY 1.4.12 was examined as executable SHA-256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3`. Embedded documentation conflicts on path resolution. Complete source selection/order/filter/agent rules, enablement initialization/error branches, parser membership, and exact profile/PATH/bookkeeping participation remain unresolved. No version allowlist, guessed union of competing resolvers, wildcard profile exemption or plugin disabling is introduced.

## Verification checkpoint

At code revision `54a4dafca0bf64f131b398fe99600812143e37c3`:

| Check | Result |
| --- | --- |
| Build | Passed |
| Typecheck | Passed |
| Nine-file focused suite with `--no-file-parallelism` | 603 passed |
| One default `npm test` run | 62 failed, 1,444 passed; 12 failed and 60 passed files |
| Owned full-suite lifecycle | Normal exit 1; observed processes and groups settled |

The default full-suite run was bounded to 600 seconds and finished in 329.929 seconds. Twenty-seven failures occurred in the newly added IO/store/materialization tests. Other failures included fixture timeouts and fixture `ORCA_GUIDE_UNAVAILABLE` errors. Those are not evidence of a failure in the real Orca runtime. Their common cause is not established, and they are not dismissed as issue #8.

A separate deterministic probe confirmed that creating an unrelated sibling above the selected source causes file, JSON and directory observations to return `INVENTORY_UNSTABLE`, although the selected bytes, inode and membership remain unchanged. This is an open mechanics concern for whole-increment review. The exact verification record is in `agy-inventory-witness-mechanics.json`. No merge readiness or parallel stability is claimed at this checkpoint.

Task reviews used Sol Max authors, fresh Astra Ultra and Argon high reviewers through Orca, and coordinator verification of material claims. Their correction rounds covered custody before reads, workspace relocation, written-inode continuity, raw `HOME`, agent-flag binding, parent-walk termination, provider-route consistency and missing-workspace handling. Whole-increment review remains pending.

Deferred observations remain explicit: standalone recipe/path validation consistency, selected-agent/static-file consistency, intended settings JSON/depth validation before materialization, and a machine-readable creation contract before production integration. Complete issue #3 acceptance still requires qualified live reconstruction and drift/reuse integration. Fixtures and development reviews cannot substitute for that work.
