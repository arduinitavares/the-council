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
| `architecture` | 4 seats: `astra-systems` (Codex Astra Max), `sol-pragmatic` (Codex Sol High), `argon-staff` (Antigravity Argon High), `opus-domain` (Antigravity Opus High) | `judge-opus` (Antigravity Claude Opus High) | Systems architecture, boundary isolation, deep modules, microservices vs. monoliths, distributed systems trade-offs. |
| `product-comparison` | 4 seats: `astra-specs` (Codex Astra Max), `astra-ux` (Codex Astra Max), `argon-value` (Antigravity Argon High), `grok-skeptic` (Cursor Grok Skeptic) | `judge-opus` (Antigravity Claude Opus High) | Product, hardware, benchmark, or tooling comparisons (e.g. OS comparison, phone comparisons). |
| `security-audit` | 3 seats: `astra-secops` (Codex Astra Max), `opus-threat` (Antigravity Opus High), `argon-supplychain` (Antigravity Argon High) | `judge-astra` (Codex Astra Max) | Vulnerability analysis, threat modeling (STRIDE), injection vectors, supply chain and SBOM audits. |
| `argon-only` | 3 seats: `argon-systems`, `argon-pragmatic`, `argon-skeptic` (all Antigravity Gemini 4 Argon High with distinct Souls) | `judge-argon` (Antigravity Gemini 4 Argon High) | Fast, token-efficient consensus mode when conserving quota or running routine checks. |

### Pre-Saved Custom Configurations (`configs/`)
- [`configs/best-of-families.json`](../../configs/best-of-families.json): **Best-of-Each-Family Roster** — Judge: `judge-astra` (`codex` / `gpt-6-astra (max)`); Voters: `sol-voter` (`codex` / `gpt-6.1-sol (max)`), `argon-voter` (`antigravity` / `gemini-4-argon-high`), `opus-voter` (`antigravity` / `claude-opus-5-5-high`). Run with:
  ```bash
  ./bin/council run --live -c configs/best-of-families.json -t "<question>" -v
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
      "model": "grok-4-skeptic",
      "soul": "Independent Skeptic: challenges vendor bloatware, OS update longevity, drop-test results, and repairability indices."
    }
  ]
}
```

---

## 3. Real-Time Live Visualizer

The Council includes a real-time, browser-based Observer Visualizer at `src/visualizer/index.html`.

1. **Open the visualizer** in your browser:
   ```bash
   open src/visualizer/index.html
   ```
2. **Follow in Live Follow Mode**:
   - The visualizer automatically detects active runs via `src/visualizer/live-run-latest.js`.
   - Click the **"Live Follow (Auto-Sync)"** toggle in the top-right toolbar.
   - The UI reloads live run telemetry every 1 second over `file://` without CORS issues.
   - You will see:
     - Real-time seat status badges (`THINKING`, `PROOF_SUBMITTED`, `ACCEPTED`, `OBJECTED`, `EXCUSED`).
     - SVG state machine transitions (`preflight` → `clarifying` → `reviewing` → `judging` → `confirming` → `completed`).
     - Causal Dependency Flow arrows illustrating which Proofs support which Candidate Clauses.

---

## 4. Execution Workflow

### Step 1: Formulate Command
Using a built-in preset:
```bash
./bin/council run --live -p architecture -t "Should we migrate from REST to gRPC for service-to-service communication?" -v
```

Using a custom configuration file:
```bash
./bin/council run --live -c phone-council.json -v
```

### CLI Flag Reference
- `-p, --preset <name>`: Select built-in preset (`architecture`, `product-comparison`, `security-audit`, `argon-only`).
- `-l, --live`: Run with live CLI harness dispatchers (`codex`, `agy`, `cursor-agent`), automatically enforcing `--ephemeral` session isolation on Codex, and stream telemetry to `src/visualizer/live-run-latest.js`.
- `-t, --topic <string>`: Problem statement or topic handoff.
- `-c, --config <path>`: Path to custom JSON configuration file.
- `-r, --rounds <number>`: Maximum deliberation rounds (default: 3).
- `-q, --quorum <number>`: Minimum quorum of active seats (default: 2).
- `-v, --verbose`: Stream real-time transition and seat telemetry to stderr.
- `--json`: Emit full deliberation state, candidate, objections, and snapshots as JSON.

