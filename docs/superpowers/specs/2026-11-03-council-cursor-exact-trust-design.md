# Council issue #5: exact Cursor workspace trust identity

Status: proposed design for coordinator review; no implementation or runtime acceptance. Baseline: `3f3c3cdf63130d4aa27037c8f0d42ed5fd36dd8b`. Author assignment: Sol Max, independent design author. The coordinator owns user interaction, independent review, integration and acceptance.

The user's decision is to verify the stored path for the pinned Cursor build. Council should require both the pinned native admission predicate and an additional Council check of the marker's stored `workspacePath`. An eligible ancestor may supply trust, but its stored path must identify that exact ancestor and its canonical directory must contain the exact packet cwd. A normalized marker key is only a lookup address.

## Intent and boundaries

Prevent Council from verifying exact workspace trust for a foreign workspace that shares a lossy Cursor marker key. Preserve native direct and eligible-ancestor admission while describing precisely what Council has established from local evidence.

This design covers acquisition, identity comparison, content binding, invalidation and diagnostics. It does not create, repair, migrate or copy markers; introduce a trust flag; change settings, permissions, billing or model selection; or authorize provider execution. Marker content is untrusted data. It is never a command, a configuration overlay or a new filesystem read target.

Issue #5's effective read boundary, Deny preservation, helper-loader selection, startup effects and pre-input enforcement remain independent requirements. Issue #6's enforced included-only billing source remains a separate hard gate. Trust verification cannot satisfy either gate by implication. Existing acceptance and unrelated work remain intact.

## Evidence and its limits

The four assigned local inputs were read. The saved evidence's 21 excerpts pass their recorded byte-length and SHA-256 checks. The three named source/test files and the alias report match the input hashes recorded in that evidence. This author did not reread installed bundles or any real marker, invoke Cursor, run builds/tests or perform native qualification.

| Source | Relevant finding |
| --- | --- |
| [Pinned source report](../../../.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-cursor-trust-pinned-source-2026-11-03/report.md), lines 19–25 | Key normalization, native admission, writers, chat entry and Council's overstatement. |
| [Pinned excerpt manifest](../../../.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-cursor-trust-pinned-source-2026-11-03/evidence.json) | Exact source bytes, coordinates and hashes; anchor IDs below identify individual excerpts. |
| [Writer/root observation](../../../.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-cursor-marker-writer-root-check.md), lines 5–14 | Writer stores an uncanonicalized path; metadata-only digest and existing generic JSON reader are insufficient. |
| [Alias observation](../../../.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-cursor-trust-alias-source-check.md), lines 3–7 | A normalized-key collision is established statically; no live bypass or completed regression is claimed. |

The source contract is restricted to Cursor `2026.10.22-27dcf5f` and these recorded package bytes:

| File | SHA-256 |
| --- | --- |
| `cursor-agent` launcher | `2ccc9a8e167797641448b5e5c936f006ba137a2555f117f38c5eb76a5238a233` |
| `index.js` | `943765eeedb4fe5d4ab6d95fc839c3eaf0c070e734577409badb9dea5b0ed293` |
| `8008.index.js` | `448a22d3908279dbfd7ac47c014979643add4d73b63f2bd880dce6501abec678` |

The launcher selects adjacent `node` and `index.js`; it is not the separate SEA binary. A version string alone does not establish that these are the launched bytes. The adjacent runtime and the effective launch chain still need host qualification; this evidence does not supply their complete runtime attestation.

Static facts from the manifest:

- `normalized-marker-key`, `index.js` bytes `[7846456,7846550)`: replace non-ASCII-alphanumeric characters with hyphens, collapse runs, strip edge hyphens. Letter case survives. The transformation is non-injective.
- `trust-data-root-and-key-path`, `[3810154,3810354)`: trust storage uses nonblank `CURSOR_DATA_DIR`, retaining its original string, or the home-based default, then `projects/<normalized-workspace>/.workspace-trusted`. `CURSOR_CONFIG_DIR` is not this trust root.
- `marker-direct-reader`, `[2666459,2666593)`, and `marker-ancestor-reader`, `[2667172,2667734)`: direct existence wins first. Otherwise native code walks lexical parents, excluding home, ancestors of home and parents with fewer than three components. Its ancestor implementation enumerates project keys and catches traversal errors. Neither reader parses the marker.
- `marker-cli-writer`, `[2666593,2667022)`, and `marker-interactive-writer`, `[2668713,2669051)`: writers store raw `workspacePath` and `trustedAt`; method and source-workspace hints depend on the writer. `marker-inheritance`, `[2667022,2667172)`, uses the same existence predicate for the source and writes the target path.
- `print-admission` and `interactive-chat-admission` in `8008.index.js` connect the predicate to chat admission. These are inspected paths, not an exhaustive account of every possible native mechanism.

