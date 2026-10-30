/** Bounded static contract recognition. These are source templates, never executed.
 * Match the complete token stream, rather than fragments that could be comments,
 * unrelated declarations, shadowed bindings or later property overrides. Unknown
 * syntax/contract shapes fail closed and require a new audited template.
 */
const currentCatalog = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANTIGRAVITY_SESSION_OPTION_CATALOG = void 0;
const agent_choice_cli_apply_1 = require("./agent-choice-cli-apply");
const ANTIGRAVITY_EFFORT = {
    id: 'effort',
    label: 'Reasoning effort',
    category: 'thought_level',
    kind: {
        type: 'select',
        choices: [
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' }
        ],
        defaultValue: 'high'
    },
    apply: {
        ...(0, agent_choice_cli_apply_1.agentChoiceCliApply)('antigravity', [
            {
                kind: 'value',
                names: ['--effort'],
                lift: 'separate-and-long-equals'
            }
        ], '--effort'),
        midSession: { kind: 'command', build: (value) => \`/effort \${String(value)}\` }
    }
};
exports.ANTIGRAVITY_SESSION_OPTION_CATALOG = {
    supportsWorkerLaunchPreferences: true,
    // Model availability is account-scoped; worker-start accepts the slug reported by \`agy models\`.
    models: [],
    modelApply: {
        ...(0, agent_choice_cli_apply_1.agentChoiceCliApply)('antigravity', [
            {
                kind: 'value',
                names: ['--model'],
                lift: 'separate-and-long-equals'
            }
        ], '--model'),
        midSession: { kind: 'agent-picker', command: '/model' }
    },
    unknownModelOptions: [ANTIGRAVITY_EFFORT]
};
`;
const currentHelper = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentChoiceConfigValue = agentChoiceConfigValue;
exports.agentChoiceCliApply = agentChoiceCliApply;
const agent_session_option_agent_args_1 = require("./agent-session-option-agent-args");
function agentChoiceConfigValue(value, key) {
    const separator = value.indexOf('=');
    return separator !== -1 && value.slice(0, separator).trim() === key
        ? value.slice(separator + 1)
        : undefined;
}
/** The declared grammar owns both forward spelling and conflicting argument removal. */
function agentChoiceCliApply(agent, forms, emitted) {
    const encoder = forms.find((form) => form.names.includes(emitted)) ?? forms[0];
    return {
        cli: forms,
        launchArgs: (value) => encoder.kind === 'config'
            ? [emitted, \`\${encoder.key}=\${String(value)}\`]
            : [emitted, String(value)],
        removeAgentArgs: (tokens) => forms.reduce((kept, form) => (0, agent_session_option_agent_args_1.removeAgentArgOption)(agent, kept, form.names, form.kind === 'config'
            ? (value) => agentChoiceConfigValue(value ?? '', form.key) !== undefined
            : undefined), [...tokens])
    };
}
`;
const legacyCatalog = `const ANTIGRAVITY_EFFORT = {
  kind: {type:'select', choices:[{value:'low'},{value:'medium'},{value:'high'}]},
  apply: { launchArgs: (value) => ['--effort', String(value)] }
};
exports.ANTIGRAVITY_SESSION_OPTION_CATALOG = {
  supportsWorkerLaunchPreferences: true, unknownModelOptions: [ANTIGRAVITY_EFFORT]
};`;

/** A deliberately small lexer for the audited source grammar. Reject escapes and
 * unsupported syntax rather than attempting to interpret arbitrary JavaScript.
 * Keep token boundaries and string types; discard only whitespace and comments.
 */
function tokens(source: string): string[] | undefined {
  const result: string[] = [];
  let offset = 0;
  let lineBreak = false;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const trivia = /^(?:\s+|\/\/[^\r\n\u2028\u2029]*(?:[\r\n\u2028\u2029]|$)|\/\*[\s\S]*?\*\/)/.exec(rest)?.[0];
    if (trivia) {
      lineBreak ||= /[\r\n\u2028\u2029]/.test(trivia);
      offset += trivia.length;
      continue;
    }
    // Newlines after return change JavaScript semantics (automatic semicolons).
    if (lineBreak && result.at(-1) === "return") return undefined;
    const quoted = /^(?:"[^"\\\r\n]*"|'[^'\\\r\n]*'|`[^`\\]*`)/.exec(rest)?.[0];
    if (quoted) {
      result.push(quoted[0] === '`' ? quoted : JSON.stringify(quoted.slice(1, -1)));
      lineBreak = false;
      offset += quoted.length;
      continue;
    }
    const token = /^(?:[A-Za-z_$][A-Za-z0-9_$]*|[0-9]+|\.\.\.|=>|===|!==|\?\?|&&|\|\||[{}()[\].,:;?=+!<>-])/.exec(rest)?.[0];
    if (!token) return undefined;
    if (lineBreak && token === "=>") return undefined;
    lineBreak = false;
    result.push(token);
    offset += token.length;
  }
  return result;
}
function matches(actual: string[] | undefined, expected: string): boolean {
  const wanted = tokens(expected);
  return !!actual && !!wanted && actual.length === wanted.length &&
    actual.every((token, index) => token === wanted[index]);
}
export function explicitEffortContract(catalog: string, helper?: string): { efforts: string[]; helper: boolean } | undefined {
  const actual = tokens(catalog);
  if (matches(actual, legacyCatalog)) return {efforts: ['low', 'medium', 'high'], helper: false};
  if (matches(actual, currentCatalog) && helper !== undefined && matches(tokens(helper), currentHelper))
    return {efforts: ['low', 'medium', 'high'], helper: true};
  return undefined;
}
