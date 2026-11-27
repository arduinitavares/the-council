# Legacy CLI Backend Model Parity

This project does not add new model families or effort-selector parity to the legacy local CLI adapters (`--backend cli`).

## Why this is out of scope

Per `docs/adr/0005-t3-mcp-harness-dispatch.md`, the T3 MCP backend (`--backend t3`) is the primary multi-family execution path and already supports `gemini-4-neon` (`xhigh`), `gemini-4-hydrogen` (`xhigh`), `gemini-4-carbon`, `gpt-6.2-*`, `claude-*-5-5`, and `grok-4.7` dynamically through `orchestrator_capabilities`.

The legacy local CLI backend (`--backend cli`) is retained as a frozen compatibility path for rollback and operators who need OS-level `read-only` sandboxing or filtered `.council/` copies (per ADR-0005), without expanding its model-family allowlists. Tracking new CLI model slugs and effort flags across raw `agy`, `codex`, and `cursor-agent` subprocess wrappers adds maintenance churn without advancing the supported T3 architecture.

## Prior requests

- #116: "feat(antigravity): admit gemini-4-neon selectors and preserve xhigh effort"
