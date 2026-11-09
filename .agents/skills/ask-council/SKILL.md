---
name: ask-council
description: Deliberate technical, architectural, product comparison, or security questions across multi-model AI seats using proof-backed consensus, real-time live visualization, and bounded dissent reports.
---

# Ask Council (`/ask-council`)

A deliberation system where an arbitrary roster of AI seats—each combining a harness (`codex`, `antigravity`, `cursor`), model, and temperament ("Soul")—debates a topic using verifiable proofs until reaching unanimous consensus or a bounded dissent report.

Use this skill whenever the user asks for a Council deliberation, invokes `/ask-council <question>`, or needs rigorous multi-model consensus on hard technical or trade-off decisions.

---

## 1. Trigger Syntax

```bash
/ask-council <question or topic handoff>
```

Examples:
- `/ask-council Should we adopt Event Sourcing or CRUD with CDC for our order ledger?`
- `/ask-council Which smartphone is the best value under R$ 1000 in Brazil?`
- `/ask-council Security audit of OAuth2 PKCE callback handler implementation`

---

## 2. Choosing a Preset or Custom Config

The Council provides 4 built-in presets tailored to common deliberation domains:

| Preset Name | Seat Roster | Judge | Best Used For |
|---|---|---|---|
| `architecture` | 4 seats: `astra-systems` (`codex` / `gpt-6-astra (max)`), `sol-pragmatic` (`codex` / `gpt-6.1-sol (high)`), `argon-staff` (`antigravity` / `gemini-4-argon-high`), `opus-domain` (`antigravity` / `claude-opus-5-5-high`) | `judge-opus` (`antigravity` / `claude-opus-5-5-high`) | Systems architecture, boundary isolation, deep modules, microservices vs. monoliths, distributed systems trade-offs. |
| `product-comparison` | 4 seats: `astra-specs` (`codex` / `gpt-6-astra (max)`), `astra-ux` (`codex` / `gpt-6-astra (max)`), `argon-value` (`antigravity` / `gemini-4-argon-high`), `grok-skeptic` (`cursor` / `grok-4.7-high`) | `judge-opus` (`antigravity` / `claude-opus-5-5-high`) | Product, hardware, benchmark, or tooling comparisons (e.g. OS comparison, phone comparisons). |
| `security-audit` | 3 seats: `astra-secops` (`codex` / `gpt-6-astra (max)`), `opus-threat` (`antigravity` / `claude-opus-5-5-high`), `argon-supplychain` (`antigravity` / `gemini-4-argon-high`) | `judge-astra` (`codex` / `gpt-6-astra (max)`) | Vulnerability analysis, threat modeling (STRIDE), injection vectors, supply chain and SBOM audits. |
| `argon-only` | 3 seats: `argon-systems`, `argon-pragmatic`, `argon-skeptic` (all `antigravity` / `gemini-4-argon-high` with distinct Souls) | `judge-argon` (`antigravity` / `gemini-4-argon-high`) | Fast, token-efficient consensus mode when conserving quota or running routine checks. |

### Pre-Saved Custom Configurations (`configs/`)
- [`configs/best-of-families.json`](../../configs/best-of-families.json): **Best-of-Each-Family Roster** — Judge: `judge-astra` (`codex` / `gpt-6-astra (max)`); Voters: `sol-voter` (`codex` / `gpt-6.1-sol (max)`), `argon-voter` (`antigravity` / `gemini-4-argon-high`), `opus-voter` (`antigravity` / `claude-opus-5-5-high`), `grok-voter` (`cursor` / `grok-4.7-xhigh`). Works from any working directory via `-p best-of-families` or `-c configs/best-of-families.json`:
  ```bash
  /Users/aaat/projects/the-council/bin/council run --live -p best-of-families -t "<question>" -v
  ```

### When to Generate a Custom JSON Configuration (`-c <config.json>`)
If the question demands domain-specific temperaments (Souls) that aren't covered by the presets, generate a custom JSON file.

