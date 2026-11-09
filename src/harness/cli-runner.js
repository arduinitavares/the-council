/**
 * @fileoverview Pure child_process.execFile CLI Runner for Live Harness Adapters.
 * Zero external dependencies. Zero MCP/UTCP wrappers. Zero GUI windows.
 * Node >= 22 ESM.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

export const CODEX_EFFORT_MAP = Object.freeze({
  max: 'max',
  xhigh: 'xhigh',
  high: 'high',
  medium: 'medium',
  low: 'low'
});

export const ALLOWED_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

const RECOGNIZED_EFFORT_SUFFIXES = ['-max', '-xhigh', '-high', '-medium', '-low'];

/**
 * Redacts prompt string in CLI argv for telemetry logging, replacing it with length and sha256 hash.
 * Handles exact prompt arguments and --print=<prompt> flags.
 *
 * @param {string[]} args
 * @param {string} [prompt='']
 * @returns {string[]}
 */
export function redactArgv(args, prompt = '') {
  if (!Array.isArray(args)) {
    return [];
  }
  const promptStr = typeof prompt === 'string' ? prompt : String(prompt || '');
  const hash = createHash('sha256').update(promptStr).digest('hex').slice(0, 12);
  const length = promptStr.length;
  const summary = `[REDACTED prompt: length=${length}, sha256=${hash}]`;

  return args.map((arg) => {
    if (arg === prompt) {
      return summary;
    }
    if (typeof arg === 'string' && prompt && arg === `--print=${prompt}`) {
      return `--print=${summary}`;
    }
    return arg;
  });
}

/**
 * Parses model name and reasoning effort level.
 * Handles parenthesis format "gpt-6-astra (max)" and hyphenated suffixes "gemini-4-argon-high".
 * Preserves 'max' for Codex reasoning effort.
 * Throws a configuration error on unsupported efforts naming allowed values.
 *
 * @param {string} modelString
 * @param {'high'|'medium'|'low'|'max'|'xhigh'|string} [defaultEffort='high']
 * @returns {{ model: string, effort: string, codexEffort: string }}
 */
export function parseModelAndEffort(modelString, defaultEffort = 'high') {
  if (typeof modelString !== 'string' || !modelString.trim()) {
    throw new Error('modelString must be a non-empty string');
  }

  const trimmed = modelString.trim();

  // 1. Parenthesized effort format: e.g. "gpt-6-astra (max)"
  const parenMatch = trimmed.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const model = parenMatch[1].trim();
    const rawEffort = parenMatch[2].trim();
    if (!rawEffort) {
      const defaultEff = (defaultEffort || 'high').toLowerCase();
      const codexEffort = CODEX_EFFORT_MAP[defaultEff] || 'high';
      return { model, effort: '', codexEffort };
    }
    const effort = rawEffort.toLowerCase();
    if (!CODEX_EFFORT_MAP[effort]) {
      throw new Error(
        `Configuration error: Unsupported reasoning effort "${rawEffort}". Allowed: ${ALLOWED_EFFORTS.join(', ')}.`
      );
    }
    return { model, effort, codexEffort: CODEX_EFFORT_MAP[effort] };
  }

  // 2. Suffix effort format: e.g. "gemini-4-argon-high", "grok-4.7-xhigh", "model-max"
  for (const suffix of RECOGNIZED_EFFORT_SUFFIXES) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      const effort = suffix.slice(1);
      const codexEffort = CODEX_EFFORT_MAP[effort] || 'high';
      return { model: trimmed, effort, codexEffort };
    }
  }

  // 3. Fallback to default effort
  const defaultEff = (defaultEffort || 'high').toLowerCase();
  if (!CODEX_EFFORT_MAP[defaultEff]) {
    throw new Error(
      `Configuration error: Unsupported reasoning effort "${defaultEffort}". Allowed: ${ALLOWED_EFFORTS.join(', ')}.`
    );
  }
  const codexEffort = CODEX_EFFORT_MAP[defaultEff];
  return { model: trimmed, effort: defaultEff, codexEffort };
}

/**
 * Extracts the canonical lowercase base model name after validating effort via parseModelAndEffort.
 * Enforces the no-double-effort (!hasParens) and single-suffix (break) rules.
 *
 * @param {string} modelString
 * @param {'high'|'medium'|'low'|'max'|'xhigh'|string} [defaultEffort='high']
 * @returns {string}
 */
export function extractCanonicalBaseModel(modelString, defaultEffort = 'high') {
  const parsed = parseModelAndEffort(modelString, defaultEffort);
  const hasParens = /\([^)]*\)\s*$/.test(String(modelString || '').trim());
  let baseModel = parsed.model.trim().toLowerCase();
  if (!hasParens) {
    for (const suffix of RECOGNIZED_EFFORT_SUFFIXES) {
      if (baseModel.endsWith(suffix)) {
        baseModel = baseModel.slice(0, -suffix.length);
        break;
      }
    }
  }
  return baseModel;
}

const NON_PROMPT_VALUE_FLAGS = new Set([
  '-e',
  '--eval',
  '-m',
  '--model',
  '-c',
  '--mode',
  '--sandbox',
  '--output-format',
  '--effort',
  '--disable'
]);

/**
 * Infers the prompt string from CLI arguments when not explicitly provided.
 *
 * @param {string} executable
 * @param {string[]} [args=[]]
 * @param {string} [explicitPrompt='']
 * @returns {string}
 */
const SHORT_CLI_FLAG_REGEX = /^-+[a-zA-Z0-9][-a-zA-Z0-9_]*$/;

export function inferPromptFromArgs(executable, args = [], explicitPrompt = '') {
  if (typeof explicitPrompt === 'string' && explicitPrompt.length > 0) {
    return explicitPrompt;
  }
  if (!Array.isArray(args) || args.length === 0) {
    return '';
  }
  for (const arg of args) {
    if (typeof arg === 'string' && arg.startsWith('--print=') && arg.length > '--print='.length) {
      return arg.slice('--print='.length);
    }
  }
  if (args.length >= 2) {
    const lastArg = args[args.length - 1];
    const prevArg = String(args[args.length - 2] || '');
    if (
      typeof lastArg === 'string' &&
      lastArg.length > 0 &&
      !SHORT_CLI_FLAG_REGEX.test(lastArg) &&
      !NON_PROMPT_VALUE_FLAGS.has(prevArg)
    ) {
      return lastArg;
    }
  } else if (args.length === 1) {
    const onlyArg = args[0];
    if (typeof onlyArg === 'string' && onlyArg.length >= 8 && !SHORT_CLI_FLAG_REGEX.test(onlyArg)) {
      return onlyArg;
    }
  }
  return '';
}

/**
 * Sanitizes an execFile Error object so its message, cmd, and stderr never leak the raw prompt.
 *
 * @param {Error|any} error
 * @param {string} executable
 * @param {string[]} [args=[]]
 * @param {string} [explicitPrompt='']
 * @returns {Error|any}
 */