The stored field is internal metadata useful for Council's additional version-specific condition. Native admission does not enforce it. It is not a signed attestation, proof of historical user consent, proof of original directory inode, or evidence of effective permissions.

## Current integration points

[`provider-controls.ts`](../../../src/pilot/provider-controls.ts) lines 45–60 returns a marker path from existence checks; lines 158 and 254–257 derive the packet cwd and turn that result into verified `workspace-trust`. The current wording claims exact coverage without reading content. Its version check at lines 74–76 accepts a matching substring; the new trust contract must also require exact build identity rather than rely on that check alone.

[`control-audit.ts`](../../../src/pilot/control-audit.ts) lines 9–18 supports generic file, metadata and absence sources. Metadata hashes stat fields; generic file hashing reads the entire file. Neither is the required marker acquisition contract. Audit adoption/reuse at lines 94–116 revalidates those sources. [`provider-session.ts`](../../../src/pilot/provider-session.ts) lines 25–26 checks them before spawn; lines 374–379 deliver Cursor's prompt later. The marker witness must participate at both boundaries.

[`wrapper-contract.ts`](../../../src/pilot/wrapper-contract.ts) lines 37–49 embeds strict recipe sources, and lines 129–133 reads JSON after a separate leaf-symlink check, applying the size limit after the read. [`load.ts`](../../../src/config/load.ts) lines 53–67 demonstrates a descriptor, nonblocking/no-follow open, regular-file check, bounded read and guaranteed close. Its whole-path resolution is a useful starting pattern, not a complete parent-path race defense.

[`fix5-regressions.test.ts`](../../../test/pilot/fix5-regressions.test.ts) lines 73–89 currently creates a directory marker and expects verified trust. That remains evidence for the existence predicate only. Its containment assertions must remain independent. New regressions should import current source with acquisition mocks installed before loading, rather than inadvertently testing an old `dist` baseline.

## Approaches

| Approach | Assessment |
| --- | --- |
| Keep existence as exact identity, or merely rename the resulting fact | Cannot distinguish colliding keys; rejected. |
| Verify stored path with a pinned parser, separate native admission from identity, and bind/revalidate the consumed bytes | Selected by the user's stored-path decision. Adds a stricter Council condition without changing native trust. |
| Require a new Council receipt, rewrite native markers, or wait for a different native attestation API | Introduces new authority/state or a capability absent from the supplied evidence. Outside this decision; no automatic fallback. |

The limits, schema, conservative alias policy and witness arrangement below are design-author proposals for coordinator review, not additional user decisions.

## Two predicates and one retained gate

Use two named bootstrap facts:

- `cursor-native-trust-admission`: the acquired candidate satisfies the pinned native existence/eligibility predicate under the recorded filesystem context. Its detail must say that this is source-derived admission evidence, not an observation of a running provider.
- Existing `workspace-trust`: Council has also verified the selected marker's exact canonical binding to the intended packet cwd, directly or through an eligible ancestor.

Preserve the existing gate name so that consumers cannot silently treat a weaker renamed fact as sufficient. Both facts and every other required control remain in the conjunction. A verified native predicate with unknown identity blocks bootstrap. An unknown or unsupported build cannot produce verified trust facts.

| Acquired evidence | Native admission fact | `workspace-trust` |
| --- | --- | --- |
| Complete permitted search, no candidate | `missing` | `missing` |
| Directory marker or other native existence-only candidate | Predicate may be satisfied | `unknown` |
| Selected regular marker, exact direct binding | Predicate satisfied | `verified`, direct coverage |
| Selected regular marker, exact eligible-ancestor binding and canonical descent | Predicate satisfied | `verified`, ancestor coverage |
| Collision, malformed content or canonical mismatch | Predicate may be satisfied | `unknown` |
| Access failure or incomplete/bounded-out search | `unknown` | `unknown` |
| Unrecognized build, platform contract or marker schema | `unsupported` where applicable | `unsupported` |
| Witness drift at reuse or launch | No reusable verified result | `unknown`; reacquisition required |

Do not turn malformed evidence or a mismatch into a claim that Cursor denied access. Preserve an actual OS/configured refusal as an access-control diagnostic and stop the affected acquisition; never treat it as absence or bypass it through another reader.

