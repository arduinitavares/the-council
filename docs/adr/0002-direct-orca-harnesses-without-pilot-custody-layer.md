# Direct Orca Harness Dispatch Without the Pilot Custody Layer

We are starting clean and discarding the 18,748-line `src/pilot/` pre-qualification and process-custody subsystem (which stalled development for three weeks on hook inventories, qualification caches, and CI process-group wrappers). The XState Council runner will dispatch Seats and the Judge directly through Orca across `codex`, `antigravity`, and `cursor`, and we will validate the state machine and deliberation rules first in a self-contained HTML logic prototype before wiring production CLI calls.
