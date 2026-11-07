# Council issue #3: complete AGY startup inventory proposal

This is the Task 1 author proposal, corrected in SDD fix round 1/5 on 2026-11-01. It is available for scoped coordinator review, but it is **not implementation-ready**. Version-bound primary loader evidence remains incomplete and internally inconsistent. Materialization compatibility remains conditional on that evidence. No approach has user design approval. The recommendation below is the author's recommendation only.

The frozen input design SHA-256 is `176f0d49becd0d2264f1960fc905bcb643c8f03115cf44dd9ffd020d042a24c3`. This correction changes documents only. `fix-report.md` records the finding dispositions, actual document checks, readable diff, and remaining blockers.

The target is the complete posted Agent Brief, comment `IC_kwDOVcK9P88AAAABhmkV7Q`, for issue #3. The selected baseline is `9aff16ceb97e9420ab346552c04405c38d2ffde8`, branch `dev/issue-1-first-use-reviewed`. References `[S1]` through `[E6]` resolve to precise local evidence in `source-map.md`.

## Outcome and boundaries

Before an audit can support approval, acquisition must account for every hook/plugin source selected by a qualified AGY loader contract. Installation, enablement, inventory completeness, effect disposition, and runtime qualification are separate facts. A recognized Orca hook boundary cannot establish complete plugin discovery.

The design covers installed directories, global and project discovery, manifests, inherited declarations, enablement, selected-agent configuration, active hooks, source drift, and reuse. It includes metadata for disabled plugins. It does not enable plugins, change provider settings, establish trust, adopt an audit, approve effects, or qualify a live provider.

This authoring entry performs no implementation, test execution, process inspection, network request, plugin execution, or additional provider launch. The source checkout and existing dirty work are read-only. Only `design.md` and `source-map.md` are authored. The coordinator owns independent reviews, artifact freezing, integration, and acceptance. Task 2 is not executed here.

The task's stated canonical policy exists at `/Users/aaat/.agents/policies/model-policy.md`. Its shared instruction version matches `cross-host-2026-10-28-v1`. It was read first. No repository `AGENTS.md` was found at the checkout root or in the bounded source/test instruction-file search. The supplied AGENTS instructions govern this entry. No instruction file was created or changed.

## Existing interfaces and behavior

These interfaces already exist. Names introduced in later sections are proposals.

| Existing boundary | Actual behavior and design consequence |
| --- | --- |
| `ProviderControlSource` / `inspectProviderControls(selection, version, workspace, billing, command?)` | Returns `ProviderControlEvidence` with bootstrap/effective observations, facts, optional audit, and optional recipe. `workspace` is the requesting workspace. Keep this public signature. [S1] |
| `ProviderRecipe` | Contains `cwd`, executable, argv, version, selection, sources, facts, optional agent/agentDefinition, materializations, and optional `agyHookShell`. Its strict schema does not currently have an inventory field. [S3] |
| Actual AGY recipe | Uses `<workspace>/.council/native-packets` as `cwd`, selects `council-packet`, and adds that packet directory once with `--add-dir`. It plans an agent and session settings without writing them during inspection. [S1, T1] |
| Current AGY acquisition | Reads global legacy settings and five fixed hook files. It scans only `~/.gemini/antigravity-cli/plugins` and `<workspace>/.agents/plugins` for child `hooks.json`. It does not track those inventory roots as metadata or explicit absences. [S1] |
| Current hook extraction | Recurses through object values, ignores subtrees with `enabled:false`, hashes command/prompt objects as `startup-hook:` effects, and applies generic executable/closure guards. This is not plugin enablement resolution or a loader schema validator. [S1] |
| `AuditSource` / `currentSourceDigest()` | Kinds are `file`, `metadata`, and `absent`. Files use SHA-256 of bytes. Metadata hashes mode/dev/ino/size/mtime/symlink status. Missing paths return `null`. An appeared `absent` source returns `unexpected-source`. Metadata does not hash directory entries. [S2] |
| `AuditSnapshot` | Strict version 1 contains workspace, route, providerVersion, contract, executable, sources, ordering, effects, unavailable, and recipeHash. Ordering denotes effective loader precedence. `auditHash()` binds all these fields. [S2] |
| `prepareProviderAudit()` | Performs inspection and saves a project-owned snapshot. Inspection itself is read-only. Preparation grants no effects. [S1, S2] |
| `adoptAuditSnapshot()` / `acquiredAuditDisposition()` | Check source digests and authenticated native authority. Reuse requires all effects dispositioned and no unavailable entries. Adoption can retain an incomplete snapshot, but it cannot make its unavailable inventory verified. Preserve that distinction. [S2, T2] |
| Fact promotion | Non-verified startup facts can be promoted through authenticated disposition. A startup fact already marked verified bypasses this promotion loop. Completeness must therefore guard the initial state as well as disposition. [S1] |
| Existing launch boundary | Checks bootstrap facts and source digests before materialization. It creates the packet directories, materializes exact bytes, binds the selected agent, and spawns at `recipe.cwd`. Effective AGY initialization remains a separate gate. [S6] |
| Discovery fingerprint | `controlsHash` includes recipes, materializations, sources, and facts, with fact timestamps removed. Changes must reach this existing chain deterministically. [S5] |

The existing AGY `provider-startup-source-contract` fact recognizes the string `1.4.12`. That is current code behavior, not proof that the complete loader contract was established. This proposal adds no version allowlist and does not restore retired behavior. Contract confidence must come from source evidence tied to the actual loader, independently of public help syntax.

## Evidence classes and unresolved behavior

### Accepted acquisition reproduction

The retained portable diagnostic exercised the real, unchanged `inspectProviderControls()` with isolated fake HOME values and a fake executable that only emitted AGY help. All three commands produced one failing current-store case and one passing recognized-root control. The failing assertions were missing current-store `hooks.json`, missing `plugin.json`, and an incorrectly verified `startup-hooks-and-plugins` fact. [E1, E2]

The fake enablement input and manifest `hooks` property were synthetic fixture data. They do not prove runtime enablement, manifest indirection, discovery order, or the production loader contract. The accepted reproduction establishes a concrete acquisition omission. It is not GREEN, a production correction, or operational acceptance.

### Version-bound embedded documentation

