# Gemini inventory custody correction

This checkpoint records correction `85e9a3a5206d5087ceecbf59e4314b02fa3611b0`. It improves the inventory mechanics described in [the original checkpoint](agy-inventory-witness-mechanics.md). Production startup acquisition, audit adoption, reuse and retained-recipe launch still do not consume the witness. Issue #3 remains open.

## Corrected behavior

Traversal ancestors establish device, inode, owner, group, mode and type custody. Selected files and listed directories retain full identity checks, including ctime. Static observations retain full identity and membership consistency at and beneath the requesting workspace, with narrower custody comparisons strictly above it.

Simply removing ancestor timestamp checks introduced two reproduced regressions: a separately opened directory stream could contain substituted names, and two transient parent replacements could make an existing file appear absent. Exact original-source controls refused both cases. The correction now retains bounded namespace guards around separately named stream, unknown-child-type and final absence acquisitions. Appeared or ambiguous missing edges remain unknown without consuming payload.

The [Node22 directory API](https://nodejs.org/docs/latest-v22.x/api/fs.html#fsopendirsyncpath-options) opens a stream by path; the documented stream API does not expose the descriptor checked by `openSync`. The conservative guards therefore still refuse ambiguous ancestor namespace changes during those short acquisitions, including harmless churn. This is not universal noise tolerance or an atomic filesystem snapshot.

The two unit suites now use distinct checked-in fixture parents and remove only their own disposable containers. Every existing assertion, deliberate sibling/substitution action, budget and production guard remains. Default parallelism, timeouts, global TMPDIR and other suites are unchanged.

## Verified results

Runtime: macOS, Node `v22.23.4`, npm `10.9.9`.

| Check | Recorded result |
| --- | --- |
| Build and typecheck | Passed |
| Six independent noise, custody and substitution probes | 6 passed |
| Two affected suites, default parallelism | 139 passed |
| Nine-file check inside the Sol worker | 607 passed, 31 failed; both inventory suites passed |
| One default root `npm test`, bounded to 600 seconds | 1,527 passed, 14 failed; 69 passed and 3 failed files |
| Compiled provenance | All 139 compiled-file hashes retained; unchanged through covering checks |

The worker's 31 failures occurred in untouched provider-session and hook suites. Their causes remain unclassified. The root full run's 14 failures occurred in `cache-composition.test.ts`, `context-wrapper.test.ts` and `discovery.test.ts`; the nine targeted inventory/provider/audit files had no failures in that full run. Nine failing case names overlap the original full-run record; five were not observed there. Name overlap does not establish a common cause. Discovery's version-table cases timed out in a fake native-host fixture; these results do not establish a real Orca version restriction.

The full-test supervisor initially reported one surviving owned `context-provider.cjs` fixture child and returned 125 while npm returned 1. The coordinator verified its recorded ownership and stopped it with SIGTERM. All 1,135 observed owned PIDs and groups, plus wrapper and bounded runner, were absent afterward. The original failure and separate cleanup receipts remain preserved. This is not a claim that automatic fixture cleanup passed.

The [structured record](agy-inventory-custody-correction.json) contains exact source and log hashes, full-run failure names, bounds and lifecycle qualifications. Original RED, interim failed checks and original review reports remain retained. No full-suite or merge-readiness pass is claimed.

## Remaining acceptance work

The installed loader's path/boundary rules, selection/order/agent inheritance, enablement initialization/error branches, complete parser membership and exact normalization participation still require applicable evidence. No guessed resolver, plugin disabling, version allowlist, creation grant or startup authority was added.

Standalone recipe/path consistency, selected-agent/static-file consistency, intended settings validation and a machine-readable creation contract remain prerequisites before future integration. Witness integrity and physical observations do not establish semantic completeness, effect approval or runtime qualification. Cursor and other issue implementations were not changed.

At this verification checkpoint, the initial whole-increment review was failed and the corrected artifact was prepared for its one scoped Astra Ultra and Argon high re-review through Orca. That review is recorded separately after these bytes are frozen; this document does not predeclare its outcome.
