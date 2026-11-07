# Gemini startup controls implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Reproduce issue #1 ranking item #3 in this checkout, repair only the evidenced Gemini trust/startup defects, and independently review the frozen change.

**Architecture:** Diagnose the existing AGY acquisition and pre-input session path before deciding any production edit. Preserve provider trust and permission boundaries; a real access refusal stops only the affected route.

**Tech stack:** TypeScript, Node.js, Vitest, Orca CLI/API, installed AGY.

**Spec:** `docs/superpowers/specs/2026-10-30-gemini-startup-controls.md`.

## Global constraints

- Reproduce on unchanged production code in `/Users/aaat/.codex/worktrees/council-first-use/the-council` at `6b5378ef60fac4c302cd4422deb3258fd6a4ce2b` before implementation.
- Scope is ranking item #3, Gemini trust/startup. Leave Codex, Cursor, billing and normal Council deliberation issues alone.
- Use `/usr/local/bin/orca`, CLI/API only. No GUI, startup, focus or dialogs.
- Read `/Users/aaat/.agents/policies/model-policy.md` before each model selection/assignment.
- Preserve global settings, trust, permissions, credentials, unrelated sessions and all existing work. No automatic trust enrollment or permission bypass.
- Exact Gemini model `gemini-4-argon-high` with explicit effort `high`; hidden backend effort remains unexposed.
- Production changes require an observed failing test before source edits, targeted checks and the full suite.
- Fresh Argon high review through Orca and fresh native `gpt-6-astra` review at `max` are explicitly requested. Verify findings independently; neither a model verdict nor a majority establishes correctness.
- No real Council question or model turn during startup reproduction. Withhold stdin and positively settle every owned provider/process/terminal.
- No secrets or raw configuration payloads in saved diagnostics or public evidence.

## Review focus

- Exact packet cwd versus project cwd trust semantics: report the real refusing layer without changing enrollment.
- Updated installed AGY version/help versus a stale Council contract: distinguish acquisition failure from runtime refusal.
- Stream initialization before user input: zero calls/input on any startup failure.
- Empty tool and helper ceiling, selected model, agent and permission mode: missing or mismatched settings cannot become verified.
- Owned lifecycle cleanup and source/settings preservation: retain unknown exit receipts honestly.

### Task 1: Diagnose and reproduce Gemini startup before implementation

**Files:** Read `src/pilot/provider-controls.ts`, `src/pilot/provider-session.ts`, their direct contract dependencies and focused tests. Write only this plan's private diagnostic report/scripts/evidence.

**Interfaces:** Consume current provider-control acquisition and provider-session initialization; produce a sanitized reproduction report with exact commands, baseline hashes, actual results and a bounded fix recommendation.

- [ ] Inspect installed AGY version/help/catalog and official documentation; compare the actual code path and current trust state without global mutation.
- [ ] Reproduce Council acquisition on unchanged source, retaining the exact missing/unsupported facts and whether a provider was spawned.
- [ ] If a real provider startup is supported and authorized, launch through an owned Orca terminal using the actual Council recipe, withholding stdin. Stop on any trust/access refusal and retain its exact diagnostic; never substitute a different path to bypass it.
- [ ] Record ownership, actual cwd/argv/settings, source/settings hashes, zero input and full settlement; write the diagnosis report.
- [ ] Refine this plan's production task from the evidence before any production edit.

### Task 2: Repair evidenced AGY acquisition and input-boundary defects

**Files:** Modify `src/pilot/provider-controls.ts`, `src/pilot/provider-session.ts`; focused tests `test/pilot/provider-controls.test.ts`, `test/pilot/provider-session.test.ts`, directly affected `test/pilot/fix5-regressions.test.ts`, `test/pilot/control-audit.test.ts`, and truthful AGY fixtures if needed; public sanitized records `docs/qualification/gemini-startup-verification.md` and `docs/qualification/gemini-startup-receipt.json`.

**Interfaces:** Consume the existing `inspectProviderControls(...)` evidence/recipe and `runProviderSession(assignment, hash)` path. Preserve recipe/assignment schemas, source-hash admission, native audits and other-provider behavior. Produce truthful Gemini startup evidence and zero input after any known startup failure.

- [ ] Write RED regressions for successful1.4.12 stderr-help, exact packet discovery argument, absent/null AGY init.agent rejection and parsed post-ready error before input. Before writing, name the production change each test catches. Use real child fixtures for stream races. Keep the actual60-tool captured init as a protective characterization, not a new RED bug.
- [ ] Run the focused tests on unchanged production code and save exact RED result and source hashes.
- [ ] Acquire the AGY public launch syntax using recognizable successful help and every required recipe flag (`--model`, `--effort`, `--agent`, `--add-dir`, `--mode`, `--sandbox`, `--settings`, `--input-format`, `--output-format`, `--print-timeout`). Keep public-help acquisition independent of version strings and a separate startup/source contract covering inspected1.4.11/current1.4.12; a future version with identical help must remain unverified for startup-source closure. Record a RED test before adding this guard if the intermediate candidate omitted it. Keep observed version/executable/help/source fingerprinted and effective controls fail-closed. Codex/Cursor version paths stay unchanged.
- [ ] Add supported `--add-dir` with the exact packet cwd for AGY discovery. Do not broaden workspace roots or write an agent outside the packet folder. Keep collision/content checks. Keep existing trust and hook prerequisites unchanged pending separate qualifying evidence.
- [ ] Require a nonmissing exact selected agent when the AGY recipe binds one. Extend the final queued-parser error guard to AGY before call reservation/input mutation. Keep nonempty init.tools rejected with zero input; preserve other-provider behavior and post-input rules.
- [ ] Run focused checks, typecheck and build. Record source/build manifest, full `npm test -- --maxWorkers 2` results, any failures and limitations. No silent suite failure omission.
- [ ] Write sanitized public reproduction/fix evidence separating Council refusal, diagnostic provider initialization, unqualified tool/trust/hook boundaries and code-test evidence. Never describe init-only probes as a Council discussion or operational #3 completion.
- [ ] Commit only named source/test/public record files and return report, commits, RED/GREEN/check results, manifest and remaining operational gates. Root dispatches fresh reviewers against frozen bytes and adjudicates every finding.
