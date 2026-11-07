# Gemini hook binary contract investigation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the installed AGY hook environment contract without provider calls or configuration changes.

**Architecture:** Read the installed binary's bounded hook and process-launch functions. Verify each decoded name and address against its Go metadata. Keep any unproved caller or environment mutation explicit. Do not promote a repair from a name match alone.

**Tech Stack:** AGY 1.4.12 ARM64 Mach-O, Go PC metadata, LLVM disassembly.

**Spec:** docs/superpowers/specs/2026-10-31-council-audit-refresh.md

## Global constraints

Use Astra Ultra through the qualified Orca read-only route. Read `/Users/aaat/.agents/policies/model-policy.md`. Do not edit or execute the inspected binary. Do not call providers or helpers. Do not read endpoint or credential files. Do not change source, settings, hooks, trust, permissions, billing or Cursor. Read only relevant installed code and task-owned evidence. Preserve unknowns.

## Review focus

- A symbol name does not prove a function's semantics.
- A copied section name does not establish instruction provenance.
- Process-global environment mutations can occur before hook launch.
- Wrapper methods can change subprocess arguments or environment.
- A runtime probe alone cannot prove all future executions.

### Task 52: Verify the installed hook launch path

**Files:** Read `.superpowers/sdd/2026-10-31-council-audit-refresh/gemini-hook-binary-inspection/disassembly-manifest.json`, the listed `.asm` files, the installed `/Users/aaat/.local/bin/agy` as static data, and `src/pilot/provider-session.ts`. Produce a final report through the supervisor in `.superpowers/sdd/2026-10-31-council-audit-refresh/gemini-hook-binary-contract/report.md`.

**Interfaces:** Consume exact installed bytes and bounded decoded functions. Produce verified shell arguments, environment construction, wrapper effects, missing premises and a precise next action. The coordinator owns later qualification and implementation.

- [ ] Verify the binary SHA256 and PC metadata mapping. The code bytes come directly from the installed binary. Do not execute the data-only copy.
- [ ] Trace `jsonhook.executeCommandModeHook` through `jexec.(*Cmd).Output`, `prepareEnv` and `os/exec` environment handling. Decode static string constants where needed.
- [ ] Check whether prior process-global environment mutation can add hook variables. Identify relevant callers or keep the gap explicit.
- [ ] State the exact conditions under which endpoint sourcing and spool/network paths are absent. Do not claim mathematical proof from one observation.
- [ ] Propose the smallest source-bound repair only if its premises have evidence. Otherwise return one bounded next experiment.
- [ ] Verify actual model, tools, protected inputs and full settlement externally.

**Expected result:** The report has instruction-address evidence for every accepted environment premise. Missing premises remain explicit. No implementation is part of this task.

## Later roadmap

Review the exact report with fresh Argon high. Refine and review a repair only when the contract is supported. Preserve meaningful RED before any production edit. Keep complete effect review, authenticated audit adoption and Gemini runtime qualification separate. Cursor remains outside scope.

## Authoring and language check

This ready task is evidence-only. The later implementation remains provisional. Its files, actions and expected evidence are explicit. This is an Issue 9-oriented language candidate. The official dictionary and governed glossary are unavailable. Technical literals remain exact.