export function sanitizeCliError(error, executable, args = [], explicitPrompt = '') {
  if (!error || typeof error !== 'object') {
    return error;
  }
  const detectedPrompt = inferPromptFromArgs(executable, args, explicitPrompt);
  if (!detectedPrompt) {
    return error;
  }

  const redactedArgs = redactArgv(args, detectedPrompt);
  const redactedSummary = redactArgv([detectedPrompt], detectedPrompt)[0] || '[PROMPT REDACTED]';
  const rawArgsJoined = Array.isArray(args) ? args.join(' ') : '';
  const redactedArgsJoined = redactedArgs.join(' ');
  const rawCmd = [executable, ...(Array.isArray(args) ? args : [])].filter(Boolean).join(' ');
  const redactedCmd = [executable, ...redactedArgs].filter(Boolean).join(' ');
  const printArg = `--print=${detectedPrompt}`;
  const redactedPrintArg = `--print=${redactedSummary}`;

  const sanitizeText = (text) => {
    let next = text;
    if (rawCmd && next.includes(rawCmd)) {
      next = next.split(rawCmd).join(redactedCmd);
    } else if (rawArgsJoined && Array.isArray(args) && args.length >= 2 && next.includes(rawArgsJoined)) {
      next = next.split(rawArgsJoined).join(redactedArgsJoined);
    }
    if (next.includes(printArg)) {
      next = next.split(printArg).join(redactedPrintArg);
    }
    if ((detectedPrompt.length >= 8 || next === detectedPrompt) && next.includes(detectedPrompt)) {
      next = next.split(detectedPrompt).join(redactedSummary);
    }
    return next;
  };

  if (typeof error.cmd === 'string') {
    error.cmd = sanitizeText(error.cmd);
  }

  if (typeof error.message === 'string') {
    error.message = sanitizeText(error.message);
  }

  if (typeof error.stderr === 'string') {
    error.stderr = sanitizeText(error.stderr);
  }

  return error;
}

const EXCLUDED_TRACE_OUTPUT_KEYS = new Set([
  'aggregated_output',
  'output',
  'result',
  'stdout',
  'stderr',
  'content',
  'text',
  'response'
]);

const SKILL_PATH_REGEX =
  /(?:^|[\s"'`=,:;()[\]{}\\/])(?:\.agents[\\/])?(?:[\w.-]+[\\/])*skills[\\/]([a-zA-Z0-9._-]+)[\\/]SKILL\.md\b/g;

const ALLOWED_READ_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'bat',
  'sed',
  'awk',
  'nl',
  'grep',
  'rg',
  'ripgrep',
  'python',
  'python3',
  'node',
  'jq',
  'view'
]);

const FORBIDDEN_COMMAND_NAMES = new Set([
  'echo',
  'printf',
  'rm',
  'mv',
  'cp',
  'touch',
  'mkdir',
  'tee',
  'rmdir',
  'dd',
  'truncate',
  'install',
  'ln',
  'chmod',
  'chown'
]);

const MUTATING_TOOL_WORDS = new Set([
  'write',
  'edit',
  'patch',
  'replace',
  'delete',
  'remove',
  'create',
  'mkdir',
  'rm',
  'mv',
  'cp',
  'touch',
  'append',
  'overwrite',
  'rename',
  'unlink'
]);

function isMutatingToolIdentifier(id) {
  if (typeof id !== 'string' || !id.trim()) return false;
  if (/(?:write|edit|(?<!dis)patch|replace|delete|remove|create|mkdir|rmdir|touch|overwrite|unlink)/i.test(id)) {
    return true;
  }
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((w) => MUTATING_TOOL_WORDS.has(w));
}

const COMMAND_TOOL_REGEX =
  /^(?:command_execution|exec_command(?:_begin|_end)?|bash|sh|zsh|shell|terminal|run_command|run_terminal_command|shellToolCall|runTerminalCommand)$/i;

const COMMAND_OBJECT_KEYS = new Set([
  'command',
  'cmd',
  'commandLine',
  'CommandLine',
  'shell_command',
  'script'
]);

const PATH_OBJECT_KEYS = new Set([
  'path',
  'file_path',
  'filepath',
  'filePath',
  'target_file',
  'targetFile',
  'AbsolutePath',
  'uri',
  'file',
  'files',
  'paths',
  'read_path'
]);

const IGNORED_META_KEYS = new Set([
  'id',
  'call_id',
  'type',
  'kind',
  'name',
  'tool',
  'tool_name',
  'toolName',
  'function_name',
  'functionName',
  'action',
  'operation',
  'server',
  'status',
  'subtype',
  'exit_code',
  'exitCode'
]);

function parseMaybeJsonObject(val) {
  if (!val) return null;
  if (typeof val === 'object' && !Array.isArray(val)) {
    return val;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Ignore non-JSON string
      }
    }
  }
  return null;
}

function splitShellSegments(str) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < str.length) {
        current += ch + str[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';' || ch === '\n') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }
    if ((ch === '&' && str[i + 1] === '&') || (ch === '|' && str[i + 1] === '|')) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    if (ch === '|' && str[i - 1] !== '>') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    segments.push(current.trim());
  }
  return segments;
}

