import { expect, it } from "vitest";
async function transport() {
  const m = await import("../../src/orca/transport.js").catch(() => null);
  expect(m).not.toBeNull();
  return m!;
}
it("blocks a real route without exact orchestration/descendant/delivery controls", async () => {
  const m = await transport();
  const receipt = await m.qualifyRoute({
    selection: { route: "codex", model: "gpt-6-astra", effort: "ultra" },
    host: "local",
    versions: { orca: "1", codex: "1", antigravity: "1" },
    actionClass: "supplied-packet-read-only",
    roots: [],
    now: 1000,
  });
  expect(receipt).toMatchObject({
    kind: "blocked",
    reason: "UNQUALIFIED_ROUTE",
  });
});
it("pins configured replacements and rejects unsupported overrides and the AGY plan/slash trap", async () => {
  const m = await transport(),
    { fixture } = await import("./fixtures.js");
  const f = fixture(),
    spec = f.prepare({
      eventId: "candidate",
      revision: 0,
      intentHash: "a".repeat(64),
    });
  const evidence = spec.routeEvidence;
  expect(
    m.selectionArgv(
      { route: "codex", model: "gpt-6.1-sol", effort: "max" },
      evidence,
    ),
  ).toEqual(["--agent", "codex", "--model", "gpt-6.1-sol", "--effort", "max"]);
  const sonnet = {
    route: "antigravity" as const,
    model: "claude-sonnet-5-5-high",
    effort: "high",
  };
  const claude = {
    ...evidence,
    role: "claude" as const,
    admission: {
      ...evidence.admission,
      assignments: [{ role: "claude" as const, selection: sonnet }],
    },
    catalog: {
      ...evidence.catalog,
      ...sonnet,
      family: "claude" as const,
      efforts: ["high"],
    },
    qualification: {
      ...evidence.qualification,
      requested: sonnet,
      exposed: sonnet,
    },
  };
  expect(m.selectionArgv(sonnet, claude)).toEqual([
    "--agent",
    "antigravity",
    "--model",
    "claude-sonnet-5-5-high",
    "--effort",
    "high",
  ]);
  expect(() =>
    m.selectionArgv({
      route: "codex",
      model: "gpt-6.1-sol",
      effort: "automatic",
    }),
  ).toThrow();
  expect(() =>
    m.validateProviderControls({
      version: "1.4.6",
      mode: "plan",
      disableSlashCommands: true,
      expandedPlan: null,
    }),
  ).toThrow();
  expect(() =>
    m.validateProviderControls({
      version: "1.4.7",
      mode: "plan",
      disableSlashCommands: false,
      expandedPlan: null,
    }),
  ).toThrow();
  f.store.close();
});

it("passes a newly attested exact same-family model unchanged and rejects missing catalog/qualification evidence", async () => {
  const m = await transport(),
    { fixture } = await import("./fixtures.js");
  const f = fixture();
  const selection = {
    route: "codex" as const,
    model: "gpt-9.7-approved",
    effort: "deep",
  };
  const spec = f.prepare({
    eventId: "candidate",
    revision: 0,
    intentHash: "a".repeat(64),
  });
  const admission = {
    ...spec.admission,
    assignments: [{ role: "openai" as const, selection }],
  };
  const evidence = {
    admission,
    role: "openai" as const,
    now: 10000,
    catalog: {
      ...selection,
      family: "openai" as const,
      efforts: ["deep"],
      receiptId: "future-catalog",
      expiresAt: 20000,
    },
    qualification: {
      id: "future-qualified",
      host: admission.host,
      versions: admission.versions,
      actionClass: "supplied-packet-read-only" as const,
      requested: selection,
      exposed: selection,
      expiresAt: 20000,
      throughOrca: true,
      helpersDisabled: true,
      terminalSandbox: true,
      accessControlled: true,
      roots: [],
      receiptRefs: ["future-live-proof"],
    },
  };
  expect(m.selectionArgv(selection, evidence)).toEqual([
    "--agent",
    "codex",
    "--model",
    "gpt-9.7-approved",
    "--effort",
    "deep",
  ]);
  expect(() => m.selectionArgv(selection)).toThrow(
    "UNSUPPORTED_MODEL_OVERRIDE",
  );
  expect(() =>
    m.selectionArgv(selection, {
      ...evidence,
      catalog: { ...evidence.catalog, family: "gemini" },
    }),
  ).toThrow();
  expect(() =>
    m.selectionArgv(selection, {
      ...evidence,
      catalog: { ...evidence.catalog, efforts: ["high"] },
    }),
  ).toThrow();
  expect(() =>
    m.selectionArgv(selection, {
      ...evidence,
      qualification: {
        ...evidence.qualification,
        exposed: { ...selection, effort: "high" },
      },
    }),
  ).toThrow();
  f.store.close();
});