**Example: "Best smartphone under R$ 1000"** (`phone-council.json`):
```json
{
  "topic": "Which smartphone under R$ 1000 provides the best longevity and camera performance in Brazil?",
  "maxRounds": 3,
  "minQuorum": 2,
  "judge": {
    "id": "judge-opus",
    "harness": "antigravity",
    "model": "claude-opus-5-5-high",
    "soul": "Impartial Product Judge: admits verified hardware and retail benchmark proofs and synthesizes context-partitioned candidates."
  },
  "seats": [
    {
      "id": "bench-hardware",
      "harness": "codex",
      "model": "gpt-6-astra (max)",
      "soul": "Hardware Benchmark Specialist: verifies SoC benchmarks (AnTuTu/Geekbench), RAM/storage type (UFS vs eMMC), and display refresh rates."
    },
    {
      "id": "camera-audio",
      "harness": "codex",
      "model": "gpt-6-astra (max)",
      "soul": "Mobile Imaging Reviewer: evaluates sensor size, aperture, optical stabilization, and low-light sample proofs."
    },
    {
      "id": "price-latam",
      "harness": "antigravity",
      "model": "gemini-4-argon-high",
      "soul": "Brazilian Retail & Value Analyst: tracks historical Anatel-certified street pricing, import taxes, warranty support, and long-term battery degradation."
    },
    {
      "id": "skeptic-durability",
      "harness": "cursor",
      "model": "grok-4.7-high",
      "soul": "Independent Skeptic: challenges vendor bloatware, OS update longevity, drop-test results, and repairability indices."
    }
  ]
}
```

---

## 3. Real-Time Live Visualizer

The Council includes a real-time, browser-based Observer Visualizer at `/Users/aaat/projects/the-council/src/visualizer/index.html`.

1. **Open the visualizer** in your browser (works from any working directory):
   ```bash
   open /Users/aaat/projects/the-council/src/visualizer/index.html
   ```
2. **Follow in Live Follow Mode & Switch Runs**:
   - The visualizer automatically detects active and historical runs in `/Users/aaat/projects/the-council/.council/runs/` (`latest.js`, `index.js`, and `<runId>.js`).
   - Click the **"Live Follow (Auto-Sync)"** toggle or select any previous run in the `#run-selector` dropdown in the top-right toolbar.
   - The UI reloads live run telemetry every 1 second over `file://` without CORS issues.
   - You will see:
     - Real-time seat status badges (`THINKING`, `PROOF_SUBMITTED`, `ACCEPTED`, `OBJECTED`, `EXCUSED`).
     - SVG state machine transitions (`preflight` → `clarifying` → `reviewing` → `judging` → `confirming` → `completed`).
     - Causal Dependency Flow arrows illustrating which Proofs support which Candidate Clauses.

---

## 4. Execution Workflow

### Step 0: Evidence Gathering & Grounding (`--evidence` / `evidence` config key)
Before launching a Council deliberation on time-sensitive, retail, pricing, benchmark, or empirical questions, gather verified facts first (using web search, official documentation, or repository inspection) and pass them into The Council so every Seat and the Judge deliberate over a shared, immutable ground-truth packet rather than relying on stale training weights or redundant per-seat web searches.

1. **Via `--evidence <file>` (`-e`, repeatable)**:
   - Pass a JSON file containing an array of `{ "label", "source", "text" }` objects (or `{ "evidence": [...] }`), or pass a plain Markdown/text file (`--evidence notes.md`), which is automatically wrapped as a labeled evidence item:
     ```bash
     /Users/aaat/projects/the-council/bin/council run --live -p best-of-families \
       -t "Which smartphone under R$ 1000 is the best buy in Brazil right now?" \
       --evidence /tmp/brazil-phones-2026.json -v
     ```
2. **Via `evidence` and `clarifications` in custom JSON config**:
   - `evidence`: Array of `{ "id"?: "E1", "label": string, "source": string, "text": string }` items (bounded to 20 items, 32,768 chars per item, 131,072 chars total). Frozen into `state.evidence` and injected into every Seat deliberation prompt (`[E1] <label> (Source: <source>): <text>`), Seat voting prompt, and Judge audit/synthesis prompt.
   - `clarifications`: Optional array of `{ "batch"?: number, "question"?: string, "answer": string }` (or `{ "label", "source", "text" }`) items broadcast across Discovery batches before Round 1 begins.
   ```json
   {
     "topic": "Which smartphone under R$ 1000 provides the best longevity and camera performance in Brazil?",
     "preset": "best-of-families",
     "evidence": [
       {
         "label": "Anatel & Retail Street Pricing (May 2026)",
         "source": "Zoom / Buscapé Brazil retail tracker",
         "text": "Moto G34 5G (8GB/128GB, Snapdragon 695, UFS 2.2) is R$ 899; Galaxy A15 4G (4GB/128GB, Helio G99, Super AMOLED 90Hz) is R$ 849."
       }
     ],
     "clarifications": [
       {
         "question": "Are used or imported grey-market devices eligible?",
         "answer": "No — only new, Anatel-certified devices with local 1-year warranty in Brazil under R$ 1000."
       }
     ]
   }
   ```

