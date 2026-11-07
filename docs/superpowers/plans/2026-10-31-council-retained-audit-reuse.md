# Verify retained native audit reuse

### Task 40: Prove and repair retained audit reuse after coordinator rebinding

**Graph ID:** `repair-native-audit-reuse`

**Files:**
- Modify only after a meaningful RED: `src/pilot/control-audit.ts`.
- Test: `test/pilot/control-audit.test.ts`.
- Update test-only native metadata parity if required: `test/pilot/context-fixture.ts`.
- Create current reports: `.superpowers/sdd/2026-10-31-council-audit-refresh/task40-audits/{openai,gemini,judge}.json`.
- Create the new frozen producer manifest: `.superpowers/sdd/2026-10-31-council-audit-refresh/task40-producer-manifest.json`.
- Create task reports and logs only under this plan workspace. The parent owns these evidence and rebuild commands.
- Rebuild: `dist/` through the existing build command.
- Preserve: every snapshot, disposition, native record and global setting.

**Interfaces:**
- Consumes: the actual two-role adoption and retained-record comparison.
- Requires: fresh Argon review of this proposal and qualified Astra Ultra native edits.
- Produces: a bounded fix, test evidence, a frozen build and independent Argon review.

The first audit was adopted while its native Run had the expected owner.
The same terminal then created a second Run for the judge audit.
Orca cleared the first Run's coordinator and advanced its consumer generation.
The first Task and its successful result stayed unchanged.
The first disposition now returns `AUDIT_NATIVE_DISPOSITION_UNVERIFIED`.
The judge disposition still verifies.
No source or producer drift occurred.

The user explicitly requested only Astra Ultra and Argon high for code and reviews through Orca.
The canonical policy gives this session instruction precedence over its default implementer table.
The disposable Astra Ultra native edit qualification passed on this host and sandbox.
Native helpers remain unqualified and must not launch.

The proposed distinction is between new adoption and retained reuse.
New adoption must still verify the current native coordinator.
Retained reuse may use the saved identity only if the durable Run, Task,
Dispatch, creator, reporter, incarnation, workspace, message and body bindings
prove the same completed native approval.
A coordinator handoff alone must not fabricate or replace those bindings.
The independent reviewer must assess whether this preserves the intended authority contract.
Do not implement if the evidence instead establishes intentional revocation.

- [ ] Independently verify the diagnosis and proposed authority contract.
- [ ] Qualify Astra Ultra native create and edit actions in a disposable case.
- [ ] Write a regression for retained reuse after a real-shaped Run owner change.
- [ ] Record its meaningful RED on unchanged production before any implementation edit.
- [ ] Preserve strict current-owner checks for initial adoption.
- [ ] Preserve all existing Task, Dispatch, identity, body, source and hash guards.
- [ ] Require the exact current native root provenance fields. Do not default missing fields to safe values.
- [ ] Require Run identity and nonlegacy marker `legacy === 0`.
- [ ] Require positive integer Run consumer and Task creation generations.
- [ ] On initial adoption, require the actual current coordinator and equal Run/Task generations.
- [ ] On retained reuse, require the saved identity, with Run generation at least Task creation generation for the same owner, and strictly greater for a changed or null owner.
- [ ] Require Task `run_id`, explicit null `parent_id`, completed status and matching creator identity, pane and incarnation.
- [ ] Require both successful-result `reportedBy` and `completedBy` to match the authenticated coordinator identity.
- [ ] Require Dispatch creator handle and pane to match that identity.
- [ ] Require explicit null creator-dispatch, retry and termination fields, depth one and failure count zero.
- [ ] Preserve all current assignee, incarnation, workspace, task/result/body/hash and stored-reference comparisons.
- [ ] First prove a valid real-shaped unbound baseline with Run generation two and Task creation generation one.
- [ ] From that valid baseline, mutate each saved identity/ID, Run, Task, Dispatch and result provenance field separately.
- [ ] For each negative, assert refusal, restore the complete baseline and reassert successful verification. This prevents catch-all errors from masking invalid fixtures.
- [ ] Cover null and different current owners, missing or malformed metadata, nested worker tasks, retries, failure/termination state, forged creators/completers and generation rollback.
- [ ] Keep any test fixture parity changes limited to current native audit fields and preserve unrelated fixture behavior.
- [ ] Implement only the demonstrated failure in the allowed source file.
- [ ] Run focused tests, typecheck, build and the required full suite.
- [ ] Freeze source and build bytes before fresh independent Argon review.
- [ ] Verify every review finding against the actual diff and evidence.
- [ ] Regenerate current audit reports and the producer manifest after the fix.
- [ ] Verify unchanged effect sets and explicit Gemini blockers.
- [ ] Review current effect reuse against the new producer before reuse.
- [ ] Read both actual adopted audits through the rebuilt public verifier.
- [ ] Keep the old references and native records unchanged.

**Completion check:** Both real retained role dispositions verify after the narrow fix. Durable Dispatch comparisons exclude only redacted secret-bearing lifecycle fields; they compare every actual authority field explicitly. New adoption and all negative provenance checks remain strict. No Cursor or Gemini exception is introduced. Full three-role acceptance remains blocked by Gemini.
