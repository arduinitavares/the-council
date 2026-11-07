Source: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex, read 2026-10-31.
Coordinator summary of official guidance, supplied as evidence to verify:
A goal defines outcome, verification, constraints, permitted boundaries, iteration policy and a blocked stop condition. A draft should be reviewed before activation. Completion needs concrete observed files/tests/logs/artifacts, not belief or narration. A goal is persistent thread state and can continue across idle turns; user interruption, pause, budget limits or genuine blockers can stop continuation. Its scope is user-controlled and not unlimited background autonomy.
Repository package.json verified scripts: npm test = vitest run; npm run typecheck = tsc --noEmit -p tsconfig.json; npm run build = tsc -p tsconfig.build.json, with postbuild copy-assets. Issue #8 explicitly requires bounded repeated default-concurrency runs with a predeclared repetition budget, not an invented fixed number or global serialization.
Goal-prompt formatter accepts at most 4000 characters including /goal. Current draft is under the limit. A progress log is specified for continuation across compaction.
This assignment reviews the prompt and approved scope, not whether all external live capabilities already exist.