### Step 1: Formulate Command
Using a built-in preset (works from any working directory):
```bash
/Users/aaat/projects/the-council/bin/council run --live -p architecture -t "Should we migrate from REST to gRPC for service-to-service communication?" -v
```

Using a custom configuration file:
```bash
/Users/aaat/projects/the-council/bin/council run --live -c phone-council.json -v
```

### CLI Flag Reference
- `-p, --preset <name>`: Select built-in preset (`architecture`, `product-comparison`, `security-audit`, `argon-only`, or `best-of-families`).
- `-e, --evidence <path>`: Path to a JSON or Markdown/text evidence file (repeatable). Merges with any `evidence` array in `-c <config.json>` and injects `[E1] <label> (Source: <source>): <text>` into all Seat and Judge prompts.
- `-l, --live`: **Required for real deliberations** (unless `--mock` is explicitly passed). Run with live CLI harness dispatchers (`codex`, `agy`, `cursor-agent`), automatically enforcing `--ephemeral` session isolation on Codex, and stream telemetry to `/Users/aaat/projects/the-council/.council/runs/`. Sets `"mode": "live"` in `--json` output.
- `-m, --mock`: Run in hermetic deterministic simulated mock mode for offline testing only (required unless `--live` is passed). Prints a prominent `SIMULATED (mock harness): not a real deliberation` banner at the top and bottom of human output and sets `"mode": "mock"` in `--json` output. `council run` requires an explicit `--live` or `--mock` flag and fails fast if neither is specified.
- `-t, --topic <string>`: Problem statement or topic handoff.
- `-c, --config <path>`: Path to custom JSON configuration file (resolved against current working directory first, then `<packageRoot>/` and `<packageRoot>/configs/`).
- `-r, --rounds <number>`: Maximum deliberation rounds (default: 3).
- `-q, --quorum <number>`: Minimum quorum of active seats (default: 2).
- `-v, --verbose`: Stream real-time transition and seat telemetry to stderr.
- `--json`: Emit full deliberation state, execution `mode` (`"live"` or `"mock"`), candidate, objections, and snapshots as JSON.

---

## 5. Verdict Interpretation

The CLI prints the consensus deliberation outcome in an answer-first structured format:

```text
========================================
         THE COUNCIL — VERDICT          
========================================
Mode    : LIVE
Topic   : Should we migrate from REST to gRPC for service-to-service communication?
Verdict : Unanimous Consensus
Rounds  : 1
Judge   : judge-opus (antigravity / claude-opus-5-5-high)
Seats   : 4 total (4 active, 0 excused)

Final Answer:
  Adopt gRPC with Protobuf for internal service-to-service RPC behind the API Gateway while retaining REST / OpenAPI 3.1 at the public edge.

Candidate Clauses:
  - [C1] Internal Services: Adopt gRPC with Protobuf for internal, high-throughput microservices behind the API Gateway. (Cited: P1, P3, P4)
  - [C2] Public Ingress: Retain REST / OpenAPI 3.1 at the public edge gateway for external partners and web clients. (Cited: P2)

Seat Roll Call:
  - [ACCEPTED] astra-systems (codex / gpt-6-astra (max)) — Proofs: P1 (admitted)
  - [ACCEPTED] sol-pragmatic (codex / gpt-6.1-sol (high)) — Proofs: P2 (admitted)
  - [ACCEPTED] argon-staff (antigravity / gemini-4-argon-high) — Proofs: P3 (admitted)
  - [ACCEPTED] opus-domain (antigravity / claude-opus-5-5-high) — Proofs: P4 (admitted)

Submitted Proofs:
  - [P1] (admitted) [benchmark] High-throughput RPC — "Netty vs HTTP/1.1 JSON benchmark": Protobuf serialization reduces CPU overhead by 68% and payload size by 42%.
    Seat : astra-systems | Judge Note: Admitted — verified benchmark methodology.
  - [P2] (admitted) [citation] Developer Tooling — "OpenAPI 3.1 tooling survey": REST ecosystems maintain broader client generator and public gateway support.
    Seat : sol-pragmatic | Judge Note: Admitted — supports edge gateway boundary.
  - [P3] (admitted) [check] Boundary Isolation — "Architecture seam audit": Internal service boundaries benefit from strict .proto contract compilation.
    Seat : argon-staff | Judge Note: Admitted — verified schema contract checks.
  - [P4] (admitted) [citation] Blast Radius — "Envoy gRPC load balancing RFC": HTTP/2 connection reuse requires L7 client-side load balancing to prevent backend hotspotting.
    Seat : opus-domain | Judge Note: Admitted — incorporated into internal service clause.

Note: All 4 active Seats accepted the Proof-bound Candidate in Round 1 with zero unresolved Objections.
========================================
```

