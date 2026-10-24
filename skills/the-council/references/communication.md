# Common questions and recorded answers

Use the controller's current common `QuestionBatch`, its `presentedQuestionIds`, origin, base context hash, and current draft. All three reviewers receive the same published context. Questions from interactive methods enter this batch; they do not start private reviewer interviews.

## Present and record

The user-facing reply has three parts:

1. State which supplied facts were recorded, with exact values and units.
2. Ask the remaining presented questions together, showing required answer forms and which are blocking. For a nonblocking question, offer a value, explicit unknown, or explicit decline.
3. State the immediate consequence: partial replies remain drafts; a complete valid batch can be published, and the controller chooses the next admitted phase.

For each answer keep `id`, `questionId`, `status`, `value`, `source: { author, receiptId }`, and `evidenceIds`. Bind the control to the exact run, request ID, batch ID, origin and base context hash. Preserve existing draft records. `answered` must satisfy the question's answer form. `unknown` and `declined` use null values and need an actual source record; silence or urgency is not either status.

**Finalization contract:** every presented question has an answer/status record, including a presented nonblocking question. A nonblocking flag permits uncertainty in the decision; it does not remove that question from the published batch. A draft may contain only the known answers and has `finalized: false`. No worker starts from that draft. Source answers already in the batch remain available; use the producing validator to reconcile them rather than inventing replacements.

If the user explicitly says they do not know or declines a question, record that exact status. An unresolved blocking question remains blocking after either status; there is no automatic waiver. A concrete choice such as `Any region` is an answered choice, while a generic “skip” does not supply that choice. New assumptions or priorities use the separate context-update control at a permitted settled boundary; a clarification-wave context update is rejected for explicit resubmission later.

## Example: a partial reply under time pressure

The common batch asks for peak rate (blocking number), storage location (blocking choice: `European Union only` or `Any region`), and monthly EUR budget (nonblocking number). The user supplies only `12,000 requests per second` and asks to keep moving.

Reply: “Recorded 12,000 requests/second. Which storage location applies: European Union only or Any region? For the monthly EUR budget, give a number, say unknown, or decline. The peak answer stays in the draft until this batch is complete.”

Immediate action: stage numeric `12000` for the exact peak question with the user's receipt; retain the unanswered location and budget questions, `finalized: false`, and the current counters. Do not convert the deadline into a budget decline. If the user later chooses `Any region` and explicitly declines the budget, add those two records with their real receipt and submit all three records as a finalized batch. A queued receipt is not proof of publication; inspect the applied disposition and shared context.

## Submit the actual control

The current CLI prints `pendingQuestion` and `answerDraft` on `inspect`. It exposes `action_required: 'candidate'` for candidate preparation; a question-request integration may label its request `action_required: 'questions'`. Read the actual fields rather than assuming that alias is emitted by this CLI version.

Write a JSON control file in the OS temporary directory. An answer control has this shape; the abbreviated question ID below must be replaced by the exact presented ID, and the receipt must identify the actual user reply:

```json
{
  "kind": "answers", "requestId": "answer-draft-1", "runId": "decision-1",
  "batch": {
    "requestId": "answer-draft-1", "batchId": "current-batch-id",
    "origin": { "kind": "clarification", "batchIndex": 1 },
    "baseContextHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "answers": [{
      "id": "peak-answer-1", "questionId": "exact-presented-peak-id",
      "status": "answered", "value": 12000,
      "source": { "author": "user", "receiptId": "actual-user-reply" }, "evidenceIds": []
    }],
    "finalized": false
  }
}
```

Use `respond --run decision-1 --workspace /absolute/task/workspace --input /temporary/control.json --json`. The control envelope request ID and batch request ID match. Later drafts/finalization use a new request ID and preserve accumulated answer IDs and provenance. Reuse an existing request ID only for byte-identical idempotent resubmission.

## Continue from the published state

After a nonempty first clarification wave, complete answers publish and admit the second clarification wave within the default two-batch allowance. Do not promise immediate round 1 after the first-wave reply. An all-ready wave can skip unused clarification allowance. After the second wave, complete answers without unresolved blocking questions permit deliberation. The controller applies these rules, reservations, remaining active budget, and fresh preflight.

A late review/confirmation question consumes its deliberation round. Publish its answers to all seats before the next counted round; do not return to clarification or refund calls. At the round limit, report unresolved or use a specifically authorized bounded extension. Resume the next day with the same frozen run and counters after positive settlement; do not start a replacement run to evade limits.

For corrections after publication use `answer_revision` with the current context hash and predecessor answer IDs. For new facts/priorities use `context_update`; do not disguise either as an answer batch replay. Read the authoritative `ControlRequest` and question validators for the current boundary.

| Pressure or shortcut | Required record or continuation |
| --- | --- |
| “The budget is optional, omit it.” | A presented budget question still needs a sourced answer, unknown, or decline record before finalization. |
| “Only the remaining blocking answer matters.” | Preserve every presented question and draft record. |
| “We have two minutes; go straight to evaluation.” | Keep the valid draft; follow the controller's second-wave or later-round decision. |

Red flags are dropping a presented ID, inferring a decline from silence, declaring a blocking waiver, or promising a specific next phase before the controller accepts the complete controls.
