import { assign, setup } from 'xstate';
import type {
  ControlEventBody,
  ControlState,
  RunContext,
  ValidatedEvent,
} from '../domain/contracts.js';

export const activeStates: readonly ControlState[] = [
  'preflight',
  'clarifying',
  'collecting_questions',
  'publishing_answers',
  'prepare_round',
  'reviewing',
  'prepare_candidate',
  'judging',
  'confirming',
  'evaluate_round',
];
const phaseReturns = activeStates.filter((s) => s !== 'preflight');
/** The normative graph; all states are stable and have no entry or eventless effects. */
export const controlEdges: Readonly<Record<ControlState, readonly ControlState[]>> = {
  preflight: ['needs_context', 'blocked', ...phaseReturns, 'settling', 'reconciling'],
  needs_context: ['reconciling'],
  blocked: ['reconciling'],
  needs_user: ['reconciling'],
  clarifying: ['collecting_questions', 'settling', 'reconciling'],
  collecting_questions: ['publishing_answers', 'settling', 'reconciling'],
  publishing_answers: ['clarifying', 'prepare_round', 'settling', 'reconciling'],
  prepare_round: ['reviewing', 'settling', 'reconciling'],
  reviewing: ['prepare_candidate', 'collecting_questions', 'preflight', 'settling', 'reconciling'],
  prepare_candidate: ['prepare_candidate', 'judging', 'preflight', 'settling', 'reconciling'],
  judging: ['confirming', 'preflight', 'settling', 'reconciling'],
  confirming: ['evaluate_round', 'collecting_questions', 'preflight', 'settling', 'reconciling'],
  evaluate_round: ['prepare_round', 'preflight', 'settling', 'reconciling'],
  reconciling: ['reconciling', 'preflight', ...phaseReturns, 'settling'],
  settling: ['reconciling', 'completed', 'needs_user', 'needs_context', 'blocked', 'cancelled'],
  completed: [],
  cancelled: [],
};
type EventKind = ControlEventBody['kind'];
type EventTargets = Partial<Record<EventKind, readonly ControlState[]>>;
export const stateEventTargets: Record<ControlState, EventTargets> = {
  preflight: {
    PREFLIGHT: ['needs_context', 'blocked', ...phaseReturns, 'settling'],
    ANSWER_BATCH: ['preflight', 'settling'],
    APPLY_CONTEXT_UPDATE: ['preflight', 'settling'],
  },
  clarifying: { PHASE_READY: ['collecting_questions', 'settling'] },
  collecting_questions: { COLLECT_QUESTIONS: ['publishing_answers', 'settling'] },
  publishing_answers: { PUBLISH_ANSWERS: ['clarifying', 'prepare_round', 'settling'] },
  prepare_round: {
    ADMIT_ROUND: ['reviewing', 'settling'],
    APPLY_CONTEXT_UPDATE: ['prepare_round', 'settling'],
  },
  reviewing: {
    PHASE_READY: ['prepare_candidate', 'collecting_questions', 'preflight', 'settling'],
  },
  prepare_candidate: {
    PHASE_READY: ['preflight', 'settling'],
    REQUEST_CANDIDATE: ['prepare_candidate', 'settling'],
    EVIDENCE_RECORDED: ['prepare_candidate', 'settling'],
    EVIDENCE_REQUESTED: ['prepare_candidate', 'settling'],
    CANDIDATE_FROZEN: ['judging', 'settling'],
  },
  judging: { PHASE_READY: ['confirming', 'preflight', 'settling'] },
  confirming: { PHASE_READY: ['evaluate_round', 'collecting_questions', 'preflight', 'settling'] },
  evaluate_round: {
    PHASE_READY: ['preflight', 'settling'],
    EVALUATE_ROUND: ['prepare_round', 'settling'],
  },
  reconciling: { RECONCILED: ['preflight', ...phaseReturns, 'settling', 'reconciling'] },
  settling: { SETTLED: ['completed', 'needs_user', 'needs_context', 'blocked', 'cancelled'] },
  needs_user: { ANSWER_REVISION: ['needs_user'] },
  needs_context: {},
  blocked: {},
  completed: {},
  cancelled: {},
};
for (const state of activeStates) {
  const events = stateEventTargets[state];
  for (const kind of ['CANCEL', 'ERROR', 'DEADLINE', 'REQUIRE_INPUT'] as const)
    events[kind] = ['settling'];
  events.LIFECYCLE_UNKNOWN = ['reconciling'];
  events.CONTEXT_UPDATE =
    state === 'evaluate_round' ? ['evaluate_round', 'preflight', 'settling'] : [state, 'settling'];
  if (state !== 'preflight') events.PREFLIGHT = [state, 'settling'];
}
for (const state of ['clarifying', 'reviewing', 'judging', 'confirming'] as const) {
  stateEventTargets[state].LAUNCH_DISPATCHED = [state, 'settling'];
  stateEventTargets[state].LAUNCH_RECEIPT_RECORDED = [state, 'settling'];
  stateEventTargets[state].WORKER_RESULT = [state, 'settling'];
}
for (const state of [...activeStates, 'reconciling', 'settling'] as const) {
  stateEventTargets[state].WORKER_OBSERVED = [state, 'reconciling', 'settling'];
  stateEventTargets[state].RESOURCES_SETTLED = [state];
  stateEventTargets[state].LIFECYCLE_UNKNOWN = ['reconciling'];
}
for (const kind of ['CANCEL', 'ERROR', 'DEADLINE'] as const)
  stateEventTargets.reconciling[kind] = ['settling'];