### Verdict Kinds
- **Unanimous Consensus**: Every active Seat accepted the Candidate, minimum quorum was maintained, and zero unwithdrawn Objections remain.
- **Dissent Report (Preserved Excused-Seat Objection)**: Active seats reached consensus, but an excused seat hit a quota limit with an open objection that was locked into the verdict.
- **Dissent Report (Round Limit Reached)**: Open objections remained after reaching `--rounds` limit. Inspect `Unresolved Objections:` to understand the technical divide.
- **Dissent Report (Below Quorum)**: Seat quota excusals dropped active seats below `--quorum`.

---

## 6. Model Reasoning Effort & Session Isolation

### Supported Reasoning Effort Tiers
Council seat models on the Codex harness support explicit reasoning effort tiers specified either in parentheses (e.g., `gpt-6-astra (max)`) or with a recognized suffix (e.g., `model-name-high`):

| Effort Tier | Codex Flag Applied | Use Case |
|---|---|---|
| `max` | `-c model_reasoning_effort="max"` | Deepest analytical proofs, complex security audits, high-stakes trade-off consensus. |
| `xhigh` | `-c model_reasoning_effort="xhigh"` | Extended reasoning for intricate multi-component architectural decisions. |
| `high` | `-c model_reasoning_effort="high"` | Standard default for balanced speed and reasoning depth. |
| `medium` | `-c model_reasoning_effort="medium"` | Faster deliberation cycles for moderate complexity topics. |
| `low` | `-c model_reasoning_effort="low"` | Fast consensus exploration or token-conserving runs. |

*Note on `max` Preservation*: The Council passes `max` directly to Codex CLI without downscaling. If an unsupported effort tier is specified (e.g., `ultra`, `turbo`), the engine immediately throws a configuration error:
`Unsupported reasoning effort "<effort>". Allowed: low, medium, high, xhigh, max.`

### Ephemeral Run Isolation & Hook Suppression
1. **Disk Session Isolation (`--ephemeral`)**:
   During `--live` execution, each seat turn and judge turn is executed with `codex exec --ephemeral`. This prevents persistent session files from accumulating in `~/.codex/sessions` across multi-round deliberations.
2. **Hook Suppression (`--disable hooks`) & Authentication Preservation**:
   `runCodexCli` also passes `--disable hooks` (equivalent to `-c features.hooks=false`) by default. This suppresses user hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) from firing on internal Council prompts and tool calls while preserving `$CODEX_HOME/config.toml` and `$CODEX_HOME/auth.json` authentication. Hooks can be re-enabled if desired via `disableHooks: false`.
3. **Full Config Isolation (`--ignore-user-config`)**:
   For environments that also want to skip `$CODEX_HOME/config.toml` entirely, `ignoreUserConfig: true` passes `--ignore-user-config` (skipping `config.toml` while authentication still uses `CODEX_HOME`).