it("retains exact reducer input, context, profile, config and target hashes across all four phases", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await transport(),
    { WorkerBridge } = await import("../../src/workers/bridge.js"),
    { makeConfirmation } = await import("../fixtures/builders.js");
  const f = fixture(),
    t = new OrcaTransport(f.store, f.driver),
    w = new WorkerBridge(f.store, t, f.now);
  const finish = async (phase: "clarify" | "review" | "judge" | "ballot") => {
    const tasks = Object.values(
      f.store.load("run1").context.issuedLogicalTasks,
    ).filter(
      (task) =>
        task.reservation.phase === phase && task.stage === "pending_execution",
    );
    for (const task of tasks) {
      const q = task.reservation,
        receipt = (await w.dispatch(q, (fence) => f.prepare(fence, q)))!,
        b = receipt.binding;
      for (const [key, value] of Object.entries(q.bindings))
        expect(b[key as keyof typeof b]).toEqual(value);
      const bindings = {
        runId: b.runId,
        configHash: b.configHash,
        profileHash: b.profileHash,
        contextHash: b.contextHash,
        round: b.round,
        candidateHash: b.candidateHash!,
        evidenceHash: b.evidenceHash!,
      };
      const raw =
        phase === "clarify"
          ? {
              kind: "clarification",
              ready: true,
              questions: [],
              methodIds: ["test-method"],
            }
          : phase === "review"
            ? {
                kind: "review",
                proposals: ["proposal"],
                newObjections: [],
                evidenceRequests: [],
                missingInputQuestions: [],
                methodIds: ["test-method"],
              }
            : phase === "judge"
              ? {
                  kind: "judge",
                  bindings,
                  assessments: [],
                  challenges: [],
                  methodIds: ["test-method"],
                }
              : {
                  kind: "ballot",
                  bindings: { ...bindings, judgeHash: b.judgeHash! },
                  decision: "accept",
                  conditional: false,
                  newObjections: [],
                  missingInputQuestions: [],
                  dispositions: [],
                  challengeResponses: [],
                  reason: "Accept",
                  methodIds: ["test-method"],
                };
      f.commit(
        { kind: "WATCHDOG_ARMED", data: f.armProof(b) },
        "adapter",
        b.phase,
      );
      expect(w.ingest(Buffer.from(JSON.stringify(raw)), b).status).toBe(
        "valid",
      );
      await w.observe(b);
    }
    f.commit({ kind: "PHASE_READY", data: {} }, "controller");
  };
  await finish("clarify");
  let s = f.store.load("run1");
  f.commit(
    {
      kind: "COLLECT_QUESTIONS",
      data: {
        batch: {
          id: "fixture-batch",
          origin: { kind: "clarification", batchIndex: 1 },
          baseContextHash: s.context.sharedContext.contextHash,
          questions: [],
          groups: [],
          aliases: [],
          sourceAnswers: [],
          presentedQuestionIds: [],
        },
      },
    },
    "controller",
  );
  f.commit({ kind: "PUBLISH_ANSWERS", data: {} }, "controller");
  f.commit({ kind: "ADMIT_ROUND", data: {} }, "controller");
  await finish("review");
  f.commit({ kind: "REQUEST_CANDIDATE", data: {} }, "controller");
  f.commit(
    {
      kind: "CANDIDATE_FROZEN",
      data: {
        candidate: makeConfirmation().candidate,
        evidenceHash: "a".repeat(64),
      },
    },
    "controller",
  );
  await finish("judge");
  await finish("ballot");
  expect(f.counts().launches).toBe(10);
  f.store.close();
});