## Canonical identity and candidate selection

1. Bind the requested Council workspace, registered workspace identity and actual execution cwd. Let `W` be the authorized canonical workspace and `P` the canonical existing directory at `W/.council/native-packets`. Both native cwd and `--workspace` must equal `P`. Acquisition never creates the directory. A missing or unresolved packet directory leaves exact identity unverified.
2. Capture the effective home and trust-data root from the same environment that will reach the child. Preserve nonblank environment values exactly, including surrounding spaces. For this contract require an absolute effective data root; relative roots are unsupported because inspection and launch cwd can differ. Do not expand a literal tilde in that environment value or substitute the configuration root. Bind resolved roots and their directory identities.
3. Generate candidates from the exact launch spelling: direct `P`, then nearest lexical parents in native order. Apply the pinned ancestor exclusions. Additionally require an ancestor's canonical directory to pass the home/broad-parent exclusions and to be a proper component ancestor of canonical `P`. Native direct admission is checked before ancestor exclusions; do not silently change that native fact.
4. Probe deterministic candidate locations only; do not inventory unrelated trust records. Select the first candidate the pinned native predicate would use. Preserve earlier absence witnesses. Do not skip an existing but unreadable, malformed, directory or mismatched direct marker to select a more convenient ancestor. Apply the same rule between eligible ancestors.
5. Native ancestor enumeration and Council's candidate probes are not claimed to have identical error behavior. Ancestor admission requires established readable project-root traversal and later qualification of this equivalence in the bounded supported context. If that cannot be established, report unknown instead of claiming an exact native mirror.
6. Decode only the selected permitted regular file. Its stored path must bind to that exact candidate, not merely to any ancestor or some other directory with the same key. Also require that normalizing the stored spelling yields the selected key, consistent with the inspected writer.

The canonical relation is `canonical(stored workspacePath) = canonical(selected candidate)`. For direct coverage that candidate is `P`; for ancestor coverage it is `A`, with `P` a proper canonical descendant of `A`. Compare complete paths and directory identities. Do not use string-prefix tests, case folding, Unicode folding, key equality or inode equality alone as path identity.

To avoid marker-directed filesystem probes, the first implementation accepts only an absolute stored spelling already represented in the validated candidate chain. Its canonical identity is obtained from that chain and rechecked there. An unrecognized spelling, relative path, dot-segment spelling or symlink alias remains unknown even if it might denote the same directory. This deliberately accepts fewer cases than a general arbitrary-path `realpath` call. Broader alias support needs its own allowed-path and native qualification evidence. Trusted initial workspace/root aliases may be resolved once at the declared boundary; all later checks use their recorded canonical identities and exact native lookup spelling.

Examples use owned synthetic paths only: sibling layouts `project-a` and `project/a` can have different canonical packet directories but the same normalized key. A marker storing the former cannot verify the latter. Conversely, a selected ancestor marker storing exactly `A` can verify coverage of `P` when both native eligibility and canonical descent hold. This does not authorize the whole ancestor as Council's tool/read scope.

## Marker parser and bounded acquisition

Proposed contract ID: `cursor-stored-path-2026.10.22-27dcf5f-v1`. These are explicit product bounds; exceeding a bound produces unknown/unsupported evidence, never inferred absence:

- At most 128 path components/candidates and 4,096 UTF-8 bytes per path. Bound all lookup work, including missing-candidate probes, before starting it.
- At most 16 KiB per marker, with a single 16 KiB + 1 buffer and a bounded read loop. Reject oversized stat size before reading and excess bytes even if the file grows. Require EOF within the limit.
- Fatal UTF-8 decoding and the existing duplicate-aware strict JSON decoder; no repair, coercion, trailing material or duplicate keys.
- A top-level object containing a nonempty absolute `workspacePath` and a valid writer-format `trustedAt`. Optional known fields are `trustMethod` (`cli-flag` or `inherited`) and a bounded string `sourceWorkspacePath`. Missing required fields or wrong types are malformed; unknown fields/methods are an unsupported shape for this pinned contract. Interactive markers without a method are supported.
- Never follow `sourceWorkspacePath`. Method and timestamp are shape metadata, not grants or provenance. No marker-age TTL is invented from `trustedAt`; the native evidence does not establish one.

Use a dedicated reader rather than `readStrictFile`, `readFileSync` or the generic unbounded digest path:

1. Establish an allowed canonical trust root and a validated directory chain to the generated selected leaf. Reject unexpected symlinks, escapes, wrong object types and unqualified ownership/writeability. Pin component identities; a lexical `startsWith` check is insufficient.
2. Inspect the leaf without following it, then open read-only with supported nonblocking and no-follow controls. Check the opened descriptor is a regular file before reading; a directory, FIFO, socket or device is not content evidence. Reject hard-linked markers for this initial contract. Confirm descriptor identity matches the inspected leaf.
3. Read at most the fixed limit plus one from that descriptor. Compare descriptor metadata before/after, actual byte count and final leaf/directory identities. Use precise stat identity/timestamp representations; do not truncate large identity numbers. Unexpected growth, replacement or mutation yields unknown.
4. Hash exactly the byte slice passed to the fatal decoder/parser, using that same acquisition. Do not parse one pathname read and hash a second read. Close the descriptor on every outcome, discard buffers after use and retain no payload dump.

`O_NOFOLLOW` protects the opened leaf, not every parent. Separate `lstat`/`realpath` calls and pre/post comparisons cannot prove a race-free path walk or detect every change-and-restore event. The reader contract therefore requires a qualified anchored directory-walk primitive when ancestors can be adversarially changed. Do not invent an available Node `openat` interface or add an unreviewed helper to claim that guarantee.

For the smaller initial contract, eligibility is conditional on an established private, stable namespace under the authorized user and a supported local filesystem. Check applicable ownership and absence of writes by untrusted principals; unexpected ACL/ownership behavior is unqualified. Bind known root aliases and reject descendant symlinks. This excludes concurrent hostile same-user mutation; before/after checks detect ordinary drift but do not remove that assumption. If the coordinator's threat model or actual namespace cannot satisfy it, exact acquisition is unsupported until an anchored reader and the remaining native handoff are qualified. Opening flags, regular-file behavior and the permitted root assumptions require host tests before production acceptance.

Even an anchored reader cannot make a later independent Cursor path lookup atomic with Council's check. No supported descriptor handoff or shared trust lock is exposed in this evidence. State that remaining interval explicitly; never describe revalidation as a universal filesystem containment guarantee.

## Content witness, invalidation and input delivery

Introduce one focused Cursor trust module with acquisition and revalidation using the same reader and comparison rules. It should return separate admission/identity results and an opaque structured witness, not just a marker path. Keep lookup-only compatibility, if needed, from producing verified exact trust.

The private witness binds:

- Contract/version, pinned launcher and relevant bundle hashes, and effective launch-chain identity.
- Canonical `W`/`P` commitments, the requested/registered workspace identity, effective home/data-root commitment and exact launch environment/cwd/`--workspace` binding.
- Selected candidate ordinal, direct/ancestor relation, ordered earlier absences, canonical ancestor relation and root/component identity metadata.
- Selected regular-file identity/type/ownership/mode, exact byte count, content SHA-256 and parsed-shape/comparison result.

Store no raw marker bytes, stored path, source-workspace hint or timestamp value in reports, facts or the witness. Reconstruct candidate locations from the authorized context and ordinal; do not persist the normalized key as public metadata. Internal commitments and digests are integrity bindings, not anonymization, user approval or permission grants. Existing authorized Council cwd fields remain ordinary run identity; marker-derived foreign paths never become one.

Add the typed witness to both the strict audit snapshot and recipe contracts, with an explicit snapshot/contract version change. Do not register the marker as a generic `metadata` or `file` source. Generic source revalidation must not accidentally re-read it without bounds. Audit adoption/reuse and the provider wrapper must invoke the dedicated validator in addition to existing generic source checks. An old snapshot, old recipe or old qualification without this witness cannot acquire the stronger meaning through migration defaults.

Bind the witness digest into the `workspace-trust` fact digest, audit hash and recipe hash. Today the fact digest hashes descriptive text (`provider-controls.ts:70–71`); that is insufficient for this decision. [`discovery.ts`](../../../src/pilot/discovery.ts) lines 331–341 includes recipe/fact evidence in `controlsHash`, and [`preflight.ts`](../../../src/pilot/preflight.ts) lines 9–24 binds that hash into proof identity. Preserve this chain and explicitly invalidate qualifications that lack the new trust contract. Stable witness digests exclude acquisition-clock fields; directory identity checks should not depend on unrelated directory-content timestamps changed by ordinary packet materialization.