stateEventTargets.reconciling.LAUNCH_RECEIPT_RECORDED = ['reconciling'];
for (const state of ['needs_user', 'needs_context', 'blocked'] as const) {
  Object.assign(stateEventTargets[state], {
    RESUME: ['reconciling'],
    ANSWER_BATCH: [state],
    EXTEND: [state],
    CONTEXT_UPDATE: [state],
  });
}
for (const state of [
  ...activeStates,
  'reconciling',
  'settling',
  'needs_user',
  'needs_context',
  'blocked',
] as const)
  stateEventTargets[state].CLOCK_CHECKPOINT = [state];

// Post-settlement transport/file housekeeping cannot reopen a phase or admit work.
for (const state of Object.keys(stateEventTargets) as ControlState[])
  stateEventTargets[state].EFFECT_RECEIPT_RECORDED = [state];

// A recorded clock/lifecycle blocker is a global recovery path for every otherwise legal active event.
for (const state of activeStates)
  for (const [kind, targets] of Object.entries(stateEventTargets[state])) {
    if (kind !== 'CLOCK_CHECKPOINT' && kind !== 'EFFECT_RECEIPT_RECORDED')
      stateEventTargets[state][kind as EventKind] = [
        ...new Set([...targets!, 'reconciling' as const]),
      ];
  }

interface ReductionEvent {
  type: EventKind;
  recordedEvent: ValidatedEvent;
  target: ControlState;
  context: RunContext;
}
const machineSetup = setup({
  types: { context: {} as RunContext, input: {} as RunContext, events: {} as ReductionEvent },
});
export const councilMachine = machineSetup.createMachine({
  id: 'council',
  initial: 'preflight',
  context: ({ input }) => input,
  states: Object.fromEntries(
    Object.entries(stateEventTargets).map(([state, events]) => [
      state,
      {
        on: Object.fromEntries(
          Object.entries(events).map(([kind, targets]) => [
            kind,
            targets!.map((target) => ({
              target: `#council.${target}`,
              guard: ({ event }: { event: ReductionEvent }) =>
                event.type === event.recordedEvent.body.kind &&
                event.target === target &&
                (target === state || controlEdges[state as ControlState].includes(target)),
              actions: assign(({ event }: { event: ReductionEvent }) => event.context),
            })),
          ]),
        ),
      },
    ]),
  ),
});