function extractSkillsFromCommand(cmdInput) {
  if (!cmdInput) return [];
  if (Array.isArray(cmdInput)) {
    const strItems = cmdInput.filter((x) => typeof x === 'string');
    if (strItems.length === 0) return [];
    const firstBase = strItems[0].split(/[\\/]/).pop().toLowerCase();
    if ((firstBase === 'sh' || firstBase === 'bash' || firstBase === 'zsh') && strItems.length >= 3) {
      const cIdx = strItems.findIndex((arg, idx) => idx > 0 && /^-[a-zA-Z]*c$/.test(arg));
      if (cIdx !== -1 && typeof strItems[cIdx + 1] === 'string') {
        return extractSkillsFromCommand(strItems[cIdx + 1]);
      }
    }
    return extractSkillsFromCommand(strItems.join(' '));
  }
  if (typeof cmdInput !== 'string' || !cmdInput.includes('SKILL.md')) {
    return [];
  }

  let cmdStr = cmdInput.trim();
  const shellWrapperMatch = cmdStr.match(
    /^(?:\/usr\/bin\/env\s+)?(?:\/[\w.-]+)*\/?(?:zsh|bash|sh)\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*c\s+([\s\S]+)$/
  );
  if (shellWrapperMatch) {
    let inner = shellWrapperMatch[1].trim();
    if (
      (inner.startsWith('"') && inner.endsWith('"')) ||
      (inner.startsWith("'") && inner.endsWith("'"))
    ) {
      const q = inner[0];
      inner = inner.slice(1, -1);
      if (q === '"') {
        inner = inner.replace(/\\"/g, '"');
      }
    }
    return extractSkillsFromCommand(inner);
  }

  const matchedSkills = [];
  const segments = splitShellSegments(cmdStr);

  for (const seg of segments) {
    if (!seg.includes('SKILL.md')) continue;

    // Reject output redirection (>, >>, >|, &>, &>>) targeting SKILL.md
    if (
      /(?:[0-9]*>>?\|?|&>>?)\s*(?:"[^"]*SKILL\.md\b[^"]*"|'[^']*SKILL\.md\b[^']*'|[^\s;|&><]*SKILL\.md\b)/.test(
        seg
      )
    ) {
      continue;
    }

    let restSeg = seg.replace(/^[(\s]+/, '');
    while (restSeg) {
      const envMatch = restSeg.match(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+/);
      if (envMatch) {
        restSeg = restSeg.slice(envMatch[0].length);
        continue;
      }
      const wrapperMatch = restSeg.match(
        /^(?:sudo|env|command|builtin|nohup|time)\s+(?:-[a-zA-Z0-9-]+\s+)*/
      );
      if (wrapperMatch) {
        restSeg = restSeg.slice(wrapperMatch[0].length);
        continue;
      }
      break;
    }

    if (/^(?:\/[\w.-]+)*\/?(?:zsh|bash|sh)\s+/.test(restSeg)) {
      for (const s of extractSkillsFromCommand(restSeg)) {
        matchedSkills.push(s);
      }
      continue;
    }

    const firstTokenMatch = restSeg.match(/^["']?([^\s"';|&><()]+)["']?/);
    if (!firstTokenMatch) continue;
    const cmdBase = firstTokenMatch[1].split(/[\\/]/).pop().toLowerCase();

    if (FORBIDDEN_COMMAND_NAMES.has(cmdBase) || !ALLOWED_READ_COMMANDS.has(cmdBase)) {
      continue;
    }

    // Reject in-place sed mutations (sed -i / sed -ni / sed -i.bak / sed -ibak / sed --in-place)
    if (cmdBase === 'sed' && /\s(?:--in-place(?:=|\b)|-[neEfrluzsb]*i)/.test(restSeg)) {
      continue;
    }

    // Reject in-place awk mutations (awk -i inplace)
    if (cmdBase === 'awk' && /\s-i\b/.test(restSeg)) {
      continue;
    }

    // Reject inline script file writes in python/node
    if (
      (cmdBase === 'python' || cmdBase === 'python3' || cmdBase === 'node') &&
      (/\b(?:write_text|writeFileSync|writeFile|appendFileSync|appendFile|unlinkSync|unlink|rmSync|rmdirSync)\b/.test(
        restSeg
      ) ||
        /open\s*\([^)]*,\s*['"][wa+]/.test(restSeg))
    ) {
      continue;
    }

    SKILL_PATH_REGEX.lastIndex = 0;
    let match;
    while ((match = SKILL_PATH_REGEX.exec(restSeg)) !== null) {
      if (match[1]) {
        matchedSkills.push(match[1]);
      }
    }
  }

  return matchedSkills;
}

function isFailedToolObject(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.exit_code === 'number' && obj.exit_code !== 0) return true;
  if (typeof obj.exitCode === 'number' && obj.exitCode !== 0) return true;
  if (typeof obj.status === 'string' && /^(?:failed|error|cancelled|aborted)$/i.test(obj.status.trim())) {
    return true;
  }
  if (typeof obj.subtype === 'string' && /^(?:failed|error|cancelled|aborted)$/i.test(obj.subtype.trim())) {
    return true;
  }
  return false;
}

function getToolIdentityStrings(obj) {
  const ids = [];
  const collectIds = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const k of [
      'name',
      'type',
      'kind',
      'tool',
      'tool_name',
      'toolName',
      'function_name',
      'functionName',
      'action',
      'operation'
    ]) {
      if (typeof o[k] === 'string' && o[k].trim()) {
        ids.push(o[k].trim());
      }
    }
  };
  collectIds(obj);
  collectIds(obj?.function);
  collectIds(obj?.item);
  collectIds(obj?.payload);
  collectIds(obj?.msg);
  if (obj?.tool_call && typeof obj.tool_call === 'object' && !Array.isArray(obj.tool_call)) {
    for (const [subKey, subVal] of Object.entries(obj.tool_call)) {
      ids.push(subKey);
      collectIds(subVal);
    }
  }
  for (const k of Object.keys(obj || {})) {
    if (/ToolCall$/.test(k)) {
      ids.push(k);
    }
  }
  return ids;
}

/**
 * Extracts verified skill reads ({ skill, evidence: 'skill_instructions_read' })
 * from observed tool command strings, file paths, or argument objects.
 *
 * @param {any} input
 * @returns {Array<{ skill: string, evidence: 'skill_instructions_read' }>}
 */
export function extractSkillsRead(input) {
  const seen = new Set();
  const skillsRead = [];

  const addSkill = (skill) => {
    if (skill && !seen.has(skill)) {
      seen.add(skill);
      skillsRead.push({ skill, evidence: 'skill_instructions_read' });
    }
  };

  const matchPathString = (str) => {
    if (typeof str !== 'string' || !str.includes('SKILL.md')) return;
    SKILL_PATH_REGEX.lastIndex = 0;
    let match;
    while ((match = SKILL_PATH_REGEX.exec(str)) !== null) {
      addSkill(match[1]);
    }
  };

  const inspectValue = (val, depth = 0, isCommandContext = false) => {
    if (depth > 6 || val === null || val === undefined) {
      return;
    }
    if (typeof val === 'string') {
      const parsedObj = parseMaybeJsonObject(val);
      if (parsedObj) {
        inspectObject(parsedObj, depth + 1, isCommandContext);
        return;
      }
      if (isCommandContext) {
        for (const s of extractSkillsFromCommand(val)) {
          addSkill(s);
        }
        return;
      }
      const trimmed = val.trim();
      if (trimmed && !/\s/.test(trimmed) && !/[;|&><`$]/.test(trimmed)) {
        matchPathString(trimmed);
      } else {
        for (const s of extractSkillsFromCommand(val)) {
          addSkill(s);
        }
      }
      return;
    }
    if (Array.isArray(val)) {
      if (
        val.length > 0 &&
        val.every((item) => typeof item === 'string') &&
        (isCommandContext || !val[0].includes('SKILL.md'))
      ) {
        for (const s of extractSkillsFromCommand(val)) {
          addSkill(s);
        }
        return;
      }
      for (const item of val) {
        inspectValue(item, depth + 1, isCommandContext);
      }
      return;
    }
    if (typeof val === 'object') {
      inspectObject(val, depth, isCommandContext);
    }
  };

  const inspectObject = (obj, depth = 0, inheritedCommandContext = false) => {
    if (depth > 6 || !obj || typeof obj !== 'object') {
      return;
    }
    if (
      isFailedToolObject(obj) ||
      isFailedToolObject(obj.item) ||
      isFailedToolObject(obj.payload) ||
      isFailedToolObject(obj.msg)
    ) {
      return;
    }
    if (obj.tool_call && typeof obj.tool_call === 'object') {
      for (const subVal of Object.values(obj.tool_call)) {
        if (isFailedToolObject(subVal) || isFailedToolObject(subVal?.result)) {
          return;
        }
      }
    }

    const toolIds = getToolIdentityStrings(obj);
    if (toolIds.some((id) => isMutatingToolIdentifier(id))) {
      return;
    }

    const hasNonEmptyCommandProp = [...COMMAND_OBJECT_KEYS].some((k) => {
      const v = obj[k];
      return (typeof v === 'string' && v.trim().length > 0) || (Array.isArray(v) && v.length > 0);
    });
    const isCommandTool =
      inheritedCommandContext ||
      hasNonEmptyCommandProp ||
      toolIds.some((id) => COMMAND_TOOL_REGEX.test(id));

    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (EXCLUDED_TRACE_OUTPUT_KEYS.has(k) || IGNORED_META_KEYS.has(k)) {
        continue;
      }
      if (COMMAND_OBJECT_KEYS.has(k)) {
        for (const s of extractSkillsFromCommand(v)) {
          addSkill(s);
        }
        continue;
      }
      if (PATH_OBJECT_KEYS.has(k)) {
        if (isCommandTool && hasNonEmptyCommandProp) {
          continue;
        }
        if (typeof v === 'string') {
          const trimmed = v.trim();
          const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() || '';
          if (/\s/.test(trimmed) && (FORBIDDEN_COMMAND_NAMES.has(firstWord) || ALLOWED_READ_COMMANDS.has(firstWord))) {
            for (const s of extractSkillsFromCommand(trimmed)) {
              addSkill(s);
            }
          } else {
            matchPathString(trimmed);
          }
        } else if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === 'string') {
              matchPathString(item);
            }
          }
        }
        continue;
      }
      inspectValue(v, depth + 1, isCommandTool);
    }
  };

  inspectValue(input, 0, false);
  return skillsRead;
}

const CODEX_EVENT_TYPES = new Set([
  'thread.started',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'item.started',
  'item.completed',
  'item.updated',
  'command_execution',
  'exec_command_begin',
  'exec_command_end',
  'mcp_tool_call',
  'file_read',
  'tool_call',
  'tool_use',
  'web_search',
  'agent_message',
  'message',
  'result',
  'error',
  'event_msg'
]);

function isCodexStreamEvent(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  if (typeof obj.type === 'string') {
    if (
      CODEX_EVENT_TYPES.has(obj.type) ||
      obj.type.startsWith('item.') ||
      obj.type.startsWith('turn.') ||
      obj.type.startsWith('thread.') ||
      obj.type.startsWith('response.')
    ) {
      return true;
    }
  }
  if (obj.item && typeof obj.item === 'object' && typeof obj.item.type === 'string') {
    return true;
  }
  if (obj.payload && typeof obj.payload === 'object' && typeof obj.payload.type === 'string') {
    return true;
  }
  return false;
}

function extractMessageText(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  if (typeof item.text === 'string' && item.text.trim()) {
    return item.text;
  }
  if (typeof item.message === 'string' && item.message.trim()) {
    return item.message;
  }
  if (typeof item.content === 'string' && item.content.trim()) {
    return item.content;
  }
  if (Array.isArray(item.content)) {
    const parts = [];
    for (const part of item.content) {
      if (typeof part === 'string') {
        parts.push(part);
      } else if (part && typeof part === 'object' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
    return parts.join('\n');
  }
  return '';
}

function isPendingToolStatus(status) {
  return status === 'started' || status === 'in_progress' || status === 'observed';
}

function findMatchingPendingUnkeyedIndex(unkeyedToolCalls, { type, name, command, path }) {
  for (let i = unkeyedToolCalls.length - 1; i >= 0; i -= 1) {
    const existing = unkeyedToolCalls[i];
    if (!isPendingToolStatus(existing.status)) continue;
    if (existing.type !== type || (name && existing.name !== name)) continue;
    const sameCmd = (existing.command || null) === (command || null);
    const samePath = (existing.path || null) === (path || null);
    if (sameCmd && samePath) {
      return i;
    }
  }
  if (!command && !path) {
    for (let i = unkeyedToolCalls.length - 1; i >= 0; i -= 1) {
      const existing = unkeyedToolCalls[i];
      if (!isPendingToolStatus(existing.status)) continue;
      if (existing.type !== type || (name && existing.name !== name)) continue;
      return i;
    }
  }
  return -1;
}

/**
 * Parses `codex exec --json` JSONL event stream.
 * Extracts final assistant text, observed tool calls, and verified skill reads.
 * Maintains backwards compatibility when plain text or single non-event JSON is returned.
 *
 * @param {string} stdout
 * @returns {{ text: string, traceCoverage: 'full'|'partial'|'unavailable', toolCalls: Array<Object>, skillsRead: Array<Object>, eventsParsed: boolean }}
 */
export function parseCodexEventStream(stdout) {
  const raw = typeof stdout === 'string' ? stdout : String(stdout || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      text: '',
      traceCoverage: 'unavailable',
      toolCalls: [],
      skillsRead: [],
      eventsParsed: false
    };
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsedEvents = [];
  const nonEventLines = [];
  let malformedJsonLines = 0;
  for (const line of lines) {
    if (!line.startsWith('{')) {
      nonEventLines.push(line);
      continue;
    }
    try {
      const obj = JSON.parse(line);
      if (isCodexStreamEvent(obj)) {
        parsedEvents.push(obj);
      } else {
        nonEventLines.push(line);
      }
    } catch {
      malformedJsonLines += 1;
      nonEventLines.push(line);
    }
  }

  if (parsedEvents.length === 0) {
    return {
      text: trimmed,
      traceCoverage: 'unavailable',
      toolCalls: [],
      skillsRead: [],
      eventsParsed: false
    };
  }

  const toolCallsById = new Map();
  const unkeyedToolCalls = [];
  const rawInputsByToolEntry = new WeakMap();
  const orderedMessages = [];
  const messageIndexById = new Map();
  let finalResultText = '';

  for (const ev of parsedEvents) {
    const item =
      ev.item && typeof ev.item === 'object'
        ? ev.item
        : ev.payload && typeof ev.payload === 'object'
          ? ev.payload
          : ev.msg && typeof ev.msg === 'object'
            ? ev.msg
            : ev;
    const itemType = item.type || ev.type;

    if (
      itemType === 'command_execution' ||
      itemType === 'exec_command_begin' ||
      itemType === 'exec_command_end' ||
      itemType === 'mcp_tool_call' ||
      itemType === 'file_read' ||
      itemType === 'tool_call' ||
      itemType === 'tool_use' ||
      itemType === 'web_search'
    ) {
      const normalizedType =
        itemType === 'exec_command_begin' || itemType === 'exec_command_end'
          ? 'command_execution'
          : itemType;
      const toolId = item.id || item.call_id || ev.call_id || ev.id || null;

      const parsedArgsObj =
        parseMaybeJsonObject(item.arguments) ||
        parseMaybeJsonObject(item.input) ||
        parseMaybeJsonObject(item.args);
      const incomingRawCommand =
        item.command || item.cmd || parsedArgsObj?.command || parsedArgsObj?.cmd || null;
      const incomingCommand = Array.isArray(incomingRawCommand)
        ? incomingRawCommand.join(' ')
        : incomingRawCommand;
      const incomingPath =
        item.path ||
        item.file_path ||
        parsedArgsObj?.path ||
        parsedArgsObj?.file_path ||
        parsedArgsObj?.target_file ||
        null;
      const incomingName =
        item.tool ||
        item.name ||
        (item.server && item.tool ? `${item.server}.${item.tool}` : null) ||
        null;
      const isCompletionEvent =
        ev.type === 'item.completed' ||
        itemType === 'exec_command_end' ||
        (typeof item.status === 'string' && !isPendingToolStatus(item.status));

      const matchIdx =
        !toolId && isCompletionEvent
          ? findMatchingPendingUnkeyedIndex(unkeyedToolCalls, {
              type: normalizedType,
              name: incomingName || normalizedType,
              command: incomingCommand ? String(incomingCommand) : null,
              path: incomingPath ? String(incomingPath) : null
            })
          : -1;

      const prevEntry = toolId
        ? toolCallsById.get(String(toolId))
        : matchIdx !== -1
          ? unkeyedToolCalls[matchIdx]
          : null;
      const prevRaw = prevEntry ? rawInputsByToolEntry.get(prevEntry) : null;

      const rawCommand = incomingRawCommand || prevRaw?.command || prevEntry?.command || null;
      const command = incomingCommand || prevEntry?.command || null;
      const pathArg = incomingPath || prevEntry?.path || null;
      const name = incomingName || prevEntry?.name || normalizedType;
      const exitCode =
        typeof item.exit_code === 'number'
          ? item.exit_code
          : typeof item.exitCode === 'number'
            ? item.exitCode
            : prevEntry?.exitCode;
      const status =
        item.status ||
        (ev.type === 'item.completed' || itemType === 'exec_command_end'
          ? typeof exitCode === 'number' && exitCode !== 0
            ? 'failed'
            : 'completed'
          : prevEntry?.status || 'observed');

      const entry = {
        ...(toolId ? { id: String(toolId) } : {}),
        type: normalizedType,
        kind: normalizedType,
        name: String(name || normalizedType),
        ...(command ? { command: String(command) } : {}),
        ...(pathArg ? { path: String(pathArg) } : {}),
        ...(typeof exitCode === 'number' ? { exitCode } : {}),
        status
      };

      const mergedRawInput = {
        ...prevRaw,
        type: normalizedType,
        kind: normalizedType,
        name: String(name || normalizedType),
        tool: item.tool || prevRaw?.tool,
        command: rawCommand || command,
        path: pathArg,
        arguments: parsedArgsObj || item.arguments || prevRaw?.arguments,
        input: item.input ?? prevRaw?.input,
        args: item.args ?? prevRaw?.args,
        ...(typeof exitCode === 'number' ? { exitCode } : {}),
        status
      };

      rawInputsByToolEntry.set(entry, mergedRawInput);
      if (toolId) {
        toolCallsById.set(String(toolId), entry);
      } else if (matchIdx !== -1) {
        unkeyedToolCalls[matchIdx] = entry;
      } else {
        unkeyedToolCalls.push(entry);
      }
      continue;
    }

    if (itemType === 'agent_message' || (itemType === 'message' && item.role !== 'user')) {
      const msgText = extractMessageText(item);
      if (msgText && msgText.trim()) {
        const msgId = item.id || ev.id || null;
        if (msgId) {
          const key = String(msgId);
          if (messageIndexById.has(key)) {
            orderedMessages[messageIndexById.get(key)] = msgText;
          } else {
            messageIndexById.set(key, orderedMessages.length);
            orderedMessages.push(msgText);
          }
        } else if (ev.type !== 'item.started') {
          orderedMessages.push(msgText);
        }
      }
      continue;
    }

    if (ev.type === 'response.output_text.done' && typeof ev.text === 'string' && ev.text.trim()) {
      orderedMessages.push(ev.text);
      continue;
    }

    if (ev.type === 'result' && typeof ev.result === 'string' && ev.result.trim()) {
      finalResultText = ev.result;
    }
  }

  const finalToolCalls = [...toolCallsById.values(), ...unkeyedToolCalls];
  const skillsByName = new Map();
  for (const tc of finalToolCalls) {
    const skillInput = rawInputsByToolEntry.get(tc) || tc;
    for (const entry of extractSkillsRead(skillInput)) {
      if (entry && entry.skill && !skillsByName.has(entry.skill)) {
        skillsByName.set(entry.skill, entry);
      }
    }
  }

  const nonEmptyMessages = orderedMessages.map((m) => m.trim()).filter(Boolean);
  const extractedText =
    finalResultText && finalResultText.trim()
      ? finalResultText.trim()
      : nonEmptyMessages.length > 0
        ? nonEmptyMessages[nonEmptyMessages.length - 1]
        : nonEventLines.join('\n').trim();

  return {
    text: extractedText,
    traceCoverage: malformedJsonLines > 0 ? 'partial' : 'full',
    toolCalls: finalToolCalls,
    skillsRead: [...skillsByName.values()],
    eventsParsed: true
  };
}

const CURSOR_EVENT_TYPES = new Set([
  'system',
  'user',
  'assistant',
  'tool_call',
  'tool_use',
  'result',
  'message',
  'agent_message',
  'command_execution',
  'mcp_tool_call',
  'file_read',
  'error',
  'item.started',
  'item.completed',
  'turn.started',
  'turn.completed'
]);

function isCursorStreamEvent(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  if (typeof obj.type === 'string' && CURSOR_EVENT_TYPES.has(obj.type)) {
    return true;
  }
  if (obj.tool_call && typeof obj.tool_call === 'object') {
    return true;
  }
  return false;
}

/**
 * Parses `cursor-agent --output-format stream-json` event stream.
 * Extracts final assistant text, observed tool calls, and verified skill reads.
 * Maintains backwards compatibility when plain text or single non-event JSON is returned.
 *
 * @param {string} stdout
 * @returns {{ text: string, traceCoverage: 'full'|'partial'|'unavailable', toolCalls: Array<Object>, skillsRead: Array<Object>, eventsParsed: boolean }}
 */
export function parseCursorEventStream(stdout) {
  const raw = typeof stdout === 'string' ? stdout : String(stdout || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      text: '',
      traceCoverage: 'unavailable',
      toolCalls: [],
      skillsRead: [],
      eventsParsed: false
    };
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsedEvents = [];
  const nonEventLines = [];
  let malformedJsonLines = 0;
  for (const line of lines) {
    if (!line.startsWith('{')) {
      nonEventLines.push(line);
      continue;
    }
    try {
      const obj = JSON.parse(line);
      if (isCursorStreamEvent(obj)) {
        parsedEvents.push(obj);
      } else {
        nonEventLines.push(line);
      }
    } catch {
      malformedJsonLines += 1;
      nonEventLines.push(line);
    }
  }

  if (parsedEvents.length === 0) {
    return {
      text: trimmed,
      traceCoverage: 'unavailable',
      toolCalls: [],
      skillsRead: [],
      eventsParsed: false
    };
  }

  const toolCallsById = new Map();
  const unkeyedToolCalls = [];
  const rawInputsByToolEntry = new WeakMap();
  const orderedMessages = [];
  const messageIndexById = new Map();
  let finalResultText = '';

  const recordTool = ({
    id,
    type = 'tool_call',
    name,
    command,
    pathArg,
    rawArgs,
    exitCode,
    status = 'completed'
  }) => {
    const matchIdx =
      !id && !isPendingToolStatus(status)
        ? findMatchingPendingUnkeyedIndex(unkeyedToolCalls, {
            type,
            name: String(name || type),
            command: command ? String(command) : null,
            path: pathArg ? String(pathArg) : null
          })
        : -1;

    const prevEntry = id
      ? toolCallsById.get(String(id))
      : matchIdx !== -1
        ? unkeyedToolCalls[matchIdx]
        : null;
    const prevRaw = prevEntry ? rawInputsByToolEntry.get(prevEntry) : null;
    const effectiveCommand = command || prevEntry?.command || null;
    const effectivePath = pathArg || prevEntry?.path || null;
    const effectiveExitCode = typeof exitCode === 'number' ? exitCode : prevEntry?.exitCode;
    const effectiveStatus =
      status === 'completed' && typeof effectiveExitCode === 'number' && effectiveExitCode !== 0
        ? 'failed'
        : status;

    const entry = {
      ...(id ? { id: String(id) } : {}),
      type,
      kind: type,
      name: String(name || prevEntry?.name || type),
      ...(effectiveCommand ? { command: String(effectiveCommand) } : {}),
      ...(effectivePath ? { path: String(effectivePath) } : {}),
      ...(typeof effectiveExitCode === 'number' ? { exitCode: effectiveExitCode } : {}),
      status: effectiveStatus
    };

    const rawInput = {
      ...prevRaw,
      type,
      kind: type,
      name: String(name || prevEntry?.name || type),
      command: effectiveCommand,
      path: effectivePath,
      args: rawArgs ?? prevRaw?.args,
      ...(typeof effectiveExitCode === 'number' ? { exitCode: effectiveExitCode } : {}),
      status: effectiveStatus
    };

    rawInputsByToolEntry.set(entry, rawInput);
    if (id) {
      toolCallsById.set(String(id), entry);
    } else if (matchIdx !== -1) {
      unkeyedToolCalls[matchIdx] = entry;
    } else {
      unkeyedToolCalls.push(entry);
    }
  };

  for (const ev of parsedEvents) {
    const item = ev.item && typeof ev.item === 'object' ? ev.item : ev;
    const evType = item.type || ev.type;

    if (
      evType === 'tool_call' ||
      evType === 'tool_use' ||
      evType === 'command_execution' ||
      evType === 'mcp_tool_call' ||
      evType === 'file_read'
    ) {
      const callId = item.call_id || item.id || ev.call_id || ev.id || null;
      let toolName = item.name || item.tool || evType;
      let command = item.command || item.cmd || null;
      let pathArg = item.path || item.file_path || null;
      let rawArgs = item.args || item.arguments || item.input || null;
      let exitCode =
        typeof item.exit_code === 'number'
          ? item.exit_code
          : typeof item.exitCode === 'number'
            ? item.exitCode
            : undefined;
      let status = ev.subtype || item.status || 'completed';

      if (ev.tool_call && typeof ev.tool_call === 'object') {
        const subKeys = Object.keys(ev.tool_call);
        if (subKeys.length > 0) {
          const subKey = subKeys[0];
          const subVal = ev.tool_call[subKey];
          toolName = subVal?.name || subKey;
          rawArgs = subVal?.args ?? subVal?.input ?? subVal?.arguments ?? rawArgs;
          if (!rawArgs && subVal && typeof subVal === 'object') {
            const hasDirectArgKey = Object.keys(subVal).some(
              (k) => COMMAND_OBJECT_KEYS.has(k) || PATH_OBJECT_KEYS.has(k)
            );
            if (hasDirectArgKey) {
              rawArgs = subVal;
            }
          }
          const parsedSubArgs = parseMaybeJsonObject(rawArgs);
          command = command || parsedSubArgs?.command || parsedSubArgs?.cmd || null;
          pathArg = pathArg || parsedSubArgs?.path || parsedSubArgs?.file_path || parsedSubArgs?.target_file || null;
          if (typeof subVal?.exit_code === 'number') exitCode = subVal.exit_code;
          else if (typeof subVal?.exitCode === 'number') exitCode = subVal.exitCode;
          else if (typeof subVal?.result?.exit_code === 'number') exitCode = subVal.result.exit_code;
          else if (typeof subVal?.result?.exitCode === 'number') exitCode = subVal.result.exitCode;
          if (typeof subVal?.status === 'string') status = subVal.status;
        }
      } else {
        const parsedRawArgs = parseMaybeJsonObject(rawArgs);
        if (parsedRawArgs) {
          command = command || parsedRawArgs.command || parsedRawArgs.cmd || null;
          pathArg = pathArg || parsedRawArgs.path || parsedRawArgs.file_path || parsedRawArgs.target_file || null;
        }
      }

      if (typeof command === 'object' && Array.isArray(command)) {
        command = command.join(' ');
      }

      recordTool({
        id: callId,
        type: evType,
        name: toolName,
        command,
        pathArg,
        rawArgs,
        exitCode,
        status
      });
      continue;
    }

    if (evType === 'assistant' || (evType === 'message' && item.role !== 'user') || evType === 'agent_message') {
      const msgObj = ev.message && typeof ev.message === 'object' ? ev.message : item;
      if (Array.isArray(msgObj?.content)) {
        for (const part of msgObj.content) {
          if (part && typeof part === 'object' && (part.type === 'tool_use' || part.type === 'tool_call')) {
            const rawArgs = part.input || part.args || part.arguments || null;
            const parsedPartArgs = parseMaybeJsonObject(rawArgs);
            recordTool({
              id: part.id || part.call_id || null,
              type: part.type,
              name: part.name || part.tool || part.type,
              command: parsedPartArgs?.command || parsedPartArgs?.cmd || null,
              pathArg: parsedPartArgs?.path || parsedPartArgs?.file_path || parsedPartArgs?.target_file || null,
              rawArgs,
              status: part.status || 'completed'
            });
          }
        }
      }
      const msgText = extractMessageText(msgObj);
      if (msgText && msgText.trim()) {
        const msgId = msgObj.id || item.id || ev.id || null;
        if (msgId) {
          const key = String(msgId);
          if (messageIndexById.has(key)) {
            orderedMessages[messageIndexById.get(key)] = msgText;
          } else {
            messageIndexById.set(key, orderedMessages.length);
            orderedMessages.push(msgText);
          }
        } else if (ev.type !== 'item.started') {
          orderedMessages.push(msgText);
        }
      }
      continue;
    }

    if (evType === 'result' && typeof ev.result === 'string' && ev.result.trim()) {
      finalResultText = ev.result;
    }
  }

  const finalToolCalls = [...toolCallsById.values(), ...unkeyedToolCalls];
  const skillsByName = new Map();
  for (const tc of finalToolCalls) {
    const skillInput = rawInputsByToolEntry.get(tc) || tc;
    for (const entry of extractSkillsRead(skillInput)) {
      if (entry && entry.skill && !skillsByName.has(entry.skill)) {
        skillsByName.set(entry.skill, entry);
      }
    }
  }

  const nonEmptyMessages = orderedMessages.map((m) => m.trim()).filter(Boolean);
  const extractedText =
    finalResultText && finalResultText.trim()
      ? finalResultText.trim()
      : nonEmptyMessages.length > 0
        ? nonEmptyMessages[nonEmptyMessages.length - 1]
        : nonEventLines.join('\n').trim();

  return {
    text: extractedText,
    traceCoverage: malformedJsonLines > 0 ? 'partial' : 'full',
    toolCalls: finalToolCalls,
    skillsRead: [...skillsByName.values()],
    eventsParsed: true
  };
}

/**
 * Normalizes trace metadata on a provider call record.
 *
 * @param {Object} [trace]
 * @param {Object} [defaults]
 * @returns {{ traceCoverage: 'full'|'partial'|'unavailable', toolCalls: Array<Object>, skillsRead: Array<Object>, durationMs: number, outcome: 'success'|'error' }}
 */
export function normalizeProviderTrace(trace, defaults = {}) {
  const validCoverages = new Set(['full', 'partial', 'unavailable']);
  const defaultCoverage = defaults.provider === 'antigravity' ? 'unavailable' : 'partial';
  const traceCoverage = validCoverages.has(trace?.traceCoverage)
    ? trace.traceCoverage
    : defaultCoverage;
  const toolCalls = Array.isArray(trace?.toolCalls) ? trace.toolCalls : [];
  const skillsRead = Array.isArray(trace?.skillsRead) ? trace.skillsRead : [];
  const durationMs =
    typeof trace?.durationMs === 'number'
      ? trace.durationMs
      : (typeof defaults.durationMs === 'number' ? defaults.durationMs : 0);
  const outcome =
    trace?.outcome === 'error' || trace?.outcome === 'success'
      ? trace.outcome
      : (defaults.exitCode === 0 || defaults.exitCode === undefined ? 'success' : 'error');

  return {
    traceCoverage,
    toolCalls,
    skillsRead,
    durationMs,
    outcome
  };
}

/**
 * Executes a CLI process directly via execFile with timeout and abort support.
 * On non-zero exit or ENOENT, attaches exitCode, stdout, and stderr to Error
 * and sanitizes error.message / error.cmd so raw prompts are never leaked.
 *
 * @param {string} executable
 * @param {string[]} [args=[]]
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.cwd]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string|Buffer} [options.input]
 * @param {string} [options.prompt]
 * @param {number} [options.maxBuffer=10485760]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
export async function execCli(executable, args = [], options = {}) {
  const maxBuffer = options.maxBuffer || DEFAULT_MAX_BUFFER;
  const execOptions = {
    maxBuffer,
    encoding: 'utf8',
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {})
  };

  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, execOptions, (error, stdout, stderr) => {
      const out = stdout || '';
      const errOut = stderr || '';

      if (!error) {
        return resolve({ stdout: out, stderr: errOut, exitCode: 0 });
      }

      const exitCode = typeof error.code === 'number'
        ? error.code
        : (typeof error.status === 'number' ? error.status : null);

      error.exitCode = exitCode;
      error.stdout = out;
      error.stderr = errOut;
      sanitizeCliError(error, executable, args, options.prompt);

      reject(error);
    });

    child.stdin?.on?.('error', () => {});
    if (options.input !== undefined && options.input !== null) {
      child.stdin?.end(options.input);
    } else {
      child.stdin?.end();
    }
  });
}

/**
 * Helper to safely record provider call telemetry.
 * Observer errors in onCallRecord, context.onCallRecord, or telemetry.emitProviderCall
 * are isolated so they never alter provider execution outcomes or trigger duplicate recording.
 */
export function recordProviderCall({ context, onCallRecord, record } = {}) {
  if (!record || typeof record !== 'object') {
    return;
  }
  let enrichedRecord;
  try {
    const normalizedTrace = normalizeProviderTrace(record.trace, {
      durationMs: record.durationMs,
      exitCode: record.exitCode,
      provider: record.provider
    });
    enrichedRecord = {
      ...record,
      ...(record.model || context?.model ? { model: record.model || context?.model } : {}),
      tools: record.tools || context?.tools || 'read-only',
      trace: normalizedTrace
    };
  } catch {
    return;
  }
  try {
    if (typeof onCallRecord === 'function') {
      onCallRecord(enrichedRecord);
    }
  } catch {
    // Isolate direct observer callback failure
  }
  try {
    if (typeof context?.onCallRecord === 'function') {
      context.onCallRecord(enrichedRecord);
    }
  } catch {
    // Isolate context observer callback failure
  }
  try {
    if (context?.telemetry && typeof context.telemetry.emitProviderCall === 'function') {
      context.telemetry.emitProviderCall(enrichedRecord);
    }
  } catch {
    // Isolate telemetry emitter failure
  }
}

/**
 * Provider Dispatcher: Antigravity (agy --print)
 * Args: ['--output-format', 'json', '--mode', 'plan', '--sandbox', '--disable-slash-commands', '--model', model, '--effort', effort, '--print=' + prompt]
 * Unwraps { response: "..." } JSON envelope if present.
 * Records traceCoverage: 'unavailable' because agy --print does not expose a structured tool-event stream.
 *
 * @param {Object} params
 * @param {string} [params.executable='agy']
 * @param {string} params.model
 * @param {string} params.prompt
 * @param {AbortSignal} [params.signal]
 * @param {number} [params.timeoutMs]
 * @param {string} [params.cwd]
 * @param {NodeJS.ProcessEnv} [params.env]
 * @param {Function} [params.exec=execCli]
 * @param {Object} [params.context]
 * @param {Function} [params.onCallRecord]
 * @returns {Promise<string>}
 */
export async function runAntigravityCli({
  executable = 'agy',
  model,
  prompt,
  signal,
  timeoutMs,
  cwd,
  env,
  exec = execCli,
  context,
  onCallRecord
} = {}) {
  const parsed = parseModelAndEffort(model, 'high');
  const args = [
    '--output-format', 'json',
    '--mode', 'plan',
    '--sandbox',
    '--disable-slash-commands',
    '--model', parsed.model,
    '--effort', parsed.effort,
    '--print=' + prompt
  ];

  const startTime = Date.now();
  let exitCode = 0;

  try {
    const result = await exec(executable, args, { signal, timeoutMs, cwd, env });
    exitCode = typeof result?.exitCode === 'number' ? result.exitCode : 0;
    const durationMs = Date.now() - startTime;

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'antigravity',
        model,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs,
        trace: {
          traceCoverage: 'unavailable',
          toolCalls: [],
          skillsRead: [],
          durationMs,
          outcome: 'success'
        }
      }
    });

    const raw = result?.stdout || '';

    try {
      const json = JSON.parse(raw);
      if (json && typeof json.response === 'string') {
        return json.response;
      }
    } catch {
      // If not JSON envelope, fallback to raw output
    }

    return raw.trim();
  } catch (err) {
    const durationMs = Date.now() - startTime;
    exitCode = typeof err.exitCode === 'number'
      ? err.exitCode
      : (typeof err.code === 'number' ? err.code : 1);

    sanitizeCliError(err, executable, args, prompt);

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'antigravity',
        model,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs,
        trace: {
          traceCoverage: 'unavailable',
          toolCalls: [],
          skillsRead: [],
          durationMs,
          outcome: 'error'
        }
      }
    });

    throw err;
  }
}

/**
 * Provider Dispatcher: Codex (codex exec)
 * Args: ['exec', '--ephemeral', '--json', '--disable', 'hooks', '--skip-git-repo-check', '--sandbox', 'read-only', '-m', model, '-c', 'model_reasoning_effort="' + codexEffort + '"', prompt]
 *
 * @param {Object} params
 * @param {string} [params.executable='codex']
 * @param {string} params.model
 * @param {string} params.prompt
 * @param {AbortSignal} [params.signal]
 * @param {number} [params.timeoutMs]
 * @param {string} [params.cwd]
 * @param {NodeJS.ProcessEnv} [params.env]
 * @param {Function} [params.exec=execCli]
 * @param {Object} [params.context]
 * @param {Function} [params.onCallRecord]
 * @param {boolean} [params.ignoreUserConfig=false]
 * @param {boolean} [params.disableHooks=true]
 * @returns {Promise<string>}
 */
export async function runCodexCli({
  executable = 'codex',
  model,
  prompt,
  signal,
  timeoutMs,
  cwd,
  env,
  exec = execCli,
  context,
  onCallRecord,
  ignoreUserConfig,
  disableHooks
} = {}) {
  const parsed = parseModelAndEffort(model, 'high');
  const shouldDisableHooks =
    disableHooks !== undefined ? Boolean(disableHooks) : context?.disableHooks !== false;
  const shouldIgnoreUserConfig =
    ignoreUserConfig !== undefined ? Boolean(ignoreUserConfig) : Boolean(context?.ignoreUserConfig);
  const args = [
    'exec',
    '--ephemeral',
    '--json',
    ...(shouldDisableHooks ? ['--disable', 'hooks'] : []),
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '-m', parsed.model,
    '-c', `model_reasoning_effort="${parsed.codexEffort}"`,
    prompt
  ];

  if (shouldIgnoreUserConfig) {
    args.splice(args.indexOf('--ephemeral') + 1, 0, '--ignore-user-config');
  }

  const startTime = Date.now();
  let exitCode = 0;

  try {
    const result = await exec(executable, args, { signal, timeoutMs, cwd, env });
    exitCode = typeof result?.exitCode === 'number' ? result.exitCode : 0;
    const durationMs = Date.now() - startTime;
    const parsedStream = parseCodexEventStream(result?.stdout || '');

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'codex',
        model,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs,
        trace: {
          traceCoverage: parsedStream.traceCoverage,
          toolCalls: parsedStream.toolCalls,
          skillsRead: parsedStream.skillsRead,
          durationMs,
          outcome: 'success'
        }
      }
    });

    return parsedStream.text;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    exitCode = typeof err.exitCode === 'number'
      ? err.exitCode
      : (typeof err.code === 'number' ? err.code : 1);

    sanitizeCliError(err, executable, args, prompt);
    const parsedErrStream = parseCodexEventStream(err?.stdout || '');

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'codex',
        model,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs,
        trace: {
          traceCoverage: parsedErrStream.eventsParsed ? parsedErrStream.traceCoverage : 'unavailable',
          toolCalls: parsedErrStream.toolCalls,
          skillsRead: parsedErrStream.skillsRead,
          durationMs,
          outcome: 'error'
        }
      }
    });

    throw err;
  }
}

/**
 * Provider Dispatcher: Cursor (cursor-agent --print / agent fallback)
 * Args: ['--print', '--output-format', 'stream-json', '--trust', '--mode', 'plan', '--sandbox', 'enabled', '--model', model, prompt]
 * Automatically retries with 'agent' binary if 'cursor-agent' exits with ENOENT.
 *
 * @param {Object} params
 * @param {string} [params.executable='cursor-agent']
 * @param {string} params.model
 * @param {string} params.prompt
 * @param {AbortSignal} [params.signal]
 * @param {number} [params.timeoutMs]
 * @param {string} [params.cwd]
 * @param {NodeJS.ProcessEnv} [params.env]
 * @param {Function} [params.exec=execCli]
 * @param {Object} [params.context]
 * @param {Function} [params.onCallRecord]
 * @returns {Promise<string>}
 */
export async function runCursorCli({
  executable = 'cursor-agent',
  model,
  prompt,
  signal,
  timeoutMs,
  cwd,
  env,
  exec = execCli,
  context,
  onCallRecord
} = {}) {
  const parsed = parseModelAndEffort(model, 'high');
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--trust',
    '--mode', 'plan',
    '--sandbox', 'enabled',
    '--model', parsed.model,
    prompt
  ];

  const startTime = Date.now();
  let exitCode = 0;

  try {
    const result = await exec(executable, args, { signal, timeoutMs, cwd, env });
    exitCode = typeof result?.exitCode === 'number' ? result.exitCode : 0;
    const durationMs = Date.now() - startTime;
    const parsedStream = parseCursorEventStream(result?.stdout || '');

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'cursor',
        model,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs,
        trace: {
          traceCoverage: parsedStream.traceCoverage,
          toolCalls: parsedStream.toolCalls,
          skillsRead: parsedStream.skillsRead,
          durationMs,
          outcome: 'success'
        }
      }
    });

    return parsedStream.text;
  } catch (err) {
    if (err && err.code === 'ENOENT' && executable === 'cursor-agent') {
      try {
        const fallbackResult = await exec('agent', args, { signal, timeoutMs, cwd, env });
        exitCode = typeof fallbackResult?.exitCode === 'number' ? fallbackResult.exitCode : 0;
        const durationMs = Date.now() - startTime;
        const parsedFallback = parseCursorEventStream(fallbackResult?.stdout || '');

        recordProviderCall({
          context,
          onCallRecord,
          record: {
            participantId: context?.seatId || context?.participantId || 'unknown',
            provider: 'cursor',
            model,
            argv: redactArgv(args, prompt),
            exitCode,
            durationMs,
            trace: {
              traceCoverage: parsedFallback.traceCoverage,
              toolCalls: parsedFallback.toolCalls,
              skillsRead: parsedFallback.skillsRead,
              durationMs,
              outcome: 'success'
            }
          }
        });

        return parsedFallback.text;
      } catch (fallbackErr) {
        const durationMs = Date.now() - startTime;
        exitCode = typeof fallbackErr.exitCode === 'number'
          ? fallbackErr.exitCode
          : (typeof fallbackErr.code === 'number' ? fallbackErr.code : 1);

        sanitizeCliError(fallbackErr, 'agent', args, prompt);
        const parsedFallbackErr = parseCursorEventStream(fallbackErr?.stdout || '');

        recordProviderCall({
          context,
          onCallRecord,
          record: {
            participantId: context?.seatId || context?.participantId || 'unknown',
            provider: 'cursor',
            model,
            argv: redactArgv(args, prompt),
            exitCode,
            durationMs,
            trace: {
              traceCoverage: parsedFallbackErr.eventsParsed ? parsedFallbackErr.traceCoverage : 'unavailable',
              toolCalls: parsedFallbackErr.toolCalls,
              skillsRead: parsedFallbackErr.skillsRead,
              durationMs,
              outcome: 'error'
            }
          }
        });

        throw fallbackErr;
      }
    }

    const durationMs = Date.now() - startTime;
    exitCode = typeof err.exitCode === 'number'
      ? err.exitCode
      : (typeof err.code === 'number' ? err.code : 1);

    sanitizeCliError(err, executable, args, prompt);
    const parsedErrStream = parseCursorEventStream(err?.stdout || '');

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'cursor',
        model,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs,
        trace: {
          traceCoverage: parsedErrStream.eventsParsed ? parsedErrStream.traceCoverage : 'unavailable',
          toolCalls: parsedErrStream.toolCalls,
          skillsRead: parsedErrStream.skillsRead,
          durationMs,
          outcome: 'error'
        }
      }
    });

    throw err;
  }
}