Recompute and compare the complete witness at audit adoption, retained audit/qualification reuse, immediately before provider spawn after packet materialization/environment selection, and immediately before the first Cursor prompt write. The last check belongs before the call reservation/input mutation at `provider-session.ts:375–379`. Check positive selected evidence and earlier absences: a newly appearing higher-priority marker can change the native winning candidate. Revalidate workspace/root bindings and build bytes as well as marker content.

Any drift invalidates the old result and requires fresh acquisition and applicable review/disposition. Do not automatically rebind the old approved witness to a new marker, ancestor, path or build. If a provider has already started when drift is detected, send no prompt and use existing owned cleanup/settlement. Do not set a successful call receipt. Preserve actual lifecycle outcomes.

Staleness includes changed bytes despite equal size/restored mtime, replacement inode despite equal bytes, changed environment/root/cwd, retargeted path, a new earlier candidate, changed build, or an expired/mismatched qualification. A timestamped marker cannot identify the original directory after deletion/recreation; there is no historical inode binding in the inspected format. A fresh matching witness establishes current path correspondence only. Stronger original-object or consent provenance would require a different evidence source.

## Safe diagnostics

Use fixed reason codes and bounded structured state at acquisition and revalidation. Suggested reasons are `CURSOR_TRUST_ABSENT`, `CURSOR_TRUST_UNREADABLE`, `CURSOR_TRUST_NOT_REGULAR`, `CURSOR_TRUST_TOO_LARGE`, `CURSOR_TRUST_MALFORMED`, `CURSOR_TRUST_CONTRACT_UNSUPPORTED`, `CURSOR_TRUST_PATH_MISMATCH`, `CURSOR_TRUST_PATH_UNVERIFIED` and `CURSOR_TRUST_SOURCE_DRIFT`. These are proposed allowlist entries, not an instruction to widen generic exception capture.

Public details may state direct versus ancestor coverage, comparison outcome and a bounded reason. They must contain no marker bytes, settings object, stored/private path, normalized key, timestamp, source hint, parser excerpt, raw exception message or exception stack. Do not interpolate filenames into `unavailable` entries or place the marker in the current path-bearing generic source diagnostic. Avoid publishing integrity digests that could fingerprint private trust records. Cover CLI, journal, blocker, audit, recipe/assignment projection and provider diagnostics, not just stderr.

Preserve the existing bounded diagnostic projection and counters. A genuine EACCES/EPERM or configured denial remains a refusal classification with a safe target class, not a fabricated malformed/absent result. No alternative reader, flag or provider is a remedy for that refusal.

## Synthetic regression cases

All future regressions use owned isolated roots, synthetic home/data/config environment, and mocked command/filesystem acquisition outside those roots. Install mocks before importing the source. Never resolve or launch installed Cursor, read real trust storage or let test initialization perform a provider/account action. Assert fixtures and environments are preserved/restored. These are proposed cases, not executed checks.

| Case | Required outcome |
| --- | --- |
| No direct/eligible marker; complete search | Both facts missing; no writes. |
| Ordinary exact direct JSON marker | Direct identity verified; body absent from outputs. |
| Exact eligible ancestor, including more than one parent above `P` | Ancestor identity verified with canonical descent; no scope widening. |
| Home, ancestor-of-home or fewer-than-three-component ancestor | Excluded; no ancestor verification. A direct candidate is characterized separately. |
| Noncolliding foreign marker only | No acquired candidate; no reading unrelated marker content. |
| Canonically distinct `project-a` / `project/a` packet paths sharing a key | Native predicate may pass; foreign stored path leaves exact trust unknown. Test both directions. |
| Existing directory marker, matching the frozen regression | Native existence characterization retained; exact identity unknown, containment still unverified. |
| Invalid selected direct marker plus a valid farther ancestor | Unknown; no skipping the native winning candidate. Repeat between ancestors. |
| Marker stores a different ancestor or a string-prefix sibling | Unknown even if that path would be trusted elsewhere. |
| Relative, empty, NUL-containing, overlong or unrecognized alias path | Unknown/unsupported; no marker-directed filesystem probe. |
| Invalid UTF-8, truncated JSON, duplicate path keys, array/null, wrong types, missing fields | Unknown; no JSON repair or raw parse diagnostic. |
| Interactive shape; inherited target shape | Exact target/ancestor comparison governs; provenance hints are neither followed nor accepted as consent. |
| Unknown fields/method, different version or changed launcher/bundle | Unsupported contract; old qualification unusable. |
| Exact size limit, one byte over, growth during read | At-limit valid EOF may pass; excess/growth fails with bounded allocation/read count. |
| FIFO/device/socket/directory or leaf symlink, including replacement between inspect/open | No content read from a special object; unknown; descriptors close. Use controlled fixtures/mocks without hanging. |
| Symlinked intermediate directory, root escape, changed parent/root binding | Unknown/unsupported, including canonical ancestry through a broad/home alias. |
| Stored spelling outside the allowed candidate chain | Compare/reject without probing the foreign target. |
| Ordinary packet materialization changes directory mtime only | Does not invalidate stable directory identity; independent controls still apply. |
| Body changes with same size and restored mtime | Content digest changes; audit/reuse/pre-spawn/pre-input checks reject. |
| File replaced with identical bytes; higher-priority absent marker appears | Old object/candidate witness invalidates. |
| Changed HOME/data root, whitespace-preserving data root, blank override | Match pinned root selection exactly; changed context invalidates. Relative override is unsupported. |
| EACCES/EPERM, incomplete search or component/candidate bound reached | Unknown/refusal as appropriate, never missing; no fallback reader. |
| Missing packet directory, drift after spawn and before prompt | No reader-created directory; no prompt; owned cleanup and accurate zero-input state. |
| Every failed and successful acquisition | Marker bytes/metadata unchanged; descriptor closure and bounded diagnostics verified. |
| Valid trust with missing containment/helper controls or included-only billing | Existing independent #5/#6 gates still block; no provider call. |
| Private sentinels in every marker field and filesystem exception | No sentinel/path/key in facts, snapshots, public projections, CLI, journals or diagnostic text. |