---

## 5. Verdict Interpretation

The CLI prints the consensus deliberation outcome in a structured format:

```text
========================================
         THE COUNCIL — VERDICT          
========================================
Topic   : Should we migrate from REST to gRPC for service-to-service communication?
Verdict : Unanimous Consensus
Rounds  : 1
Seats   : 4 total (4 active, 0 excused)

Submitted Proofs:
  - [P1] (admitted) [benchmark] High-throughput RPC — "Netty vs HTTP/1.1 JSON benchmark": Protobuf serialization reduces CPU overhead by 68% and payload size by 42%.
  - [P2] (admitted) [citation] Developer Tooling — "OpenAPI 3.1 tooling survey": REST ecosystems maintain broader client generator and public gateway support.
  - [P3] (admitted) [check] Boundary Isolation — "Architecture seam audit": Internal service boundaries benefit from strict .proto contract compilation.
  - [P4] (admitted) [citation] Blast Radius — "Envoy gRPC load balancing RFC": HTTP/2 connection reuse requires L7 client-side load balancing to prevent backend hotspotting.

Candidate Clauses:
  - [C1] Internal Services: Adopt gRPC with Protobuf for internal, high-throughput microservices behind the API Gateway. (Cited: P1, P3, P4)
  - [C2] Public Ingress: Retain REST / OpenAPI 3.1 at the public edge gateway for external partners and web clients. (Cited: P2)

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

### Ephemeral Run Isolation & Hook Inheritance
1. **Disk Session Isolation (`--ephemeral`)**:
   During `--live` execution, each seat turn and judge turn is executed with `codex exec --ephemeral`. This prevents persistent session files from accumulating in `~/.codex/sessions` across multi-round deliberations.
2. **Hook Inheritance & Authentication**:
   `--ephemeral` prevents session storage on disk while preserving configuration loading from `$CODEX_HOME/config.toml`. This ensures existing user authentication and custom model profiles remain available without manual credential passing. Any user-configured hooks in `config.toml` (such as session monitors) will still be invoked unless `--ignore-user-config` is explicitly configured.
3. **Strict Isolation (`--ignore-user-config`)**:
   If user hooks must not run during deliberation, `--ignore-user-config` can be enabled, provided authentication is exported via environment variables (such as `CODEX_API_KEY` or `OPENAI_API_KEY`).
4. **Telemetry & Sanitization**:
   Live runs record provider call telemetry including `durationMs`, `exitCode`, and sanitized `argv` where sensitive deliberation prompts are redacted and represented by length and SHA-256 hash.

---

## 7. Tool Policies, Concurrency & Time Budgets

### Tool Access Policies (`tools: 'none' | 'read-only'`)
The Council enforces strict tool boundary policies across all seats and the Judge:
- `'read-only'` (Default): Seats are provided with read-only inspection capabilities and prompt verification directives. Participants are instructed to inspect relevant codebases, standards, benchmarks, or documents before asserting facts or casting votes. The Judge is directed to spot-check submitted proof citations before admitting them.
- `'none'`: Pure reasoning mode with zero tool invocations. Verification prompt directives are omitted.
- **Write Capabilities Strictly Forbidden**: Specifying `write`, `read-write`, or unapproved tools immediately fails configuration validation naming the allowed values (`none`, `read-only`). For `cursor-agent`, CLI executions automatically enforce `--mode plan` and `--sandbox enabled`.

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
      "model": "gpt-5-sol (high)",
      "soul": "Race Condition & State Invariant Specialist",
      "tools": "read-only"
    }
  ]
}
```