4. **Telemetry, Structured Event Traces & Sanitization**:
   Live runs record provider call telemetry in `engine.getTelemetry().getProviderCalls()`, `result.providerCalls`, and `window.CouncilLatestLiveRun.providerCalls`, including `participantId`, `provider`, `tools`, `durationMs`, `exitCode`, normalized `trace` (`traceCoverage: 'full' | 'partial' | 'unavailable'`, `toolCalls`, `skillsRead`), and sanitized `argv` where deliberation prompts are redacted to length and SHA-256 hash (including on non-zero CLI exits).
5. **Cross-Run Voter & Tool Telemetry Leaderboard (`council telemetry`)**:
   At run completion, The Council persists an immutable per-run telemetry record to `.council/telemetry/runs/<runId>.json` and projects `.council/runs/telemetry-summary.{json,js}` for the browser visualizer and CLI leaderboard:
   ```bash
   /Users/aaat/projects/the-council/bin/council telemetry
   /Users/aaat/projects/the-council/bin/council telemetry --days 7 --by seat
   /Users/aaat/projects/the-council/bin/council telemetry --by model --json
   ```

---

## 7. Tool Policies, Concurrency & Time Budgets

### Tool Access Policies (`tools: 'none' | 'read-only'`)
The Council enforces strict tool boundary policies across all seats and the Judge:
- `'read-only'` (Default): Seats are provided with read-only inspection capabilities and prompt verification directives. Participants are instructed to inspect relevant codebases, standards, benchmarks, or documents before asserting facts or casting votes. The Judge is directed to spot-check submitted proof citations before admitting them.
- `'none'`: Pure reasoning mode with zero tool invocations. Verification prompt directives are omitted.
- **Write Capabilities Strictly Forbidden**: Specifying `write`, `read-write`, or unapproved tools immediately fails configuration validation naming the allowed values (`none`, `read-only`). For `cursor-agent`, CLI executions automatically enforce `--trust`, `--output-format stream-json`, `--mode plan`, and `--sandbox enabled`.

### Parallel Deliberation & Voting Concurrency (`maxConcurrentSeats`)
- Seat turns within Deliberation (Proof Collection) and Confirmation (Voting) execute concurrently up to `maxConcurrentSeats` (defaulting to the roster length, or 10).
- Results are reduced onto the Council state machine in strict roster order, guaranteeing reproducible proof IDs (`P1, P2...`) and objection IDs (`O1, O2...`) regardless of completion timing.

### Dynamic Effort-Scaled Time Budgets (`timeoutMs`)
Per-turn time budgets can be configured at the top level or overridden on individual seats or the judge. If omitted, timeouts dynamically scale based on the model's reasoning effort:

| Effort Tier | Models / Suffixes | Default Timeout |
|---|---|---|
| `max` / `xhigh` | `gpt-6-astra (max)`, `gpt-6.1-sol (xhigh)` | 240,000 ms (4.0 min) |
| `high` | `gemini-4-argon-high`, `claude-opus-5-5-high`, `*-high` | 120,000 ms (2.0 min) |
| `medium` / `low` | `claude-sonnet-4-5-medium`, `*-medium`, `*-low` | 60,000 ms (1.0 min) |
| Fallback | Models without explicit effort tier | 60,000 ms (1.0 min) |

*Resilient Output Parsing*: Model outputs preceded by tool execution logs or multiple markdown code blocks are parsed using reverse evaluation and balanced-brace JSON tracking, ensuring robust extraction even during extensive investigation chatter.

### Recommended Configuration for Deep Research Questions
For empirical or codebase-heavy questions, configure `tools: 'read-only'` with generous timeouts:
```json
{
  "topic": "Audit src/engine/council-engine.js for race conditions under concurrent seat execution",
  "maxConcurrentSeats": 4,
  "timeoutMs": 120000,
  "judge": {
    "id": "judge-opus",
    "harness": "antigravity",
    "model": "claude-opus-5-5-high",
    "soul": "Impartial Concurrency Auditor",
    "tools": "read-only",
    "timeoutMs": 180000
  },
  "seats": [
    {
      "id": "astra-concurrency",
      "harness": "codex",
      "model": "gpt-6-astra (max)",
      "soul": "Distributed Systems & Concurrency Purist",
      "tools": "read-only"
    },
    {
      "id": "sol-race-tester",
      "harness": "codex",
      "model": "gpt-6.1-sol (high)",
      "soul": "Race Condition & State Invariant Specialist",
      "tools": "read-only"
    }
  ]
}
```