The original collision RED should first demonstrate that frozen Council source verifies existence-only evidence for the second workspace; this is predicted by source, not an observed failure. The repaired expectation is no verified exact identity without the matching stored-path witness. Retain absent, eligible-ancestor and foreign controls rather than replacing them with collision-only coverage.

## Qualification and acceptance

Static evidence establishes the lossy key, inspected native predicate, writer fields and Council integration defect. It supports this additional Council policy. Synthetic regressions can establish the parser, reader bounds, comparison, privacy and invalidation behavior under their declared filesystem model. Neither establishes native containment or a working production route.

Later coordinator-owned host qualification must bind actual launcher/runtime/bundle bytes, platform filesystem controls and ownership/ACL assumptions, exact environment/cwd/workspace selection, direct and eligible-ancestor behavior, and collision refusal by Council. Use disposable synthetic storage; test native behavior through a supported, already authorized mechanism. Establish that it cannot reach inference or unrelated startup effects before using it. A public provider-free trust dry run or an atomic trust handoff is not established by the supplied evidence; absence of such a qualified mechanism is a named remaining capability gap, not permission to use print mode as a probe.

Production admission still requires the complete independent #5 controls, #6 billing enforcement, exact host/model/action qualification, pre-input checks and settled lifecycle evidence. A successful parser test, source excerpt, version/help output or exit zero cannot substitute for those receipts. No current unknown is upgraded by this document.

The coordinator obtains the fresh independent cross-family design review and resolves findings before acceptance. This author's consistency check is not that review. Any later implementation plan must preserve the contract's conservative failure states and identify the actual supported path-walk/handoff guarantees rather than assuming them.

## Explicit assumptions and remaining choices

- The user's selected policy is current stored-path correspondence for this pinned build, including eligible ancestor coverage; it does not authenticate historical consent or original directory identity.
- The initial accepted filesystem model is a supported local macOS filesystem with stable, appropriately controlled namespace. Concurrent hostile same-user mutation and remote/novel filesystem semantics are excluded unless a stronger contract is separately qualified. If this assumption is unacceptable, the affected route remains unsupported.
- Existing packet directories and canonical workspace identity must be established by the surrounding authorized workflow; acquisition itself is read-only. Unrecognized aliases deliberately reduce availability.
- The byte/path/candidate limits, known-field schema and hard-link rejection are proposed conservative implementation choices. Compatibility failures remain visible instead of weakening identity checks.
- No complete native marker provenance, atomic Council-to-Cursor trust handoff, or provider-free native trust qualification mechanism is evidenced here. These limitations cannot be solved by timestamps, repeated polling or a caller-authored receipt.
- The coordinator owns any product decision to support additional spellings, schemas, builds or stronger original-object provenance. This document grants no persistent trust or permission changes.

Design-only rollback is removal/revision of this proposed document by its owner. A future implementation rollback must not restore existence-only evidence as verified exact identity; the safe fallback is an unverified trust gate, with all independent gates retained.