The retained extracts identify AGY 1.4.12 executable SHA-256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3`. They are embedded documentation and schema strings, not executed loader traces. [E4, E5]

They describe global `.gemini/config`, ancestor customization discovery, plugin root `hooks.json`, and configuration-driven enablement. They describe `config.json` plugin entries keyed by directory name, preference precedence over manifest defaults, and disabled plugins contributing no bundled customizations. They do not independently prove every registry location or selected-agent override.

The embedded hook-layout text distinguishes native runtime loading from installation staging. It says native runtime discovery reads plugin-root `hooks.json`. It describes staging `hooks/hooks.json` for imported extension formats during installation. Inventory must observe installed outputs. It must not run an installer or treat nested packaging files as an additional active native hook source without evidence.

### Moving documentation and prior observations

The earlier discovery report records eight installed directories and CLI-reported six enabled/two disabled plugins. Those are retained observations, not facts reacquired in this author entry. They establish neither hook execution nor complete startup discovery. [E3]

The retained current-documentation comparison describes declaring-folder-relative resolution, repository fallback, no tilde expansion, and a project personal-customization directory. Embedded JSON documentation gives a similar introductory resolution rule, then later specifies repository-relative paths and home expansion. This is a direct conflict, including within the embedded text. [E5, E6]

Moving authoring documentation describes manifest precedence involving `.antigravity-plugin/plugin.json`. Embedded native-plugin text names that marker and `.gemini-plugin/plugin.json`, but does not settle their complete precedence. Do not promote this list into an exact 1.4.12 manifest-selection algorithm.

No documentation was fetched here. These retained sources remain separate evidence classes. Model agreement, a matching version string, and an empty tool list cannot settle the conflict.

## Two complete approaches

Both approaches must cover the whole Agent Brief. A current-store-only scan is not a complete alternative.

| Dimension | Approach A: static contract-bound graph | Approach B: authoritative loader inventory report |
| --- | --- | --- |
| Discovery | Implement a read-only inventory adapter from a qualified, version-bound loader specification. Start from the actual recipe and construct the complete source graph. | Acquire a supported non-inference report from the exact loader, if such a report exists and its safety is qualified. Require all resolved roots, declaration edges, selected-agent inputs, order, enablement origins, and source locations. |
| Installation and effects | Read bounded metadata and source files. Resolve active effects using the qualified contract. Preserve disabled metadata. | Validate the report schema and completeness, then read and fingerprint every reported source plus candidate roots and absence probes. Preserve disabled metadata and distinguish reported activation from execution. |
| Reuse | Persist an immutable inventory witness during audit preparation. Recompute the graph at adoption, reuse, and launch. | Persist a witness binding the report, executable, input files, roots, order, and contract. Refresh the report and source graph before reuse. A saved report alone is insufficient. |
| Failure handling | Any unsupported resolution rule, omitted source class, bounds failure, or unreadable input gives unknown inventory. | A missing command, incomplete report, unsafe query, unqualified side effects, or report/static disagreement gives unknown inventory. |
| Benefits | Deterministic offline fixtures. Precise file custody. No new provider command needed for ordinary inventory. Compatible with source-bound audits. | Can avoid reproducing hidden loader precedence when a complete report exposes it. Can cross-check static interpretations. |
| Costs | Requires primary semantic evidence and maintenance when the loader changes. Needs explicit graph revalidation and a project audit artifact. | Depends on a proven report capability and safe command behavior. Reporting can omit controlling inputs or change startup state. A plugin list alone cannot fill these gaps. |
| Present readiness | Blocked by primary contract gaps listed below. Architecture can be reviewed now. | No retained evidence establishes a complete supported report. Do not invent an invocation or execute one under this assignment. |

**Author recommendation: Approach A.** Use a bounded static graph and a separate inventory witness. An optional provider list may later cross-check installation/enablement, after separate authorization and capability evidence. It must not become the source of completeness by implication.

This recommendation preserves ordinary file digest meanings and the strict snapshot schema. Its cost is an explicit preparation artifact and extra static validation. The coordinator must review that workflow change before user design approval. Approach B remains viable only if a complete, safe, version-bound report is demonstrated.

## Proposed source graph and contract

Every module, type, function, field, artifact format, reason code, and additional limit in the rest of this document is a **proposal**. None is asserted to exist or to be approved.

Proposed module `src/pilot/agy-startup-inventory.ts` owns loader inventory and revalidation. It does not acquire authority or execute providers. Existing generic audit authority remains in `control-audit.ts`. Existing known-hook custody remains in `agy-hook-shell.ts`.

| Proposed type or function | Proposed responsibility and fields |
| --- | --- |
| `AgyLoaderContract` | `id`, `semanticsDigest`, `evidenceDigests`, `loaderIdentity`, and declarative discovery/enablement/schema rules. It records qualified behavior and unresolved rules separately. No boolean supplied by a caller can qualify it. |
| `AgyInventoryContext` | `requestingWorkspace`, `executionCwd`, `home`, `repositoryBoundary`, `selectedAgent`, `agentDefinition`, `argvInputs`, `environmentInputs`, and `plannedMaterializations`. Obtain these from the actual recipe and relevant inherited inputs. |
| `AgyInventoryRecord` | `path`, `role`, `discoveryEdges`, `presence`, `enablement`, `enablementOrigin`, `selection`, `digest`, and `problems`. Presence and enablement remain independent. |
| `AgyInventoryResult` | `context`, `contract`, `records`, `orderedEdges`, `rootListings`, `absenceProbes`, `activeDescriptors`, `candidateDescriptors`, `sources`, `effects`, `unavailable`, and `fingerprint`. |
| `AgyInventoryWitness` | A versioned immutable serialization of normalized context, qualified contract identity, graph, file digests, root listings, absence probes, selected-agent decisions, exact recipe inputs, and conditional materialization rules. Physical phase observations do not enter its immutable content. |
| `acquireAgyStartupInventory(context, contract)` | Perform bounded static acquisition. Produce the result even when parts are unknown. No file writes, provider invocation, plugin execution, or inferred authority. |
| `persistAgyInventoryWitness(result)` | Write only an immutable, content-addressed project audit artifact during explicit audit preparation. Validate directory custody and existing bytes. Never overwrite a prior witness. |
| `validateAgyInventoryWitness(boundary)` | Derive live host context, reconstruct the current recipe and inventory, verify witness and recipeHash binding, and check exact physical custody. The boundary is an existing snapshot or recipe. Infer physical state from verified files. No caller-supplied phase grants compatibility. |

No new `AuditSource.kind`, `AuditSnapshot` field, or public `ProviderControlEvidence` field is proposed. New serialized witness fields belong to the proposed witness format, not the existing snapshot schema. The selected source set must be independent of whether a plugin is enabled. Effect extraction uses a separate selection pass.

### Input and root map

This is a coverage map, not an asserted search order. Qualified loader evidence must turn each candidate into an included source, an excluded source with a reason, or an unresolved class that blocks completeness.

| Input class | Evidence and proposed treatment |
| --- | --- |
| Requesting workspace versus execution cwd | Preserve the workspace for audit ownership. Discover loader inputs from `recipe.cwd`, currently `<workspace>/.council/native-packets`. Include the packet-level customization directory and each eligible ancestor through the qualified repository/workspace boundary. Do not stop at the requesting workspace merely because the API calls it workspace. [S1, S6] |
| Repository boundary | Record the relevant `.git` presence and boundary decision. Worktree `.git` files, nested repositories, a missing packet directory, and no-repository fallback need primary rules. Existing `gitRoot()` behavior for other routes is not AGY evidence. |
| Ancestor customization roots | Embedded documentation names `.agents`, `.agent`, `_agents`, and `_agent` from cwd toward repository root. Their support, inter-root ordering, and selected-agent restrictions need qualification. Probe relevant root absences as well as existing roots. [E4] |
| Global discovery and installed store | Include qualified global discovery under `~/.gemini/config`, including the observed `plugins` store. Fingerprint the installed root, its direct entries, plugin directories, and relevant metadata. Do not recursively scan unrelated home data. [E3, E4] |
| Historical Council acquisition locations | The five hook paths and older plugin roots are candidate locations only. Qualified current loader rules determine input membership. An excluded location contributes neither active effects nor an acquisition failure because old Council code scanned it. Preserve historical evidence unchanged. If participation is unresolved, record the contract gap rather than guessing from the path or version string. [S1] |
| Declaration manifests | Candidate global `plugins.json` is under the documented global customization root. Project declarations occur in eligible customization roots. Expand qualified `inherits` and `entries` edges with provenance. Record declaring path, resolution base, fallback checks, array order, include/exclude inputs, and canonical target. [E4, E5] |
| Explicit customization inputs | Account for selected-agent discovery paths and files. Embedded documentation distinguishes a directly configured manifest from a configured directory containing a manifest. It also distinguishes configured exclusions from environment-inherited customizations. Exact field names and semantics remain unqualified. [E5] |
| Plugin manifests | Track root `plugin.json` and qualified competing marker paths, including absences that could change selection. Resolve manifest precedence before selecting defaults. A display name must not substitute for the directory-name enablement key. [E3, E4] |
| Imported markers and declared targets | Include `gemini-extension.json`, `.claude-plugin/plugin.json`, and declaration-selected directories without a native manifest in the candidate matrix. Embedded text names them in installation and declaration contexts. Their presence does not establish active native selection. Qualify their current loader role or retain a specific contract unknown. Do not run staging or synthesize installed output. [E4] |
| Hook layouts | Distinguish nested event/handler objects inside root `hooks.json` from a nested filesystem path `hooks/hooks.json`. Track relevant packaging metadata without asserting it executes. Do not treat the synthetic reproduction's `hooks` manifest property as proven indirection. [E1, E4] |
| Enablement | Embedded text describes a `config.json` `plugins` map and manifest `disabled` default. Determine the exact registry path, other overriding sources, absence defaults, malformed-value behavior, and collisions from primary evidence. `~/.gemini/config/config.json` is a candidate, not an established path from reproduction. |
| Selected agent and settings | Bind `--agent`, actual agent definition/precedence, inherited customization controls, session settings, and `--add-dir`. The generated `plugins: []`, `skills: []`, and empty tool list do not prove that environmental startup plugins are disabled. Global collision probes currently cover only two names. [S1, S3] |
| Other plugin startup contributions | Fingerprint loader-selected MCP/rule/skill metadata and declarations insofar as they affect startup selection or startup effects. A selected enabled MCP startup contribution needs a known effect model or an unavailable reason. Avoid generic asset-tree scanning or claims about later optional skill execution. [E4] |
| Loader contract | Bind the executable identity, qualified semantic specification, schemas, discovery ordering, normalization rules, and selected-agent behavior. A contract change invalidates reuse even when source bytes remain unchanged. |

For declared paths outside the requesting workspace, inventory remains read-only and policy-bound. A declaration does not grant access or add a writable root. Unsupported expansion, remote references, or unavailable primary rules produce unknown. Do not try both competing path interpretations and call their union the actual loader.

### Ordering and deduplication

The graph retains each discovery edge and its source order. Canonical path deduplication can avoid repeated file reads, but it must preserve all declaration edges, duplicates, and selection provenance. Do not deduplicate by display name alone.

Embedded text lists priority from workspace project through workspace declarations, global discovery, built-ins, and global declarations. This is documented priority, not proof of iteration or hook execution order. [E4] The qualified contract must settle ancestor direction, alias precedence, inherited/local merge order, duplicate plugin selection, and handler ordering.

`AuditSnapshot.ordering` will project the qualified effective sequence using stable source identities. Alphabetical sorting is permitted for directory-list fingerprint serialization only when it does not replace loader ordering. Unknown ordering adds a specific unavailable reason. A deterministic arbitrary order is not qualified order.

### Presence, enablement, and effects

The proposed `presence` values are `installed`, `absent`, and `unknown`. Proposed `enablement` values are `enabled`, `disabled`, `unknown`, and `not-applicable`. Proposed `selection` records whether the loader selects, excludes, shadows, or cannot resolve a source. These values do not change existing Observation enums.

| Observed combination | Source metadata | Effects and completeness |
| --- | --- | --- |
| Installed, enabled, selected | Bind manifest, hook bytes, controlling configuration, roots, and order. | Extract only supported active descriptors. Effects require existing disposition. Invalid handler schema or unresolved closure blocks completeness. |
| Installed, disabled | Retain the same relevant manifests, hook metadata/bytes, registry inputs, and root membership. | Emit no hook/MCP/rule active effects from that plugin. Do not inspect its hook commands as active executable dependencies. |
| Installed, enablement unknown | Retain available metadata and unresolved candidates. | Candidate hooks are not asserted active or inactive. Emit an enablement unavailable reason. Approval cannot discharge it. |
| Proven absent | Record an explicit absence only after a qualified candidate probe yields ENOENT with verified path components. | No effect from that candidate. Appearance invalidates reuse. An absent registry does not imply a default until that default is qualified. |
| Unreadable, malformed, oversized, cyclic, symlinked, or unverified | Retain safe path/metadata facts and the failure category. Do not forge a file digest. | Mark unknown and block inventory discharge, including for a disabled plugin whose audited metadata cannot be established. |

The documented enablement rule remains a candidate to validate. Under that candidate rule, a user registry boolean overrides manifest `disabled`. If the registry has no entry for the plugin, the manifest default applies. Validate the rule for the actual selected source. Missing or non-boolean fields cannot become false by JavaScript coercion. [E4, records[2]]

Plugin-level gating occurs before active hook extraction. Supported hook-level disablement then applies inside selected enabled plugins. Metadata-only parsing never feeds `hookDescriptors` or the generic executable-closure scanner. This prevents a disabled plugin from acquiring active effects.

Preserve `startup-hook:` effect identifiers for equivalent supported active descriptors. Keep source/event/matcher/order provenance in the graph. Keep duplicate descriptor occurrences when passing the active set to Orca custody recognition. The existing final effect-set deduplication is not permission to collapse the discovered descriptor set.

### Newly inventoried active plugin command dependencies

This correction covers newly inventoried command hooks from selected, enabled plugins. It does not rewrite the generic shell scanner for other routes or historical hook sources. Disabled plugin hooks remain metadata and do not trigger active executable-dependency checks.

Current `hookEffects()` can count `/bin/sh` as pinned while leaving `./relative-script.sh` unbound. It follows a symlink to its target. It skips script-content inspection at `stat.size >= 262144` without recording that limitation. [S1, lines 130–148] These behaviors cannot establish closure for newly inventoried active plugin hooks.

For a supported simple command form, bind every executable and script operand. Resolve relative operands only against the base established by the qualified loader contract. That might differ from the plugin directory or execution cwd. Do not invent a default. A bare interpreter does not establish custody of its script operand.

If an operand or its resolution base is unbound, retain proposed `AGY_PLUGIN_HOOK_DEPENDENCY_UNBOUND`. Reject symlinked dependencies, including unresolved component links, with proposed `AGY_PLUGIN_HOOK_DEPENDENCY_SYMLINK`. A script dependency of `262144` bytes or more gives proposed `AGY_PLUGIN_HOOK_DEPENDENCY_TOO_LARGE`. This reuses the existing inspection cutoff as a conservative proposed refusal for this scoped input class. It does not turn the cutoff into an AGY loader limit.

Use bounded, no-follow reads for supported dependencies. Retain existing dynamic-closure and credential/endpoint restrictions. Unsupported shell syntax, computed operands, or unproven transitive dependencies remain specifically unavailable. This proposal adds no general shell parser and does not execute commands to resolve them.

The separately qualified five-event Orca boundary remains distinct. Submit the complete active referencing descriptor set to its existing recognizer. Only a successful exact policy can cover its recognized descriptors. A plugin's unsupported extra Orca reference still rejects the whole referencing set. Do not subject a qualified exact descriptor to an invented alternative parser or exempt it by name alone. Keep unrelated existing hook checks unchanged.

## Proposed fingerprints and audit reuse

Directory metadata alone cannot establish inventory membership. The proposed witness addresses that gap without changing `currentSourceDigest()` or inventing synthetic directory hashes in `AuditSource.sha256`. Compatibility requires the qualified loader and the exact normalization preconditions below.

The proposed artifact location is `<workspace>/.council/control-audits/inventories/<fingerprint>.json`. It is an ordinary file source, hashed using existing byte-digest semantics. The preimage excludes its own witness identity and derived snapshot, recipe, and fact hashes to avoid a hash cycle. It includes actual recipe inputs. This computational exclusion does not establish that the witness or audit directories are outside loader discovery. Their actual loader membership needs primary evidence. If they participate, artifact placement or contract design remains blocked. Existing audit-directory custody safeguards apply.

Deduplicate audit sources by `(path, kind)`, while retaining graph provenance. A file's content source and metadata source can both matter to custody. Do not retain only one because their paths match.

| Fingerprint input | Required representation |
| --- | --- |
| Context | Canonical requesting workspace, execution cwd, home identity, repository boundary, selected agent, relevant argv/settings, relevant environment values and absent values. Do not retain unrelated environment data or credentials. |
| Root inventory | Each relevant root's complete bounded entry-name/type listing and custody rules. Bind ordinary root identities and explicit absences. For the exact conditional materialization set, bind the normalized entries and enforce separate physical custody. Include empty roots. |
| Absence and fallback | Every qualified absent candidate, competing manifest, registry, customization root, and fallback probe whose appearance changes selection. |
| File sources | Byte digests for selected and disabled plugin manifests/hooks, declaration manifests, enablement inputs, agent definitions, and relevant startup configuration. Preserve byte-level drift semantics. |
| Ordering inputs | Declaration array order, inheritance edges, filters, resolution bases, root priority, duplicate/shadow decisions, handler/event order, and the qualified normalization rules. |
| Contract | Semantic contract ID/digest, retained evidence digests, executable identity, schema/resolution rules, and adapter algorithm revision. A display version alone is insufficient. |
| Materialization rules | Exact static agent/settings paths and byte hashes, parsed discovery controls, required directory paths, and qualified normalization rules. Bind the existing static `agyHookShell` policy separately from its per-assignment instance. No future inode or wildcard entry enters this set. |
| Completeness | Every unknown/unavailable reason and the absence of unresolved edges in a complete graph. No truncated graph can hash as complete. |

Projecting the result preserves the snapshot contract:

- `sources` contains ordinary external file sources, stable metadata and absence sources, and the ordinary witness file. Exact transitional nodes use witness validation instead of raw absence or mutable-metadata entries. The node partition below is mandatory in both snapshot and recipe sources.
- `ordering` contains the effective qualified source sequence.
- `effects` contains supported selected active effects only.
- `unavailable` contains every unresolved inventory or source condition.
- `contract` uses a proposed new AGY inventory contract identifier bound to its semantic digest. This identifies rules, not an allowed-version list.
- `recipeHash` binds the exact stable recipe inputs and normalized inventory fingerprint using the formula below. It does not bind a physical phase label or future assignment instance. It does not replace `auditHash()`.
- The startup completeness fact's digest/detail binds the new audit hash even for a complete no-effect graph. This carries inventory and contract changes into `controlsHash`, where fact timestamps are already excluded.

### Exact source partition and stable approval identity

The current raw digest loops run in adoption, direct reuse, and launch. An appeared `absent` source returns `unexpected-source`. A directory metadata digest changes with size, mtime, or inode. [S2, S6] Do not project a conditional transition and also retain its contradictory raw source check.

| Node class | Proposed source projection and validation |
| --- | --- |
| Ordinary loader inputs and non-transitional absences | Retain ordinary `AuditSource` records and unchanged digest semantics. Validate bounded inventory bytes and complete root listings. Newly appeared manifests, registries, plugins, or roots invalidate reuse. |
| Exact recipe materializations | Put the agent and session-settings paths, byte hashes, and supported modes in the witness recipe inputs. Do not add raw `file`, `absent`, or `metadata` records for those exact managed paths before or after materialization. Validate their physical state with the exact closed-set rules below. |
| Required directories and affected ancestors | The witness covers exact required paths such as the packet root, `.agents/agents/council-packet`, and the settings hash directory. It also validates affected `.council` and workspace ancestors. Do not add new inventory metadata records whose mtime or size changes solely through these declared writes. Preserve existing unrelated source checks. Check realpath, type, ownership, applicable modes, identity stability during inspection, and every loader-relevant entry through the witness. |
| Per-assignment hook profile | It is not a static recipe materialization list. Keep the static hook policy and its existing external pinned sources bound. Actual instance paths and identities remain under the existing assignment-bound producer and verifier. Loader participation is unresolved and can block compatibility. |
| Audit bookkeeping | A directory name does not prove exclusion. Require primary evidence that the proposed witness location and bookkeeping changes do not add loader inputs. Until then, do not claim a reusable complete snapshot. |

These are proposed changes to future inventory projection. They are not instructions to skip an existing source comparison after it fails. The projected source arrays must be correct before adoption. A snapshot containing a raw transitional absence or mutable-metadata record fails validation. The validator must not return a substitute digest for that record.

The proposed stable rule uses three named values: current normalized context `C`, exact stable recipe inputs `R`, and normalized inventory `N`. These are proposed hash inputs, not existing fields. `R` contains selection, executable identity, argv, static materializations, agent binding, and the optional static `agyHookShell` policy. It contains no per-attempt assignment hash or future inode.

`N` preserves qualified ordering, ordinary inputs, all relevant root entries, absences, disabled metadata, and completeness. A qualified closed-set rule may represent an exact recipe materialization by its intended path and content hash in both valid physical states. All other entries retain ordinary membership and drift semantics. Unknown loader behavior makes normalization unavailable.

The proposed fingerprint is `F = sha256(canonicalJson({ context: C, recipeInputs: R, inventory: N, loaderContract }))`. The immutable witness contains this stable core and `F`. Its bytes exclude transient phase observations. Let `W` be the SHA-256 of those witness bytes. Its exact file source is `<workspace>/.council/control-audits/inventories/<F>.json`, kind `file`, sha256 `W`.

The proposed recipe hash is `Q = sha256(canonicalJson({ recipeInputs: R, inventoryFingerprint: F, inventoryContext: C }))`. This preimage includes every current recipe-hash input through `R`. It includes the static optional hook policy, not a future runtime instance. Snapshot `recipeHash` must equal `Q`.

Both valid static states must therefore yield the same `C`, `R`, `N`, `F`, witness bytes, witness source, ordered source array, ordering, effect set, unavailable set, contract, and `Q`. They then yield the same `auditHash()` and disposition lookup path. Physical observations are checked before verification and are not added to hashed facts or source arrays. Do not sort away qualified loader order to obtain equality.

This is a conditional compatibility requirement, not a claim that the current loader satisfies it. If normalization changes loader selection or cannot cover the full existing materialization lifecycle, return unknown. Do not manufacture the old audit hash, rewrite an adopted snapshot, or silently select a prior disposition.

### Exact static materialization checks

The static set is the existing recipe's agent definition and session settings, with their exact parent paths. Recompute the set from the current package recipe builder. Do not accept a set supplied solely by saved witness text. This proposal adds no materialization.

Before writing, inventory may accept either all exact files absent or all exact files already complete. Absence requires verified components. Complete files must be regular, non-symlinked, and byte-identical to the recipe. Verify owner, parent custody, and the existing explicit mode requirement where specified. No partial file set passes. An interrupted creation remains unknown until its separately authorized owner reconciles it.

Directory checks use actual `lstat` and realpath results. For an existing ordinary root, retain its recorded stable identity where custody requires it. For a directory that does not yet exist, bind its exact path and creation/custody requirements rather than inventing an inode. After materialization, require actual files and actual directories to satisfy those requirements. Compare identities across each inspection boundary and retain the existing producer checks. Do not claim a future identity was pre-approved.

The normalized root listing adds only the exact file and directory entries required by `R` when those entries are physically absent. When they exist, it requires their exact form. It never drops another entry. An extra manifest, plugin, changed byte sequence, symlink, or unaccounted directory makes the graph unknown or changed. A source seen by another loader edge remains selected through that edge. It cannot be hidden by marking it managed.

Before spawn, require the complete physical state. Infer state from inspected contents and custody. Remove the earlier proposed `phase` argument. No caller label authorizes absence, normalization, or reuse.

### Existing per-assignment hook profile

`instantiateAgyHookShellPolicy()` creates paths after assignment binding. Its run path is `.council-profiles/agy-hook-` plus the hash of `{ policyHash, assignmentHash }`. Its report is `instance-` plus the hash of `context.directory` and `.json`. [S4, lines 416–460]

The existing producer captures actual directory identities after creation. It binds assignment, policy, producer, materials, paths, and instance hash. It checks the exact `bin` entries, empty HOME/cwd directory, modes, source bytes, ancestor custody, and report. The generated verifier repeats its runtime custody checks. Preserve these checks and their finite existing scratch behavior. Do not invent future inodes, statically enumerate future assignments, or replace the producer with an `agy-hook-*` wildcard exemption.

For a later assignment, use that assignment's real binding and producer output. A prior instance report does not authenticate the current instance. For any old instance encountered by qualified discovery, apply the loader's actual membership rule. A matching prefix is not proof of ownership or exclusion. This correction does not authorize deleting or repairing old instances.

Compatibility has a precise unresolved branch. If primary loader evidence proves these instance artifacts are outside discovery, they do not enter `N` or snapshot sources. Their execution remains guarded by the existing hook boundary. If the loader reads them, their membership and effects must enter the inventory. A differing assignment may then require a new audit identity unless a separately evidenced exact equivalence rule exists. Until this branch is resolved, the design cannot promise unchanged second-launch approval reuse.

The smallest missing compatibility evidence is the loader traversal and consumption rule for the static materializations, `.council-profiles` contents, and proposed audit-witness location. It must also establish whether the instance-specific PATH transformation changes startup discovery. Do not infer an answer from a hidden directory name or existing materializer implementation. If these artifacts are loader inputs with assignment-specific effects, the coordinator must choose a new evidence-backed audit design. That decision remains open.

### Direct saved-snapshot validation and live context

Adoption and acquired disposition can receive a saved `AuditSnapshot` without a current recipe. The snapshot has no HOME, selected-agent definition, or environment map. [S2] Saved witness values are expected values only. They cannot serve as current host observations.

The proposed validator performs the following checks before successful adoption or reuse:

1. Canonicalize the live workspace and verify its actual path components and native workspace ownership. Derive `executionCwd` as `join(realpathSync(snapshot.workspace), ".council/native-packets")`. A missing child path is checked through its real existing ancestors.
2. Obtain `realpathSync(homedir())` and relevant raw HOME presence/value from the live process. Acquire every qualified discovery-related environment value and its absence state from `process.env`. Build the child environment using the current wrapper rules. Do not copy environment values from the witness.
3. Resolve the current executable through live PATH and check its canonical identity and bytes against the qualified loader contract. Read current settings and selected-agent sources. Recompute the current deterministic recipe plan using validated request selection, current package code, and live inputs. Saved selection may identify the requested model, but it cannot establish the current home, agent contents, argv construction, or source membership.
4. Require exact equality between reconstructed `C` and witness context. The base PATH and the exact existing hook-policy transformation remain distinct inputs. Validate the current assignment's transformed PATH against its instance at launch. Unknown relevance of that transformation remains a contract blocker.
5. Recompute `N`, `F`, and the canonical witness bytes. Require exactly one witness `file` source at the derived path with digest `W`. Reject missing, duplicate, relocated, mismatched, or conflicting witness records. Bound witness reads and validate custody before parsing. Do not search for another witness after a mismatch.
6. Recompute `R` and `Q` from the live plan and normalized inventory. Require `snapshot.recipeHash === Q`. Require the entire projected source array, ordering, effects, unavailable set, executable, providerVersion evidence, and contract to match the saved snapshot. A subset comparison is insufficient.
7. Validate ordinary source digests with their existing meanings. Use bounded guarded file digests for inventory JSON. Transitional nodes are witness-only by construction. Keep all existing native authority, identity, generation, and effect-scope checks. Any unknown inventory prevents verified disposition.

The same rules apply to a retained `ProviderRecipe`. Compare the actual current recipe inputs and source array, not only the saved witness. Neither public audit function signature nor `AuditSnapshot` schema changes. If current inputs cannot be reconstructed without an unavailable capability, return a specific unknown and require fresh preparation. Do not execute a provider to fill that gap under this proposal.

### Preparation and launch lifecycle

Ordinary inspection stays read-only and returns available evidence. Missing witness gives proposed `AGY_INVENTORY_WITNESS_PENDING`. Explicit audit preparation persists only a complete matching witness or a clearly unavailable diagnostic snapshot. It reacquires inputs before saving. It grants no effects.

Adoption and direct reuse validate live context, recipe binding, graph, and physical custody. First launch validates the complete source projection before existing static materialization. It validates the complete static state after writing. It then retains existing hook-policy acquisition and assignment-instance checks before spawn. A later launch repeats these checks for its actual assignment. Normal and cancellation probes must not inherit a prior instance's authority.

The future implementation must apply guards at all three existing raw-digest call sites. It must reject malformed source partitions rather than bypass their comparisons. Old AGY snapshots without this inventory contract and witness cannot establish completeness. Preserve historical bytes and request fresh preparation. Other routes retain their existing contracts.

Preparation remains a proposed workflow cost for reusable verification, including complete empty inventories. Existing help-only expectations need valid contract fixtures and explicit preparation. No product behavior is changed in this author entry.

Static boundary checks do not prove that concurrent mutation is impossible after spawn. Preserve the separate runtime custody and operational qualification requirements.

## Proposed bounds and error handling

Reuse the existing 100-entry directory limit and 1 MiB JSON limit. Today, `readStrictFile()` reads before checking length and `track()` can hash before parsing. [S1, S2, S3] A bounded inventory cannot preserve that read order for untrusted inventory files.

The proposed inventory reader uses no-follow opens where available, verifies each path component and final file type, and reads at most the relevant byte limit plus one. It hashes and parses the same bounded bytes. It compares descriptor identity and metadata before/after reads. A changed input produces unknown. No shell expansion, JavaScript evaluation, installer, or plugin code participates.

Inventory validation must run before generic unbounded source reads. Its guarded digests must be used for inventory JSON and witness files at adoption/reuse/launch. Do not validate their size and then reread them unbounded. Keep `currentSourceDigest()`'s existing SHA-256/null/metadata/absence semantics. Ordinary valid-file results must agree with those semantics. Other existing source classes retain their custody checks.

| Limit | Status and proposed handling |
| --- | --- |
| 100 entries per inventoried directory | Existing bound. The 101st entry makes that inventory unknown. Use bounded enumeration rather than silently slicing. |
| 1 MiB per JSON input | Existing bound. Apply before parsing or whole-buffer hashing. Apply the same bound to the proposed witness format. |
| 1,000 distinct inventory paths | Proposed aggregate ceiling, to prevent a branching manifest graph from multiplying per-directory work. |
| 32 inherited-manifest edges on one path | Proposed depth ceiling. Cycle detection is separate and can stop earlier. |
| 128 eligible ancestor levels | Proposed traversal ceiling. The qualified boundary should normally terminate earlier. |
| 64 nested hook/config object levels | Proposed parser/schema traversal ceiling. Deep input becomes unknown before recursive stack exhaustion. |
| 16 MiB aggregate inventory JSON bytes | Proposed aggregate ceiling. The loader executable and existing separately pinned hook runtime files are separate source classes. |

The additional values are author proposals for review and fixture boundary tests. They are not documented AGY limits. Hitting any limit blocks completeness rather than redefining the loader's source set.

| Condition | Proposed result |
| --- | --- |
| ENOENT | Record a qualified candidate absence only after verified parent/component traversal. Distinguish a dangling symlink from absence. |
| EACCES/EPERM or runtime access refusal | Record the target and refusing layer. Mark the affected input unknown. Pause that operation. Do not change form, provider, mode, or permissions to retrieve it. |
| ENOTDIR or unexpected file type | Report a specific invalid source/root condition. Do not treat it as an absent valid directory. |
| Malformed JSON, invalid UTF-8, duplicate keys, or loader-schema mismatch | Report a specific parse/schema failure. `{}` or a parsed object alone does not prove a valid loader document. |
| Oversized input or entry overflow | Report the path and exceeded bound without reading an unbounded file or truncating a supposedly complete inventory. |
| Symlink in a root, plugin directory, manifest path, or hook path | Reject the inventory edge under the existing conservative containment rule. Capture safe link metadata without following it. Existing separately qualified hook-runtime aliases retain their own stricter custody rules. |
| `inherits` cycle | Track the active canonical-path stack. Report the cycle edge. A shared acyclic dependency can be reused with every provenance edge preserved. |
| Ambiguous path base, unsupported pattern, unknown marker precedence, or duplicate enablement identity | Report a contract/selection unknown. Do not guess, glob broadly, or read both interpretations as though selected. |
| Directory/file replacement during acquisition | Report unstable inventory. A partial earlier result remains diagnostic evidence only. Do not retry indefinitely. |
| Disabled but unverified metadata | Preserve safe installation/disablement facts, emit no active effects, and retain the metadata failure as unavailable. |

Proposed reason families include `AGY_LOADER_CONTRACT_UNVERIFIED`, `AGY_INVENTORY_ROOT_UNREADABLE`, `AGY_INVENTORY_LIMIT_EXCEEDED`, `AGY_MANIFEST_SCHEMA_INVALID`, `AGY_MANIFEST_CYCLE`, `AGY_PATH_RESOLUTION_UNVERIFIED`, `AGY_PLUGIN_ENABLEMENT_UNKNOWN`, `AGY_INVENTORY_SOURCE_SYMLINK`, and `AGY_INVENTORY_DRIFT`. Each reason needs a bounded source/edge reference. These are not existing exported error codes.

The startup fact can be verified only for complete qualified inventory with no pending effects, or through a matching authenticated disposition with zero unavailable entries. Never pre-mark it verified because failed reads were filtered out. Unknown inventory cannot be approved away by dispositioning the effects that happened to be discovered.

## Preserve the five-event Orca hook boundary

The existing events are `PreInvocation`, `PostInvocation`, `Stop`, `PreToolUse`, and `PostToolUse`. The recognized policy requires all five exact commands and checks every discovered referencing descriptor, including duplicates. It checks type, timeout, source identities, provider/runtime hashes, ownership, modes, Python startup directories/absences, environment, template, and execution cwd. [S4]

The new inventory supplies the complete **active** descriptor set to the existing applicability/acquisition functions. It must not pass only a convenient subset of global hooks. An additional active plugin descriptor referencing the Orca hook participates in whole-set validation. An unsupported extra descriptor still rejects that scoped policy. A disabled plugin's descriptor remains metadata and does not enlarge the active set.

Keep ordinary unrelated hooks in the generic effect audit. Newly inventoried active plugin commands additionally require the scoped dependency checks above. Keep dynamic executable/closure reasons for unrelated custom shell scripts. A successful known-hook policy may remove only the exact existing known dynamic-closure reason, as current code does. It cannot remove inventory, plugin-enablement, malformed-source, or unrelated-hook failures. [S1, T1]

Preserve the generated verifier's repeated identity, directory-entry, absence, clean-environment, and copied-artifact checks. [S4] The new graph neither requalifies that profile nor changes its pinned runtime support. Portable fixtures must never spoof production identity to turn a fake provider into a qualified known-hook runtime.

## Coverage of every posted acceptance criterion

The following are proposed later verification cases, except for the accepted RED in AC1. None was executed during this authoring entry.

| Criterion | Evidence now | Required portable behavioral verification and acceptance boundary |
| --- | --- | --- |
| AC1: portable failing regression on unchanged baseline, isolated fake home/current-store hook, real acquisition | Accepted reproduction: three runs, each with one current-store failure and one recognized-root pass. Real acquisition, fake help only. Explicit baseline and cleanup records. [E1, E2] | Preserve that diagnostic and its source bytes. After authorized implementation, the real boundary must acquire both current-store manifest and hook and never verify incomplete inventory. Do not interpret the fixture's synthetic enablement schema as loader proof. |
| AC2: version-matched primary locations, order, enablement, global/workspace/installed and supported manifest/nested layouts | Partial embedded documentation and observations. Path and precedence gaps remain. [E3–E6] | First obtain the primary evidence listed below. Then test packet cwd distinct from workspace, intermediate ancestors, repository boundary/fallback, global store, each qualified alias, global/project declarations, inheritance/filter order, explicit agent config, duplicates/shadowing, manifest precedence, and supported nested handler layout. Test native root hooks separately from installation-staged nested files. |
| AC3: disabled sources fingerprinted, active effects and unknown enablement accurate | Current extraction handles hook-object `enabled:false`, not authoritative plugin enablement. [S1] | Paired enabled/disabled fixtures share identical installed manifests/hooks. Disabled changes still alter fingerprints but create no active effects or executable-closure requirements. Unknown registry/default/identity blocks verification without asserting activity. Test override true/false versus manifest defaults and proven registry absence under the qualified contract. |
| AC4: unreadable/malformed/oversized/symlinked/unverified inventory is specifically unavailable. Existing bounds retained | Current helper bounds and digest limitations are mapped. [S1–S3] | Test malformed and duplicate-key JSON, invalid schema/UTF-8, unreadable directories/files, nonregular nodes, dangling/component/root symlinks, 100/101 entries, 1 MiB/bound-plus-one bytes, inherited cycles, deep nesting, aggregate limits, and unstable reads. Every failure must name its source, preserve diagnostic metadata, and keep startup unknown even with all listed effects authentically dispositioned. |
| AC5: manifest/enablement/root/contract drift invalidates reuse. Unchanged valid evidence reusable | Existing hash/authority chain detects known file drift, but directory metadata is not a complete inventory digest. [S2, S5, T2] | Prepare/adopt/reuse an unchanged complete fixture successfully. Mutate each manifest, disabled hook, registry entry, selected-agent input, discovery order/filter, loader semantic digest, or executable identity. Add/remove/rename a child. Create an absent root, registry, or higher-priority manifest. Exercise fresh acquisition, direct saved-snapshot reuse/adoption, and retained-recipe pre-spawn checks. Include an addition with restored directory timestamp. Every affected reuse must fail. |
| AC6: five-event custody and unrelated-hook checks retained. Offline tests/typecheck/build. No real provider/plugin fixture execution | Existing custody source and regressions mapped. No checks run here. [S4, S6, T1–T3] | Preserve existing five-event/whole-set/alias/relative-cwd/unsupported-descriptor/mode/source-drift cases. Add active plugin extra-descriptor, disabled counterpart, and unrelated custom-hook cases. Use fake HOME and fake AGY help only. Future targeted offline suites, full offline suite, typecheck, and build must pass. A static document cannot satisfy those implementation checks. |

Proposed integration surfaces are the existing `provider-controls.test.ts`, `control-audit.test.ts`, and `agy-hook-shell.test.ts`. A proposed `agy-startup-inventory.test.ts` can isolate graph/schema/bound cases while integration tests exercise the real acquisition boundary. This new test file does not exist as part of this assignment.

Fix-round verification additions are proposals, not executed results. AC2 includes imported markers and manifestless declaration targets without assuming native activation. AC4 and AC6 include active plugin interpreter-plus-relative-script, symlink, and cutoff-boundary cases. Disabled counterparts retain metadata without active dependency scans.

AC5 must compare `F`, witness bytes, both source arrays, `recipeHash`, `auditHash`, and disposition lookup across exact absent and complete static states. It must reject a partial set, extra entry, changed byte, altered custody, or raw transitional source record. Add direct saved-snapshot cases with changed live HOME, base PATH, relevant environment absence, selected-agent settings, missing/duplicate witness, and a mismatched recipe hash.

Also verify distinct per-assignment hook instances without reusing a prior assignment's report. If the loader's participation rule for profile artifacts or audit bookkeeping is unresolved, expect unknown rather than an invariant audit hash. No case may assume those paths are excluded because of their names.

Existing package scripts are `test: vitest run`, `typecheck: tsc --noEmit -p tsconfig.json`, and `build: tsc -p tsconfig.build.json`. Build also invokes the existing asset-copy postbuild. [S7] `control-audit.test.ts` imports `dist` modules. [T2] A later approved plan must build current code before running that suite, so stale output cannot masquerade as validation.

The proposed later sequence is `npm run build`, targeted offline regressions including `npm test -- test/pilot/provider-controls.test.ts test/pilot/control-audit.test.ts test/pilot/agy-hook-shell.test.ts` and the proposed inventory suite, then the confirmed offline full suite and `npm run typecheck`. The later plan must confirm suite behavior before execution. These are future checks, not results or commands authorized by this author entry. Existing #9 cleanup tests and modified startup fixtures must be reconciled by their coordinator, never overwritten to obtain a pass.

## Smallest missing evidence and coordinator questions

The next evidence request should be narrow and version-bound. A whole product source dump or an inference run is unnecessary.

1. Obtain the actual 1.4.12 discovery/path resolver and its caller context, or an authoritative vendor clarification tied to the retained executable identity. It must settle declaring-parent versus repository-relative paths, fallback probes, tilde behavior, and global versus project bases.
2. Obtain the matching customization/plugin selection rules. They must settle eligible roots/aliases, repository/no-repository boundary, ancestor and manifest order, duplicate identity, include/exclude semantics, and selected-agent explicit versus environmental discovery.
3. Obtain the exact enablement registry location/schema and precedence for that loader. Include absent entries, manifest `disabled`, explicit true/false, malformed values, and directory-name collisions. A plugin list without its controlling source is insufficient.
4. Obtain the matching manifest and hook parser rules. They must settle competing marker precedence, root/nested/staged hook layouts, supported nested handlers and hook disablement, and any native manifest hook indirection. Include `gemini-extension.json`, `.claude-plugin/plugin.json`, and declaration-selected directories without a native manifest as candidates. Installation documentation alone cannot establish active native membership.
5. Obtain the traversal and consumption rules for the exact existing agent/settings outputs, per-assignment hook profiles, instance PATH transformation, and proposed audit-witness location. These rules determine whether the conditional compatibility projection is valid. If assignment-specific artifacts are loader inputs with different effects, the coordinator must choose a revised audit design rather than claim unchanged reuse.

A small authoritative source excerpt containing those functions and their call sites, with release/binary provenance and relevant vendor tests, can resolve the gaps. Corrected version-bound primary documentation can also suffice if it resolves the contradictions and covers the selection matrix. An authoritative loader-report alternative must demonstrate all equivalent fields and safe non-inference behavior before Approach B becomes usable. This author entry does not request or run that qualification.

Open design questions for the coordinator:

- Does the proposed immutable witness and explicit preparation requirement fit the intended audit workflow, including complete inventories with no active effects?
- Can the qualified contract explicitly separate selected-agent mounts from inherited environment sources, and identify the full input set for `council-packet`?
- Which primary source resolves the conflicting path and manifest rules? Until that source exists, which discovery task will produce it?
- Are the proposed aggregate/depth budgets appropriate, or should fixtures establish different finite values before plan approval?
- Can the existing materialization lifecycle support the exact two-phase graph transition, or should preparation produce a stable packet layout under a separately approved plan?

These are recorded questions, not requests to this entry's user. They do not authorize work on #8 or the pending #9 access remedy.

## Readiness and handoff

The proposal covers all six acceptance criteria and supplies source/evidence boundaries for review. AC1 has an accepted reproduction. AC2 is not complete. AC3–AC6 have proposed behavior and verification, not implementation results.

The honest readiness verdict is **design proposal available. Implementation blocked on primary loader evidence and pending design approval**. The static compatibility rule is now explicit and conditional. Exact loader membership of runtime profiles and audit bookkeeping remains unresolved. If these inputs defeat the stated equivalence, a revised audit design is required before implementation planning. A fail-unknown guard cannot replace the requested complete #3 behavior with a current-store-only patch. No issue is fixed, closed, or operationally accepted.

The coordinator can freeze these two documents for Task 2, obtain the required fresh independent reviews, resolve evidence-backed findings, and later present a reviewed design for user approval. No #4 live startup qualification or #7 acceptance follows from this proposal. #8 design approval and #9 access remedy remain pending and outside this assignment.

Author self-review: all posted criteria map to explicit checks. Existing interfaces precede proposed ones. Source facts and new names are separated. Disabled metadata and graph drift are covered. The design deliberately leaves implementation provisional. Language is an Issue 9-oriented candidate using the supplied STE guidance. The official dictionary and governed terminology were unavailable, so full STE conformance is not claimed. Technical literals and uncertainty are preserved.
