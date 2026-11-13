/**
 * @fileoverview Pure child_process.execFile CLI Runner for Live Harness Adapters.
 * Zero external dependencies. Zero MCP/UTCP wrappers. Zero GUI windows.
 * Node >= 22 ESM.
 */

import { isUtf8 } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
export function parseModelAndEffort(modelString, defaultEffort, fallbackReasoningEffort = 'high') {
  if (typeof modelString !== 'string' || !modelString.trim()) {
    throw new Error('modelString must be a non-empty string');
  }

  const resolvedDefault = defaultEffort ?? fallbackReasoningEffort ?? 'high';
  const trimmed = modelString.trim();

  // 1. Parenthesized effort format: e.g. "gpt-6-astra (max)"
  const parenMatch = trimmed.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const model = parenMatch[1].trim();
    const rawEffort = parenMatch[2].trim();
    if (!rawEffort) {
      const defaultEff = (resolvedDefault || 'high').toLowerCase();
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
  const defaultEff = (resolvedDefault || 'high').toLowerCase();
  if (!CODEX_EFFORT_MAP[defaultEff]) {
    throw new Error(
      `Configuration error: Unsupported reasoning effort "${resolvedDefault}". Allowed: ${ALLOWED_EFFORTS.join(', ')}.`
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

const EFFORT_RANK = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5
});

/**
 * Downshifts an effort level to a target level if current effort exceeds target.
 * Never upshifts an effort that is already at or below target.
 *
 * @param {string} effort
 * @param {string} [target='low']
 * @returns {string}
 */
export function downshiftEffort(effort, target = 'low') {
  const cur = String(effort || '').toLowerCase().trim();
  const tgt = String(target || 'low').toLowerCase().trim();
  if (EFFORT_RANK[tgt] === undefined) {
    return cur || 'low';
  }
  if (EFFORT_RANK[cur] === undefined) {
    return tgt;
  }
  return EFFORT_RANK[cur] > EFFORT_RANK[tgt] ? tgt : cur;
}

/**
 * Downshifts model reasoning effort for voting or lightweight tasks.
 * Handles parenthesized models (e.g. "gpt-6-astra (max)" -> "gpt-6-astra (low)")
 * and hyphenated suffix models (e.g. "grok-4.7-xhigh" -> "grok-4.7-low").
 * Preserves models without recognized effort tiers (e.g. "composer-2.5").
 *
 * @param {string} model
 * @param {string} [target='low']
 * @returns {string}
 */
export function downshiftModel(model, target = 'low') {
  if (typeof model !== 'string' || !model.trim()) {
    return model;
  }
  const trimmed = model.trim();
  const parenMatch = trimmed.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const baseModel = parenMatch[1].trim();
    const rawEffort = parenMatch[2].trim();
    const newEffort = downshiftEffort(rawEffort, target);
    return `${baseModel} (${newEffort})`;
  }

  for (const suffix of RECOGNIZED_EFFORT_SUFFIXES) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      const rawEffort = suffix.slice(1);
      const newEffort = downshiftEffort(rawEffort, target);
      return `${trimmed.slice(0, -suffix.length)}-${newEffort}`;
    }
  }

  return trimmed;
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
  /(?:^|[\s"'`=,:;()[\]{}\\/])(?:\.agents[\\/])?(?:[\w.-]+[\\/])*skills[\\/]([a-zA-Z0-9._-]+)[\\/]SKILL\.md(?=$|[\s"'`=,:;()[\]{}])/g;

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

const MUTATING_SHELL_COMMANDS = new Set([
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
  'chown',
  'patch',
  'sponge'
]);

const FORBIDDEN_COMMAND_NAMES = new Set([
  'echo',
  'printf',
  ...MUTATING_SHELL_COMMANDS
]);

const SCRIPT_MUTATION_REGEX =
  /\b(?:write_text|write_bytes|writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|unlinkSync|unlink|rmSync|rmdirSync|renameSync|rename|copyFileSync|copyFile|truncateSync|ftruncateSync|shutil\.(?:copy|copy2|copyfile|move|rmtree)|os\.(?:remove|unlink|rename|replace|truncate))\b|\.write\s*\(|open\s*\([^,)]+,\s*['"][rwbtxU]*[wax+][rwbtxU+]*['"]|open\s*\([^)]*\bmode\s*=\s*['"][rwbtxU]*[wax+][rwbtxU+]*['"]/;

const SCRIPT_READ_REGEX =
  /(?:\bopen\s*\(|\bread_text\b|\bread_bytes\b|\breadFileSync\b|\breadFile\b|\bcreateReadStream\b|\bfs\.read\b)/;

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

function stripShellComment(str) {
  let quote = null;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < str.length) {
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '\\' && i + 1 < str.length) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /[\s;()|&]/.test(str[i - 1]))) {
      return str.slice(0, i).trimEnd();
    }
  }
  return str;
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
    if (ch === '\\' && i + 1 < str.length) {
      current += ch + str[i + 1];
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /[\s;()|&]/.test(str[i - 1]))) {
      while (i < str.length && str[i] !== '\n') {
        i += 1;
      }
      if (current.trim()) segments.push(current.trim());
      current = '';
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
      if (str[i + 1] === '&') {
        i += 1;
      }
      continue;
    }
    if (
      ch === '&' &&
      str[i + 1] !== '&' &&
      str[i + 1] !== '>' &&
      str[i - 1] !== '>' &&
      str[i - 1] !== '<' &&
      str[i - 1] !== '|'
    ) {
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

function unwrapShellCommand(cmdStr) {
  if (typeof cmdStr !== 'string') return null;
  const trimmed = cmdStr.trim();
  const shellPrefix = trimmed.match(
    /^(?:\/usr\/bin\/env\s+)?(?:\/[\w.-]+)*\/?(?:zsh|bash|sh)\s+([\s\S]+)$/
  );
  if (!shellPrefix) return null;

  let rest = shellPrefix[1].trimStart();
  while (rest.length > 0) {
    const cMatch = rest.match(/^-[a-zA-Z]*c[a-np-zA-NP-Z]*\s+([\s\S]+)$/);
    if (cMatch) {
      let inner = cMatch[1].trim();
      if (!inner) return null;
      if (inner.startsWith('"') || inner.startsWith("'")) {
        const q = inner[0];
        let closeIdx = -1;
        for (let i = 1; i < inner.length; i += 1) {
          if (inner[i] === '\\' && q === '"' && i + 1 < inner.length) {
            i += 1;
            continue;
          }
          if (inner[i] === q) {
            closeIdx = i;
            break;
          }
        }
        if (closeIdx > 0 && (closeIdx === inner.length - 1 || /^[\s)]/.test(inner.slice(closeIdx + 1)))) {
          inner = inner.slice(1, closeIdx);
          if (q === '"') {
            inner = inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          }
        }
      }
      inner = inner.trim();
      return inner && inner !== trimmed ? inner : null;
    }

    const optWithArgMatch = rest.match(
      /^(?:[-+][a-zA-Z]*[oO]|--(?:rcfile|init-file))\s+(?:"[^"]*"|'[^']*'|[^\s]+)\s+([\s\S]+)$/
    );
    if (optWithArgMatch) {
      rest = optWithArgMatch[1].trimStart();
      continue;
    }

    const flagMatch = rest.match(
      /^(?:--[a-zA-Z0-9_-]+(?:=(?:"[^"]*"|'[^']*'|[^\s]+))?|[-+][a-zA-Z]+)\s+([\s\S]+)$/
    );
    if (flagMatch) {
      rest = flagMatch[1].trimStart();
      continue;
    }

    return null;
  }
  return null;
}

function extractSkillNamesFromText(text) {
  if (typeof text !== 'string' || !text.includes('SKILL.md')) return [];
  const names = [];
  SKILL_PATH_REGEX.lastIndex = 0;
  let match;
  while ((match = SKILL_PATH_REGEX.exec(text)) !== null) {
    if (match[1]) {
      names.push(match[1]);
    }
  }
  return names;
}

function analyzeCommandSkills(cmdInput, depth = 0) {
  const result = { read: [], mutated: new Set() };
  if (!cmdInput || depth > 4) return result;

  if (Array.isArray(cmdInput)) {
    const strItems = cmdInput.filter((x) => typeof x === 'string');
    if (strItems.length === 0) return result;
    const firstBase = strItems[0].split(/[\\/]/).pop().toLowerCase();
    if ((firstBase === 'sh' || firstBase === 'bash' || firstBase === 'zsh') && strItems.length >= 3) {
      const cIdx = strItems.findIndex((arg, idx) => idx > 0 && /^-[a-zA-Z]*c[a-np-zA-NP-Z]*$/.test(arg));
      if (cIdx !== -1 && typeof strItems[cIdx + 1] === 'string') {
        return analyzeCommandSkills(strItems[cIdx + 1], depth + 1);
      }
    }
    const quotedJoined = strItems
      .map((item, idx) =>
        idx > 0 && /[\s;|&><()]/.test(item) && !/^['"].*['"]$/.test(item.trim())
          ? `'${item.replace(/'/g, "'\\''")}'`
          : item
      )
      .join(' ');
    return analyzeCommandSkills(quotedJoined, depth + 1);
  }

  if (typeof cmdInput !== 'string' || !cmdInput.includes('SKILL.md')) {
    return result;
  }

  const cmdStr = cmdInput.trim();
  const segments = splitShellSegments(cmdStr);

  if (segments.length === 1) {
    const singleSeg = stripShellComment(segments[0]).trim();
    if (!singleSeg || !singleSeg.includes('SKILL.md')) {
      return result;
    }
    const unwrappedTop = unwrapShellCommand(singleSeg);
    if (unwrappedTop && unwrappedTop !== singleSeg && unwrappedTop !== cmdStr) {
      return analyzeCommandSkills(unwrappedTop, depth + 1);
    }
  }

  for (const rawSeg of segments) {
    const seg = stripShellComment(rawSeg).trim();
    if (!seg || !seg.includes('SKILL.md')) continue;

    // Reject output redirection (>, >>, >|, &>, &>>) targeting SKILL.md and mark target skills as mutated
    if (
      /(?:[0-9]*>>?\|?|&>>?)\s*(?:"[^"]*SKILL\.md(?=$|[\s"'`=,:;()[\]{}])[^"]*"|'[^']*SKILL\.md(?=$|[\s"'`=,:;()[\]{}])[^']*'|[^\s;|&><]*SKILL\.md(?=$|[\s"'`=,:;()[\]{}]))/.test(
        seg
      )
    ) {
      for (const s of extractSkillNamesFromText(seg)) {
        result.mutated.add(s);
      }
      continue;
    }

    let restSeg = seg.replace(/^[({\s]+/, '');
    while (restSeg) {
      const envMatch = restSeg.match(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+/);
      if (envMatch) {
        restSeg = restSeg.slice(envMatch[0].length);
        continue;
      }
      const wrapperMatch = restSeg.match(
        /^(?:sudo|\/usr\/bin\/env|env|command|builtin|nohup|time)\s+(?:-[a-zA-Z0-9-]+\s+)*/
      );
      if (wrapperMatch) {
        restSeg = restSeg.slice(wrapperMatch[0].length);
        continue;
      }
      break;
    }

    if (/^(?:\/[\w.-]+)*\/?(?:zsh|bash|sh)\s+/.test(restSeg)) {
      const unwrappedSeg = unwrapShellCommand(restSeg);
      if (unwrappedSeg && unwrappedSeg !== restSeg && unwrappedSeg !== seg && unwrappedSeg !== cmdStr) {
        const nested = analyzeCommandSkills(unwrappedSeg, depth + 1);
        for (const s of nested.read) result.read.push(s);
        for (const m of nested.mutated) result.mutated.add(m);
      }
      continue;
    }

    const firstTokenMatch = restSeg.match(/^["']?([^\s"';|&><()]+)["']?/);
    if (!firstTokenMatch) continue;
    const cmdBase = firstTokenMatch[1].split(/[\\/]/).pop().toLowerCase();

    if (MUTATING_SHELL_COMMANDS.has(cmdBase)) {
      for (const s of extractSkillNamesFromText(restSeg)) {
        result.mutated.add(s);
      }
      continue;
    }

    if (FORBIDDEN_COMMAND_NAMES.has(cmdBase) || !ALLOWED_READ_COMMANDS.has(cmdBase)) {
      continue;
    }

    // Reject in-place sed mutations (sed -i / sed -ni / sed -i.bak / sed -ibak / sed --in-place) or sed write flag
    if (
      cmdBase === 'sed' &&
      (/\s(?:--in-place(?:=|\b)|-[neEfrluzsb]*i)/.test(restSeg) ||
        /['"](?:[^'"]*[\s;/0-9$,!])?[wW]\s+[^'"]*SKILL\.md/.test(restSeg))
    ) {
      for (const s of extractSkillNamesFromText(restSeg)) {
        result.mutated.add(s);
      }
      continue;
    }

    // Reject in-place awk mutations (awk -i inplace / -iinplace / --include inplace)
    if (
      cmdBase === 'awk' &&
      /\s(?:-i\s*inplace\b|-i\b|--include(?:=|\s+)['"]?inplace\b)/.test(restSeg)
    ) {
      for (const s of extractSkillNamesFromText(restSeg)) {
        result.mutated.add(s);
      }
      continue;
    }

    // Handle inline script execution in python/python3/node
    if (cmdBase === 'python' || cmdBase === 'python3' || cmdBase === 'node') {
      if (SCRIPT_MUTATION_REGEX.test(restSeg)) {
        for (const s of extractSkillNamesFromText(restSeg)) {
          result.mutated.add(s);
        }
        continue;
      }
      if (!SCRIPT_READ_REGEX.test(restSeg)) {
        continue;
      }
    }

    for (const s of extractSkillNamesFromText(restSeg)) {
      result.read.push(s);
    }
  }

  return result;
}

function extractSkillsFromCommand(cmdInput, depth = 0) {
  const { read, mutated } = analyzeCommandSkills(cmdInput, depth);
  return read.filter((s) => !mutated.has(s));
}

const FAILED_STATUS_REGEX =
  /^(?:failed|error|cancelled|canceled|aborted|declined|denied|timed_out|timeout)$/i;

function parseExitCodeValue(val) {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const num = Number(val.trim());
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return undefined;
}

function extractExitCode(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  const candidates = [
    obj.exit_code,
    obj.exitCode,
    obj.result?.exit_code,
    obj.result?.exitCode,
    obj.result?.success?.exit_code,
    obj.result?.success?.exitCode,
    obj.result?.failure?.exit_code,
    obj.result?.failure?.exitCode,
    obj.error?.exit_code,
    obj.error?.exitCode,
    obj.failure?.exit_code,
    obj.failure?.exitCode
  ];
  for (const c of candidates) {
    const parsed = parseExitCodeValue(c);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function isFailedToolObject(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const code = extractExitCode(obj);
  if (typeof code === 'number' && code !== 0) return true;
  if (typeof obj.status === 'string' && FAILED_STATUS_REGEX.test(obj.status.trim())) {
    return true;
  }
  if (typeof obj.subtype === 'string' && FAILED_STATUS_REGEX.test(obj.subtype.trim())) {
    return true;
  }
  if (obj.success === false || obj.ok === false) return true;
  if (Boolean(obj.error) || Boolean(obj.failure)) return true;
  if (obj.result && typeof obj.result === 'object') {
    if (obj.result.success === false || obj.result.ok === false) return true;
    if (Boolean(obj.result.error) || Boolean(obj.result.failure)) return true;
    if (
      typeof obj.result.status === 'string' &&
      FAILED_STATUS_REGEX.test(obj.result.status.trim())
    ) {
      return true;
    }
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
  'function_call',
  'local_shell_call',
  'custom_tool_call',
  'file_search_call',
  'web_search_call',
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
  return (
    status === 'started' ||
    status === 'in_progress' ||
    status === 'observed' ||
    status === 'updated' ||
    status === 'running' ||
    status === 'pending'
  );
}

function findMatchingPendingUnkeyedIndex(
  unkeyedToolCalls,
  { type, explicitName = null, command = null, path = null },
  explicitNameByToolEntry = null
) {
  const getExistingExplicitName = (existing) =>
    explicitNameByToolEntry
      ? explicitNameByToolEntry.get(existing) || null
      : existing.explicitName || null;

  const hasExplicitNameConflict = (existing) => {
    const existingExplicit = getExistingExplicitName(existing);
    return Boolean(existingExplicit && explicitName && existingExplicit !== explicitName);
  };

  const hasExactExplicitName = (existing) => {
    const existingExplicit = getExistingExplicitName(existing);
    return Boolean(explicitName && existingExplicit === explicitName);
  };

  if (explicitName) {
    for (let i = unkeyedToolCalls.length - 1; i >= 0; i -= 1) {
      const existing = unkeyedToolCalls[i];
      if (!isPendingToolStatus(existing.status)) continue;
      if (existing.type !== type || !hasExactExplicitName(existing)) continue;
      const sameCmd = (existing.command || null) === (command || null);
      const samePath = (existing.path || null) === (path || null);
      if (sameCmd && samePath) {
        return i;
      }
    }
  }
  for (let i = unkeyedToolCalls.length - 1; i >= 0; i -= 1) {
    const existing = unkeyedToolCalls[i];
    if (!isPendingToolStatus(existing.status)) continue;
    if (existing.type !== type || hasExplicitNameConflict(existing)) continue;
    const sameCmd = (existing.command || null) === (command || null);
    const samePath = (existing.path || null) === (path || null);
    if (sameCmd && samePath) {
      return i;
    }
  }
  if (explicitName) {
    for (let i = unkeyedToolCalls.length - 1; i >= 0; i -= 1) {
      const existing = unkeyedToolCalls[i];
      if (!isPendingToolStatus(existing.status)) continue;
      if (existing.type !== type || !hasExactExplicitName(existing)) continue;
      const compatibleCmd = !existing.command || !command || existing.command === command;
      const compatiblePath = !existing.path || !path || existing.path === path;
      if (compatibleCmd && compatiblePath) {
        return i;
      }
    }
  }
  for (let i = unkeyedToolCalls.length - 1; i >= 0; i -= 1) {
    const existing = unkeyedToolCalls[i];
    if (!isPendingToolStatus(existing.status)) continue;
    if (existing.type !== type || hasExplicitNameConflict(existing)) continue;
    const compatibleCmd = !existing.command || !command || existing.command === command;
    const compatiblePath = !existing.path || !path || existing.path === path;
    if (compatibleCmd && compatiblePath) {
      return i;
    }
  }
  return -1;
}

const FORBIDDEN_COUNCIL_PATH_REGEX =
  /(?:^|[\s"'`=,:;()[\]{}|&<>!?*\\/])\.council(?:[\\/]|$|[\s"'`=,:;()[\]{}|&<>!?*])/i;

const FORBIDDEN_COUNCIL_GLOB_REGEX =
  /(?:(?:^|[\s"'`=,:;()[\]{}|&<>!?*\\/])(?:\.[a-z0-9_!^,-]*[?*\[\]{}][?*\[\]{}a-z0-9_!^,-]*[\\/](?:runs(?:[\\/]|$|[\s"'`=,:;()[\]{}|&<>!?*])|telemetry(?:[\\/]|$|[\s"'`=,:;()[\]{}|&<>!?*])|(?:live-run-)?latest[.*a-z0-9_-]*|telemetry-summary[.*a-z0-9_-]*|[*?]+[\\/](?:(?:live-run-)?latest|run-|telemetry-summary))|\.(?:c(?:o(?:u(?:n(?:c(?:i(?:l)?)?)?)?)?)?[?*\[\]{}][?*\[\]{}a-z0-9_!^,-]*|\[(?:[!^][^\]\s/]+|[abd-z0-9_.-]*c[a-z0-9_.-]*|[a-c]-[c-z])\](?:[*?]+|(?:o(?:u(?:n(?:c(?:i(?:l)?)?)?)?)?)?[?*\[\]{}][?*\[\]{}a-z0-9_!^,-]*|[?*\[\]{}a-z0-9_!^,-]*(?:council|ouncil|uncil|ncil|cil))|(?:\[[!^]?[a-z0-9_.-]+\]|\{[a-z0-9_.,-]+\}|[?*])+(?:council|ouncil|uncil|ncil|cil)|\{(?:[^}\s/c]|c(?!ouncil))*council[^}\s/]*\})(?=[\\/]|$|[\s"'`=,:;()[\]{}|&<>!?*])|(?:\?council|\.\*\\?\.?council)(?=[\\/]|$|[\s"'`=,:;()[\]{}|&<>!?*a-z0-9_.-]))|(?:^|[/\s"'`=,:;()|&<>\\])[^/\s"'`=,:;()|&<>\\*]*\*[^/\s"'`=,:;()|&<>\\]*council(?=[\\/]|$|[\s"'`=,:;()[\]{}|&<>!?*a-z0-9_.-]))/i;

const FORBIDDEN_COUNCIL_ARTIFACT_REGEX =
  /(?:^|[\\/\s"'`=,:;()[\]{}*?])(?:(?:live-run-)?latest\.(?:js|json|[a-z0-9_!^,.-]*[*?[\]{}][*?[\]{}a-z0-9_!^,.-]*)|live-run-[a-z0-9_*?[\]{}.-]+|(?:runs[\\/]run-[a-z0-9_*?[\]{}!^,-]+|run-\d+-[a-f0-9]+(?:-[a-z0-9]+)*|run-[a-z0-9_!^,-]*[*?[\]{}][a-z0-9_*?[\]{}!^,-]*)\.(?:js|json|[a-z0-9_!^,.-]*[*?[\]{}][*?[\]{}a-z0-9_!^,.-]*)|[a-z0-9_!^-]*\.(?:meta\.json|events\.jsonl)|telemetry-summary(?:\.(?:json|js|[*?a-z0-9_-]+)|[*?][*?a-z0-9_.-]*))(?:$|[\\/\s"'`=,:;()[\]{}|&<>!?*])/i;

const SAFE_EXCLUSION_ARG_PATTERN =
  '(?!\'?\"?[^\\s\'"\\r\\n;|&<>()`$]*\\.council\\/[a-z0-9_])(?:\'[^\'\\r\\n;|&<>()`$]*\'|"[^"\\r\\n;|&<>()`$]*"|[^\\s;|&<>()`$]+)';

const SAFE_NEGATED_GLOB_ARG_PATTERN =
  '(?!\'?\"?![^\\s\'"\\r\\n;|&<>()`$]*\\.council\\/[a-z0-9_])(?:\'![^\'\\r\\n;|&<>()`$]*\'|"![^"\\r\\n;|&<>()`$]*"|![^\\s;|&<>()`$]+)';

const SEARCH_EXCLUSION_FLAG_REGEX = new RegExp(
  `(?:^|\\s)(?:--(?:exclude-dir|exclude|ignore-dir)(?:=|\\s+)|--ignore=)${SAFE_EXCLUSION_ARG_PATTERN}`,
  'gi'
);

const NEGATED_GLOB_FLAG_REGEX = new RegExp(
  `(?:^|\\s)(?:-g|--i?glob|--filter)(?:=|\\s+)?${SAFE_NEGATED_GLOB_ARG_PATTERN}`,
  'gi'
);

const GIT_EXCLUDE_PATHSPEC_REGEX =
  /(?:^|\s)(?!'?"?:\((?:exclude(?:,glob)?|glob,exclude)\)[^\s'"\r\n;|&<>()`$]*\.council\/[a-z0-9_])(?:':\((?:exclude(?:,glob)?|glob,exclude)\)[^'\r\n;|&<>()`$]*'|":\((?:exclude(?:,glob)?|glob,exclude)\)[^"\r\n;|&<>()`$]*"|:\((?:exclude(?:,glob)?|glob,exclude)\)[^\s;|&<>()`$]+)/gi;

const FIND_SCAN_TOKEN_REGEX =
  /\\\(|\\\)|\\?!(?=\s|\\?\(|$)|[();|&<>]|[\r\n]+|'[^'\r\n]*'|"[^"\r\n]*"|[^\s()'";|&<>]+/g;

function isSafeExclusionToken(token) {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (!trimmed || /[\s;|&<>()`$\r\n]/.test(trimmed)) return false;
  if (/\.council\/[a-z0-9_]/i.test(trimmed)) return false;
  return true;
}

function isSafeFindNegatedGlobToken(token) {
  if (!isSafeExclusionToken(token)) return false;
  return /\/\*\*?['"]?$/.test(token.trim());
}

function isSafeFindStringExclusionToken(rawToken) {
  if (typeof rawToken !== 'string') return false;
  const trimmed = rawToken.trim();
  if (!trimmed) return false;
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
  ) {
    const inner = trimmed.slice(1, -1);
    if (/[\r\n;|&<>()`$]/.test(inner)) return false;
    if (/\.council\/[a-z0-9_]/i.test(inner)) return false;
    return true;
  }
  return isSafeExclusionToken(trimmed);
}

function isSafeFindStringNegatedGlobToken(rawToken) {
  if (!isSafeFindStringExclusionToken(rawToken)) return false;
  const unquoted = stripOuterMatchingQuotes(rawToken.trim());
  return /\/\*\*?$/.test(unquoted);
}

function stripFindExclusionsLinear(str) {
  const hasFindDepthOrDelete = /(?:^|[\s('"\\])-(?:depth|d|delete)\b/i.test(str);
  const tokens = [];
  let m;
  FIND_SCAN_TOKEN_REGEX.lastIndex = 0;
  while ((m = FIND_SCAN_TOKEN_REGEX.exec(str)) !== null) {
    tokens.push({
      text: m[0],
      start: m.index,
      end: m.index + m[0].length
    });
  }
  if (tokens.length === 0) return str;

  const stripRanges = [];
  const negatedParenStack = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const tk = tokens[i].text;

    if (/^[;|&<>]|^[\r\n]/.test(tk)) {
      negatedParenStack.length = 0;
      continue;
    }

    const insideTaintedParen =
      negatedParenStack.length > 0 && negatedParenStack[negatedParenStack.length - 1];
    const prevText = i > 0 ? tokens[i - 1].text : '';
    const precededByNegOrOr =
      insideTaintedParen || /^(?:\\!|!|-not|-o|-or)$/i.test(prevText);

    if (
      !precededByNegOrOr &&
      /^(?:\\!|!|-not)$/i.test(tk) &&
      i + 2 < tokens.length &&
      /^-i?(?:path|wholename)$/i.test(tokens[i + 1].text) &&
      isSafeFindStringNegatedGlobToken(tokens[i + 2].text)
    ) {
      let nextIdx = i + 3;
      while (nextIdx < tokens.length && /^(?:\\\)|\))$/.test(tokens[nextIdx].text)) {
        nextIdx += 1;
      }
      const effectiveAfter = nextIdx < tokens.length ? tokens[nextIdx].text : '';
      if (!/^(?:-o|-or)$/i.test(effectiveAfter)) {
        stripRanges.push([tokens[i].start, tokens[i + 2].end]);
        i += 2;
        continue;
      }
    }

    if (!hasFindDepthOrDelete && !precededByNegOrOr) {
      if (
        /^-i?(?:path|wholename|name|regex)$/i.test(tk) &&
        i + 3 < tokens.length &&
        isSafeFindStringExclusionToken(tokens[i + 1].text)
      ) {
        let pruneIdx = i + 2;
        if (/^(?:-a|-and)$/i.test(tokens[pruneIdx].text)) {
          pruneIdx += 1;
        }
        if (
          pruneIdx + 1 < tokens.length &&
          tokens[pruneIdx].text.toLowerCase() === '-prune' &&
          /^(?:-o|-or)$/i.test(tokens[pruneIdx + 1].text)
        ) {
          stripRanges.push([tokens[i].start, tokens[pruneIdx + 1].end]);
          i = pruneIdx + 1;
          continue;
        }
      }

      if (/^(?:\\\(|\()$/.test(tk)) {
        let k = i + 1;
        let validGroup = false;
        let allClausesPruned = true;
        let clauseCount = 0;
        while (k < tokens.length) {
          const innerTk = tokens[k].text;
          if (/^(?:\\\)|\))$/.test(innerTk)) {
            validGroup = clauseCount > 0;
            break;
          }
          if (
            /^-i?(?:path|wholename|name|regex)$/i.test(innerTk) &&
            k + 1 < tokens.length &&
            isSafeFindStringExclusionToken(tokens[k + 1].text)
          ) {
            clauseCount += 1;
            k += 2;
            const maybeAnd = k < tokens.length ? tokens[k].text : '';
            if (
              /^(?:-a|-and)$/i.test(maybeAnd) &&
              k + 1 < tokens.length &&
              tokens[k + 1].text.toLowerCase() === '-prune'
            ) {
              k += 2;
            } else if (maybeAnd.toLowerCase() === '-prune') {
              k += 1;
            } else {
              allClausesPruned = false;
            }
            const nextInGroup = k < tokens.length ? tokens[k].text : '';
            if (/^(?:\\\)|\))$/.test(nextInGroup)) {
              continue;
            }
            if (
              /^(?:-o|-or)$/i.test(nextInGroup) &&
              k + 1 < tokens.length &&
              /^-i?(?:path|wholename|name|regex)$/i.test(tokens[k + 1].text)
            ) {
              k += 1;
              continue;
            }
          }
          validGroup = false;
          break;
        }

        if (validGroup && k < tokens.length) {
          let afterClose = k + 1;
          let hasOuterPrune = false;
          const afterCloseToken = afterClose < tokens.length ? tokens[afterClose].text : '';
          if (afterCloseToken.toLowerCase() === '-prune') {
            hasOuterPrune = true;
            afterClose += 1;
          } else if (
            /^(?:-a|-and)$/i.test(afterCloseToken) &&
            afterClose + 1 < tokens.length &&
            tokens[afterClose + 1].text.toLowerCase() === '-prune'
          ) {
            hasOuterPrune = true;
            afterClose += 2;
          }
          const orToken = afterClose < tokens.length ? tokens[afterClose].text : '';
          if ((hasOuterPrune || allClausesPruned) && /^(?:-o|-or)$/i.test(orToken)) {
            stripRanges.push([tokens[i].start, tokens[afterClose].end]);
            i = afterClose;
            continue;
          }
        }
      }
    }

    if (/^(?:\\\(|\()$/.test(tk)) {
      negatedParenStack.push(precededByNegOrOr);
    } else if (/^(?:\\\)|\))$/.test(tk)) {
      if (negatedParenStack.length > 0) {
        negatedParenStack.pop();
      }
    }
  }

  if (stripRanges.length === 0) return str;

  let out = '';
  let cursor = 0;
  for (const [start, end] of stripRanges) {
    out += str.slice(cursor, start) + ' ';
    cursor = end;
  }
  out += str.slice(cursor);
  return out;
}

function isSafeExclusionValue(val) {
  if (typeof val === 'string') {
    return isSafeExclusionToken(val);
  }
  if (Array.isArray(val)) {
    return val.every((item) => isSafeExclusionToken(item));
  }
  return false;
}

function stripBenignCouncilExclusions(str) {
  if (typeof str !== 'string' || !str) return '';
  let next = str;

  // 1. Standalone negated glob or git exclude pathspec string (e.g., "!.council/**", ":(exclude).council/**")
  if (
    /^(?!'?"?(?:!|:\((?:exclude(?:,glob)?|glob,exclude)\))[^\s'"\r\n;|&<>()`$]*\.council\/[a-z0-9_])(?:'![^'\r\n\s;|&<>()`$]+'|"![^"\r\n\s;|&<>()`$]+"|![^\s;|&<>()`$]+|':\((?:exclude(?:,glob)?|glob,exclude)\)[^'\r\n\s;|&<>()`$]+'|":\((?:exclude(?:,glob)?|glob,exclude)\)[^"\r\n\s;|&<>()`$]+"|:\((?:exclude(?:,glob)?|glob,exclude)\)[^\s;|&<>()`$]+)$/i.test(
      next.trim()
    )
  ) {
    return '';
  }

  // 2. Search/grep exclusion flags: --exclude-dir, --exclude, --ignore-dir, --ignore=<val>
  next = next.replace(SEARCH_EXCLUSION_FLAG_REGEX, ' ');

  // 3. Negated glob flags (-g '!.council*', -g!.council**, --glob '!.council*', --iglob=!.council*) and git :(exclude) pathspecs
  next = next.replace(NEGATED_GLOB_FLAG_REGEX, ' ');
  next = next.replace(GIT_EXCLUDE_PATHSPEC_REGEX, ' ');

  // 4. find exclusion clauses (linear single-pass token scan when find predicates appear):
  if (/-i?(?:path|wholename|name|regex)\b/i.test(next)) {
    next = stripFindExclusionsLinear(next);
  }

  // 5. Standalone negated glob tokens inside a command or list (e.g., rg "pattern" -g '!.council/**')
  next = next.replace(
    /(?:^|[\s,])(?!'?"?![^\s'"\r\n;|&<>()`$]*\.council\/[a-z0-9_])(?:'![^'\r\n\s;|&<>()`$]+'|"![^"\r\n\s;|&<>()`$]+"|!(?=[.*\\/a-zA-Z0-9_?\[\]{}-]*\.(?:council|meta\.json|events\.jsonl)|[.*\\/a-zA-Z0-9_?\[\]{}-]*(?:latest\.js|telemetry-summary))[.*\\/a-zA-Z0-9_?\[\]{}-]+)(?=$|[\s,])/gi,
    ' '
  );

  return next;
}

const MAX_TRACE_SCAN_BYTES = 262_144;

function sliceUtf8Bytes(str, maxBytes = MAX_TRACE_SCAN_BYTES) {
  if (typeof str !== 'string' || !str) return '';
  const pre = str.length > maxBytes ? str.slice(0, maxBytes) : str;
  if (Buffer.byteLength(pre, 'utf8') <= maxBytes) {
    return pre;
  }
  return Buffer.from(pre, 'utf8')
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD+$/, '');
}

function stripOuterMatchingQuotes(s) {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function normalizeComparablePath(
  rawPath,
  { allowFileUri = false, trimWhitespace = true, stripOuterQuotes = true } = {}
) {
  if (typeof rawPath !== 'string') return null;
  let p = trimWhitespace ? rawPath.trim() : rawPath;
  if (stripOuterQuotes) {
    p = stripOuterMatchingQuotes(p);
  }
  if (!p) return null;

  let fromFileUri = false;
  if (allowFileUri && p.toLowerCase().startsWith('file://')) {
    fromFileUri = true;
    p = p.slice('file://'.length);
    if (p.toLowerCase().startsWith('localhost/')) {
      p = p.slice('localhost'.length);
    }
    try {
      p = decodeURIComponent(p);
    } catch {
      // Keep raw URI path on malformed percent encoding
    }
    if (/^\/[A-Za-z][:|](?:[\\/]|$)/.test(p)) {
      p = `${p[1]}:${p.slice(3)}`;
    } else if (/^[A-Za-z]\|(?:[\\/]|$)/.test(p)) {
      p = `${p[0]}:${p.slice(2)}`;
    }
  }

  const slashPreview = p.replace(/\\/g, '/');
  const isWinDrive = /^[A-Za-z]:(?:\/|$)/.test(slashPreview);
  const isWinBackslashUnc = /^\\\\[^\\]+\\[^\\]+/.test(p);

  if (isWinDrive || isWinBackslashUnc) {
    if (allowFileUri && !fromFileUri && /^[A-Za-z]:$/.test(slashPreview)) {
      return null;
    }
    const winNorm = path.win32.normalize(p).replace(/\\/g, '/').toLowerCase();
    const clean = winNorm.length > 1 ? winNorm.replace(/\/+$/, '') : winNorm;
    return clean || null;
  }

  if (!p.startsWith('/')) {
    return null;
  }

  const posixNorm = path.posix.normalize(p);
  const clean = posixNorm.length > 1 ? posixNorm.replace(/\/+$/, '') : posixNorm;
  return clean || null;
}

function normalizeForbiddenWorkspaceRoots(optionsOrRoots) {
  const rawList = Array.isArray(optionsOrRoots)
    ? optionsOrRoots
    : Array.isArray(optionsOrRoots?.forbiddenWorkspaceRoots)
      ? optionsOrRoots.forbiddenWorkspaceRoots
      : [];
  if (rawList.length === 0) return [];
  const out = [];
  const seen = new Set();
  for (const item of rawList) {
    const clean = normalizeComparablePath(item, { allowFileUri: false });
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function checkSinglePathCandidateAgainstRoots(
  rawCand,
  normRoots,
  { trimWhitespace = false, stripOuterQuotes = false } = {}
) {
  const clean = normalizeComparablePath(rawCand, {
    allowFileUri: true,
    trimWhitespace,
    stripOuterQuotes
  });
  if (!clean) return false;
  for (const root of normRoots) {
    if (clean === root || clean.startsWith(`${root}/`)) {
      return true;
    }
  }
  return false;
}

function isUnquotedWorkspaceTokenDelimiter(ch) {
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\n' ||
    ch === '\r' ||
    ch === '\v' ||
    ch === '\f' ||
    ch === ';' ||
    ch === '|' ||
    ch === '&' ||
    ch === '<' ||
    ch === '>' ||
    ch === '(' ||
    ch === ')' ||
    ch === '`'
  );
}

function decodeAnsiCBodyLinear(body) {
  if (!body || !body.includes('\\')) return body;
  let out = '';
  let pendingBytes = [];
  const flushBytes = () => {
    if (pendingBytes.length > 0) {
      out += Buffer.from(pendingBytes).toString('utf8');
      pendingBytes = [];
    }
  };

  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\' || i + 1 >= body.length) {
      flushBytes();
      out += body[i];
      continue;
    }
    const next = body[i + 1];
    if (next === 'x' && i + 2 < body.length) {
      const h1 = body[i + 2];
      const isHex1 =
        (h1 >= '0' && h1 <= '9') || (h1 >= 'a' && h1 <= 'f') || (h1 >= 'A' && h1 <= 'F');
      if (isHex1) {
        let hexStr = h1;
        if (i + 3 < body.length) {
          const h2 = body[i + 3];
          const isHex2 =
            (h2 >= '0' && h2 <= '9') || (h2 >= 'a' && h2 <= 'f') || (h2 >= 'A' && h2 <= 'F');
          if (isHex2) hexStr += h2;
        }
        pendingBytes.push(parseInt(hexStr, 16) & 0xff);
        i += 1 + hexStr.length;
        continue;
      }
    }
    if (next >= '0' && next <= '7') {
      let octStr = next;
      if (i + 2 < body.length && body[i + 2] >= '0' && body[i + 2] <= '7') {
        octStr += body[i + 2];
        if (i + 3 < body.length && body[i + 3] >= '0' && body[i + 3] <= '7') {
          octStr += body[i + 3];
        }
      }
      pendingBytes.push(parseInt(octStr, 8) & 0xff);
      i += octStr.length;
      continue;
    }
    flushBytes();
    i += 1;
    switch (next) {
      case "'":
      case '"':
      case '\\':
        out += next;
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'v':
        out += '\v';
        break;
      case 'f':
        out += '\f';
        break;
      case 'a':
        out += '\x07';
        break;
      case 'b':
        out += '\b';
        break;
      case 'e':
      case 'E':
        out += '\x1b';
        break;
      default:
        out += `\\${next}`;
        break;
    }
  }
  flushBytes();
  return out;
}

function pushSpanAndAttachedForms(target, buf, leadingUnquotedEnd, trailingUnquotedStart) {
  if (!buf) return;
  let start = 0;
  const maxLead = Math.min(leadingUnquotedEnd, buf.length);
  while (start < maxLead && (buf[start] === '[' || buf[start] === '{')) {
    start += 1;
  }
  let end = buf.length;
  const minTrail = Math.max(start, trailingUnquotedStart);
  while (end > minTrail && (buf[end - 1] === ']' || buf[end - 1] === '}')) {
    end -= 1;
  }
  if (start >= end) return;

  const trimmedTok = start === 0 && end === buf.length ? buf : buf.slice(start, end);
  target.push(trimmedTok);

  const adjLeadUnquoted = Math.max(0, leadingUnquotedEnd - start);
  const eqIdx = trimmedTok.indexOf('=');
  if (eqIdx !== -1 && eqIdx + 1 < trimmedTok.length) {
    let valStart = eqIdx + 1;
    while (
      valStart < adjLeadUnquoted &&
      (trimmedTok[valStart] === '[' || trimmedTok[valStart] === '{')
    ) {
      valStart += 1;
    }
    if (valStart < trimmedTok.length) {
      target.push(trimmedTok.slice(valStart));
    }
  }

  const shortFlagMatch = trimmedTok.match(
    /^-[A-Za-z]((?:\/|\\|[A-Za-z]:[\\/]|file:\/\/).*)$/i
  );
  if (shortFlagMatch) {
    target.push(shortFlagMatch[1]);
  }
}

function extractWorkspacePathCandidatesLinear(str) {
  const candidates = [];
  const len = str.length;
  let i = 0;

  let cachedLineEnd = -1;
  let noSingleOnLine = false;
  let noAnsiSingleOnLine = false;
  let noDoubleOnLine = false;

  const getLineEnd = (pos) => {
    if (pos > cachedLineEnd) {
      let e = pos;
      while (e < len && str[e] !== '\n' && str[e] !== '\r') {
        e += 1;
      }
      cachedLineEnd = e;
      noSingleOnLine = false;
      noAnsiSingleOnLine = false;
      noDoubleOnLine = false;
    }
    return cachedLineEnd;
  };

  while (i < len) {
    while (i < len && isUnquotedWorkspaceTokenDelimiter(str[i])) {
      i += 1;
    }
    if (i >= len) break;

    let rawBuf = '';
    let unescBuf = '';
    let sawLiteral = false;
    let rawLeadEnd = 0;
    let rawTrailStart = 0;
    let unescLeadEnd = 0;
    let unescTrailStart = 0;

    const appendPlain = (piece) => {
      if (!piece) return;
      rawBuf += piece;
      unescBuf += piece;
      if (!sawLiteral) {
        rawLeadEnd = rawBuf.length;
        unescLeadEnd = unescBuf.length;
      }
    };

    const appendLiteral = (rawPiece, unescPiece) => {
      sawLiteral = true;
      rawBuf += rawPiece;
      unescBuf += unescPiece;
      rawTrailStart = rawBuf.length;
      unescTrailStart = unescBuf.length;
    };

    while (i < len) {
      const ch = str[i];
      if (isUnquotedWorkspaceTokenDelimiter(ch)) {
        break;
      }

      // 1. ANSI-C $'...' single-quoted span (if closed on current line)
      if (ch === '$' && i + 1 < len && str[i + 1] === "'") {
        const lineEnd = getLineEnd(i);
        let closeIdx = -1;
        if (!noAnsiSingleOnLine) {
          for (let j = i + 2; j < lineEnd; j += 1) {
            if (str[j] === '\\' && j + 1 < lineEnd) {
              j += 1;
              continue;
            }
            if (str[j] === "'") {
              closeIdx = j;
              break;
            }
          }
          if (closeIdx === -1) {
            noAnsiSingleOnLine = true;
          }
        }
        if (closeIdx !== -1) {
          const decoded = decodeAnsiCBodyLinear(str.slice(i + 2, closeIdx));
          appendLiteral(decoded, decoded);
          i = closeIdx + 1;
          continue;
        }
      }

      // 2. Plain '...' single-quoted span (if closed on current line)
      if (ch === "'") {
        const lineEnd = getLineEnd(i);
        let closeIdx = -1;
        if (!noSingleOnLine) {
          const found = str.indexOf("'", i + 1);
          if (found !== -1 && found < lineEnd) {
            closeIdx = found;
          } else {
            noSingleOnLine = true;
          }
        }
        if (closeIdx !== -1) {
          const inner = str.slice(i + 1, closeIdx);
          appendLiteral(inner, inner);
          i = closeIdx + 1;
          continue;
        }
      }

      // 3. "..." or $"..." double-quoted span (if closed on current line)
      if (ch === '"' || (ch === '$' && i + 1 < len && str[i + 1] === '"')) {
        const quoteOpenIdx = ch === '$' ? i + 1 : i;
        const lineEnd = getLineEnd(quoteOpenIdx);
        let closeIdx = -1;
        if (!noDoubleOnLine) {
          for (let j = quoteOpenIdx + 1; j < lineEnd; j += 1) {
            if (str[j] === '\\' && j + 1 < lineEnd) {
              j += 1;
              continue;
            }
            if (str[j] === '"') {
              closeIdx = j;
              break;
            }
          }
          if (closeIdx === -1) {
            noDoubleOnLine = true;
          }
        }
        if (closeIdx !== -1) {
          appendLiteral('', '');
          let cur = quoteOpenIdx + 1;
          while (cur < closeIdx) {
            if (str[cur] === '\\' && cur + 1 < closeIdx) {
              const next = str[cur + 1];
              if (next === '"' || next === '\\' || next === '$' || next === '`') {
                appendLiteral(next, next);
              } else {
                appendLiteral(`\\${next}`, `\\${next}`);
              }
              cur += 2;
              continue;
            }
            let runEnd = cur;
            while (runEnd < closeIdx && str[runEnd] !== '\\') {
              runEnd += 1;
            }
            const seg = str.slice(cur, runEnd);
            appendLiteral(seg, seg);
            cur = runEnd;
          }
          i = closeIdx + 1;
          continue;
        }
      }

      // 4. Unquoted backslash escape
      if (ch === '\\') {
        if (i + 1 < len) {
          const next = str[i + 1];
          if (next === '\n') {
            i += 2;
            continue;
          }
          const rawPiece =
            isUnquotedWorkspaceTokenDelimiter(next) || next === '"' || next === "'"
              ? next
              : `\\${next}`;
          appendLiteral(rawPiece, next);
          i += 2;
          continue;
        }
        appendPlain('\\');
        i += 1;
        continue;
      }

      // 5. Plain unquoted character run
      let runStart = i;
      i += 1;
      while (i < len) {
        const c = str[i];
        if (
          isUnquotedWorkspaceTokenDelimiter(c) ||
          c === "'" ||
          c === '"' ||
          c === '\\' ||
          (c === '$' && i + 1 < len && (str[i + 1] === "'" || str[i + 1] === '"'))
        ) {
          break;
        }
        i += 1;
      }
      appendPlain(str.slice(runStart, i));
    }

    pushSpanAndAttachedForms(candidates, rawBuf, rawLeadEnd, rawTrailStart);
    if (unescBuf !== rawBuf || unescLeadEnd !== rawLeadEnd || unescTrailStart !== rawTrailStart) {
      pushSpanAndAttachedForms(candidates, unescBuf, unescLeadEnd, unescTrailStart);
    }
  }

  return candidates;
}

function matchesForbiddenWorkspaceRoot(str, normRoots) {
  if (!str || !normRoots || normRoots.length === 0) return false;
  if (!str.includes('/') && !str.includes('\\')) return false;

  if (
    checkSinglePathCandidateAgainstRoots(str, normRoots, {
      trimWhitespace: true,
      stripOuterQuotes: true
    })
  ) {
    return true;
  }

  const rawCandidates = extractWorkspacePathCandidatesLinear(str);

  for (const cand of rawCandidates) {
    if (checkSinglePathCandidateAgainstRoots(cand, normRoots)) {
      return true;
    }
    if (
      !cand.toLowerCase().includes('file://') &&
      !/^[A-Za-z]:[\\/]/.test(cand) &&
      cand.includes(':/')
    ) {
      const parts = cand.split(/:(?=\/)/);
      for (const part of parts) {
        if (checkSinglePathCandidateAgainstRoots(part, normRoots)) {
          return true;
        }
      }
    }
  }

  return false;
}

function matchesForbiddenCouncilPattern(str) {
  if (!str) return false;
  return (
    FORBIDDEN_COUNCIL_PATH_REGEX.test(str) ||
    FORBIDDEN_COUNCIL_GLOB_REGEX.test(str) ||
    FORBIDDEN_COUNCIL_ARTIFACT_REGEX.test(str)
  );
}

function hasOneShotEncodedForbiddenToken(bounded, normRoots) {
  // 1. One-shot printf / ANSI-C octal & \xHH hex escape decode (\056, \143, \x2f, etc.)
  if (bounded.includes('\\')) {
    const escapedDecoded = bounded.replace(
      /\\(0?[0-7]{2,3})|\\x([0-9a-fA-F]{2})/g,
      (full, oct, hex) => {
        const code = oct !== undefined ? parseInt(oct, 8) : parseInt(hex, 16);
        return code >= 32 && code <= 126 ? String.fromCharCode(code) : full;
      }
    );
    if (escapedDecoded !== bounded) {
      const strippedQuotes = escapedDecoded.replace(/\$?['"]/g, '');
      if (
        matchesForbiddenCouncilPattern(escapedDecoded) ||
        matchesForbiddenCouncilPattern(strippedQuotes)
      ) {
        return true;
      }
      if (normRoots.length > 0) {
        const quotePreserved = escapedDecoded.replace(/\$(?=['"])/g, '');
        if (matchesForbiddenWorkspaceRoot(quotePreserved, normRoots)) {
          return true;
        }
      }
    }
  }

  // 2. One-shot standalone base64 literal decode across the full 262,144-byte slice
  const b64Regex = /[A-Za-z0-9+/]{8,}={0,2}/g;
  let match;
  while ((match = b64Regex.exec(bounded)) !== null) {
    const token = match[0];
    if (token.length % 4 === 1) continue;
    const buf = Buffer.from(token, 'base64');
    if (buf.length < 6 || !isUtf8(buf)) {
      continue;
    }
    const decoded = buf.toString('utf8');
    if (decoded.length < 6 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(decoded)) {
      continue;
    }
    if (
      matchesForbiddenCouncilPattern(decoded) ||
      (normRoots.length > 0 && matchesForbiddenWorkspaceRoot(decoded, normRoots))
    ) {
      return true;
    }
  }

  return false;
}

export function hasForbiddenCouncilToken(str, options = null) {
  if (typeof str !== 'string' || !str) return false;
  const bounded = sliceUtf8Bytes(str, MAX_TRACE_SCAN_BYTES);
  const normRoots = normalizeForbiddenWorkspaceRoots(options);

  if (normRoots.length > 0 && matchesForbiddenWorkspaceRoot(bounded, normRoots)) {
    return true;
  }

  const sanitized = stripBenignCouncilExclusions(bounded);
  if (sanitized && sanitized.trim()) {
    if (matchesForbiddenCouncilPattern(sanitized)) return true;
    if (
      sanitized.includes('"') ||
      sanitized.includes("'") ||
      sanitized.includes('\\') ||
      sanitized.includes('[') ||
      sanitized.includes('{') ||
      sanitized.includes('(')
    ) {
      let dequoted = sanitized
        .replace(/\$['"]{2}/g, '')
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\$(?=['"])/g, '');
      if (/[@+*?!]\(/.test(dequoted)) {
        let prevDequoted;
        let passes = 0;
        do {
          prevDequoted = dequoted;
          dequoted = dequoted.replace(/([@+*?!])\(([^()]+)\)/g, (_, op, inner) => {
            if (op === '!') return '*';
            return inner.includes('|') ? `{${inner.replace(/\|/g, ',')}}` : inner;
          });
          passes += 1;
        } while (dequoted !== prevDequoted && passes < 8);
      }
      dequoted = dequoted
        .replace(/\\(?=[.a-zA-Z0-9_/*?[\]{}!^()-])/g, '')
        .replace(/["']/g, '')
        .replace(/\[([a-zA-Z0-9_.-])\]/g, '$1')
        .replace(/\{([a-zA-Z0-9_.-]+)\}/g, '$1');
      if (dequoted !== sanitized && matchesForbiddenCouncilPattern(dequoted)) {
        return true;
      }
    }
  }

  return hasOneShotEncodedForbiddenToken(bounded, normRoots);
}

const FORBIDDEN_ACCESS_OUTPUT_KEYS = new Set([
  'aggregated_output',
  'output',
  'result',
  'stdout',
  'stderr',
  'response',
  'error',
  'failure'
]);

const FORBIDDEN_ACCESS_EXCLUSION_KEYS = new Set([
  'exclude',
  'excludes',
  'Excludes',
  'exclude_dir',
  'excludeDir',
  'excludePatterns',
  'ignore',
  'ignores',
  'ignorePatterns',
  'ignore_dir',
  'ignoreDir'
]);

const FORBIDDEN_ACCESS_OUTER_SKIP_KEYS = new Set([
  ...FORBIDDEN_ACCESS_OUTPUT_KEYS,
  ...EXCLUDED_TRACE_OUTPUT_KEYS,
  ...IGNORED_META_KEYS,
  'name',
  'tool',
  'tool_name',
  'toolName',
  'function_name',
  'functionName'
]);

const FORBIDDEN_ACCESS_INPUT_CONTAINER_KEYS = new Set([
  'args',
  'arguments',
  'input',
  'parameters',
  'params'
]);

function filterBenignStringArrayExclusions(arr) {
  const hasFindDepthOrDelete = arr.some(
    (item) => typeof item === 'string' && /^['"]?-(?:depth|d|delete)['"]?$/i.test(item.trim())
  );
  const result = [];
  const negatedParenStack = [];
  for (let i = 0; i < arr.length; i += 1) {
    const token = arr[i].trim();
    const nextToken = typeof arr[i + 1] === 'string' ? arr[i + 1].trim() : '';
    const thirdToken = typeof arr[i + 2] === 'string' ? arr[i + 2].trim() : '';
    const fourthToken = typeof arr[i + 3] === 'string' ? arr[i + 3].trim() : '';
    const insideTaintedParen =
      negatedParenStack.length > 0 && negatedParenStack[negatedParenStack.length - 1];
    const prevToken = i > 0 && typeof arr[i - 1] === 'string' ? arr[i - 1].trim() : '';
    const precededByNegOrOr =
      insideTaintedParen || /^(?:\\!|!|-not|-o|-or)$/i.test(prevToken);

    if (
      /^--(?:exclude-dir|exclude|ignore-dir)$/i.test(token) &&
      i + 1 < arr.length &&
      isSafeExclusionToken(nextToken)
    ) {
      i += 1;
      continue;
    }
    if (
      /^(?:--(?:exclude-dir|exclude|ignore-dir|ignore)=|(?:-g|--i?glob|--filter)=?['"]?!|['"]?:\((?:exclude(?:,glob)?|glob,exclude)\))/i.test(
        token
      ) &&
      isSafeExclusionToken(token)
    ) {
      continue;
    }
    if (
      /^(?:-g|--i?glob|--filter)$/i.test(token) &&
      /^['"]?!/.test(nextToken) &&
      isSafeExclusionToken(nextToken)
    ) {
      i += 1;
      continue;
    }
    if (
      !precededByNegOrOr &&
      /^(?:\\!|!|-not)$/i.test(token) &&
      /^-i?(?:path|wholename)$/i.test(nextToken) &&
      i + 2 < arr.length &&
      isSafeFindNegatedGlobToken(thirdToken)
    ) {
      let nextIdx = i + 3;
      while (nextIdx < arr.length && /^(?:\\\)|\))$/.test(String(arr[nextIdx] || '').trim())) {
        nextIdx += 1;
      }
      const effectiveAfter = nextIdx < arr.length ? String(arr[nextIdx] || '').trim() : '';
      if (!/^(?:-o|-or)$/i.test(effectiveAfter)) {
        i += 2;
        continue;
      }
    }
    if (!hasFindDepthOrDelete && !precededByNegOrOr) {
      if (
        /^-i?(?:path|wholename|name|regex)$/i.test(token) &&
        isSafeExclusionToken(nextToken)
      ) {
        if (thirdToken === '-prune' && /^(?:-o|-or)$/i.test(fourthToken)) {
          i += 3;
          continue;
        }
        const fifthToken = typeof arr[i + 4] === 'string' ? arr[i + 4].trim() : '';
        if (
          /^(?:-a|-and)$/i.test(thirdToken) &&
          fourthToken === '-prune' &&
          /^(?:-o|-or)$/i.test(fifthToken)
        ) {
          i += 4;
          continue;
        }
      }
      if (/^(?:\\\(|\()$/.test(token)) {
        let k = i + 1;
        let validGroup = false;
        let allClausesPruned = true;
        let clauseCount = 0;
        while (k < arr.length) {
          const tk = String(arr[k] || '').trim();
          if (/^(?:\\\)|\))$/.test(tk)) {
            validGroup = clauseCount > 0;
            break;
          }
          if (
            /^-i?(?:path|wholename|name|regex)$/i.test(tk) &&
            k + 1 < arr.length &&
            isSafeExclusionToken(String(arr[k + 1] || '').trim())
          ) {
            clauseCount += 1;
            k += 2;
            const maybeAnd = k < arr.length ? String(arr[k] || '').trim() : '';
            if (
              /^(?:-a|-and)$/i.test(maybeAnd) &&
              k + 1 < arr.length &&
              String(arr[k + 1] || '').trim() === '-prune'
            ) {
              k += 2;
            } else if (maybeAnd === '-prune') {
              k += 1;
            } else {
              allClausesPruned = false;
            }
            const nextInGroup = k < arr.length ? String(arr[k] || '').trim() : '';
            if (/^(?:\\\)|\))$/.test(nextInGroup)) {
              continue;
            }
            if (
              /^(?:-o|-or)$/i.test(nextInGroup) &&
              k + 1 < arr.length &&
              /^-i?(?:path|wholename|name|regex)$/i.test(String(arr[k + 1] || '').trim())
            ) {
              k += 1;
              continue;
            }
          }
          validGroup = false;
          break;
        }
        if (validGroup && k < arr.length) {
          let afterClose = k + 1;
          let hasOuterPrune = false;
          const afterCloseToken =
            afterClose < arr.length ? String(arr[afterClose] || '').trim() : '';
          if (afterCloseToken === '-prune') {
            hasOuterPrune = true;
            afterClose += 1;
          } else if (
            /^(?:-a|-and)$/i.test(afterCloseToken) &&
            afterClose + 1 < arr.length &&
            String(arr[afterClose + 1] || '').trim() === '-prune'
          ) {
            hasOuterPrune = true;
            afterClose += 2;
          }
          const orToken =
            afterClose < arr.length ? String(arr[afterClose] || '').trim() : '';
          if ((hasOuterPrune || allClausesPruned) && /^(?:-o|-or)$/i.test(orToken)) {
            i = afterClose;
            continue;
          }
        }
      }
    }

    if (/^(?:\\\(|\()$/.test(token)) {
      negatedParenStack.push(precededByNegOrOr);
    } else if (/^(?:\\\)|\))$/.test(token)) {
      if (negatedParenStack.length > 0) {
        negatedParenStack.pop();
      }
    }
    result.push(arr[i]);
  }
  return result;
}

/**
 * Checks whether a path, command string, or tool-call object targets `.council/`.
 *
 * @param {string|Object} value
 * @returns {boolean}
 */
export function isForbiddenCouncilPathOrCommand(value, options = null) {
  if (typeof value === 'string') {
    return hasForbiddenCouncilToken(value, options);
  }
  if (value && typeof value === 'object') {
    return detectForbiddenCouncilAccess(value, null, options).forbiddenStateAccess;
  }
  return false;
}

/**
 * Inspects observed tool calls (and optional raw input map) for forbidden `.council/` state access.
 * Excludes tool output/result keys so benign command output (e.g., `ls` or `git status` output)
 * never triggers a false positive unless the tool input/command/path itself targeted `.council/`.
 *
 * @param {Array<Object>|Object|string} toolCalls
 * @param {WeakMap<Object, Object>|Object|null} [rawInputsByToolEntry]
 * @param {Object|string[]|null} [options]
 * @returns {{ forbiddenStateAccess: boolean, forbiddenAccessDetails: string[] }}
 */
export function detectForbiddenCouncilAccess(
  toolCalls,
  rawInputsByToolEntry = null,
  options = null
) {
  let effectiveRawMap = rawInputsByToolEntry;
  let effectiveOptions = options;
  if (
    rawInputsByToolEntry &&
    typeof rawInputsByToolEntry === 'object' &&
    typeof rawInputsByToolEntry.get !== 'function'
  ) {
    effectiveRawMap = null;
    effectiveOptions = options || rawInputsByToolEntry;
  }

  if (typeof toolCalls === 'string') {
    const boundedInput = sliceUtf8Bytes(toolCalls, MAX_TRACE_SCAN_BYTES);
    const matched = isForbiddenCouncilPathOrCommand(boundedInput, effectiveOptions);
    return {
      forbiddenStateAccess: matched,
      forbiddenAccessDetails: matched ? [boundedInput.trim()] : []
    };
  }
  const list = Array.isArray(toolCalls)
    ? toolCalls
    : toolCalls && typeof toolCalls === 'object'
      ? [toolCalls]
      : [];

  const details = new Set();

  const inspectValue = (val, visited, depth, inInputContainer = false) => {
    if (depth > 20 || val === null || val === undefined) {
      return;
    }
    if (typeof val === 'string') {
      const boundedField = sliceUtf8Bytes(val, MAX_TRACE_SCAN_BYTES);
      const trimmed = boundedField.trim();
      if (!trimmed) {
        return;
      }
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') {
            inspectValue(parsed, visited, depth + 1, true);
            return;
          }
        } catch {
          // Fall through to raw string check
        }
      }
      if (hasForbiddenCouncilToken(trimmed, effectiveOptions)) {
        details.add(trimmed);
      }
      return;
    }
    if (typeof val !== 'object') {
      return;
    }
    const visitKey = `${inInputContainer ? 'in' : 'out'}`;
    let visitedModes = visited.get(val);
    if (visitedModes?.has(visitKey)) {
      return;
    }
    if (!visitedModes) {
      visitedModes = new Set();
      visited.set(val, visitedModes);
    }
    visitedModes.add(visitKey);

    if (Array.isArray(val)) {
      const itemsToInspect = val.every((item) => typeof item === 'string')
        ? filterBenignStringArrayExclusions(val)
        : val;
      for (const item of itemsToInspect) {
        inspectValue(item, visited, depth + 1, inInputContainer);
      }
      return;
    }

    for (const [k, v] of Object.entries(val)) {
      if (FORBIDDEN_ACCESS_EXCLUSION_KEYS.has(k) && isSafeExclusionValue(v)) {
        continue;
      }
      if (!inInputContainer) {
        if ((k === 'action' || k === 'operation') && v && typeof v === 'object') {
          inspectValue(v, visited, depth + 1, true);
          continue;
        }
        if (FORBIDDEN_ACCESS_OUTER_SKIP_KEYS.has(k)) {
          continue;
        }
      } else if (FORBIDDEN_ACCESS_OUTPUT_KEYS.has(k)) {
        continue;
      }
      inspectValue(
        v,
        visited,
        depth + 1,
        inInputContainer || FORBIDDEN_ACCESS_INPUT_CONTAINER_KEYS.has(k)
      );
    }
  };

  for (const tc of list) {
    if (!tc || typeof tc !== 'object') {
      continue;
    }
    const visited = new Map();
    inspectValue(tc, visited, 0, false);
    const rawInput = effectiveRawMap?.get?.(tc);
    if (rawInput && typeof rawInput === 'object') {
      inspectValue(rawInput, visited, 0, false);
    }
  }

  const forbiddenAccessDetails = [...details];
  return {
    forbiddenStateAccess: forbiddenAccessDetails.length > 0,
    forbiddenAccessDetails
  };
}

/**
 * Parses `codex exec --json` JSONL event stream.
 * Extracts final assistant text, observed tool calls, and verified skill reads.
 * Maintains backwards compatibility when plain text or single non-event JSON is returned.
 *
 * @param {string} stdout
 * @param {Object|null} [options]
 * @returns {{ text: string, traceCoverage: 'full'|'partial'|'unavailable', toolCalls: Array<Object>, skillsRead: Array<Object>, forbiddenStateAccess: boolean, forbiddenAccessDetails: string[], eventsParsed: boolean }}
 */
export function parseCodexEventStream(stdout, options = null) {
  const raw = typeof stdout === 'string' ? stdout : String(stdout || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      text: '',
      traceCoverage: 'unavailable',
      toolCalls: [],
      skillsRead: [],
      forbiddenStateAccess: false,
      forbiddenAccessDetails: [],
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
      forbiddenStateAccess: false,
      forbiddenAccessDetails: [],
      eventsParsed: false
    };
  }

  const toolCallsById = new Map();
  const unkeyedToolCalls = [];
  const rawInputsByToolEntry = new WeakMap();
  const explicitNameByToolEntry = new WeakMap();
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
      itemType === 'function_call' ||
      itemType === 'local_shell_call' ||
      itemType === 'custom_tool_call' ||
      itemType === 'file_search_call' ||
      itemType === 'web_search_call' ||
      itemType === 'web_search'
    ) {
      const normalizedType =
        itemType === 'exec_command_begin' ||
        itemType === 'exec_command_end' ||
        itemType === 'local_shell_call'
          ? 'command_execution'
          : itemType;
      const toolId = item.id || item.call_id || ev.call_id || ev.id || null;

      const parsedArgsObj =
        parseMaybeJsonObject(item.arguments) ||
        parseMaybeJsonObject(item.input) ||
        parseMaybeJsonObject(item.args) ||
        parseMaybeJsonObject(item.action);
      const incomingRawCommand =
        item.command ||
        item.cmd ||
        item.action?.command ||
        item.action?.cmd ||
        parsedArgsObj?.command ||
        parsedArgsObj?.cmd ||
        null;
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
        item.tool_name ||
        item.toolName ||
        item.function?.name ||
        item.function_name ||
        item.functionName ||
        ev.tool_name ||
        ev.toolName ||
        ev.name ||
        (item.server && item.tool ? `${item.server}.${item.tool}` : null) ||
        null;

      const parsedCode = extractExitCode(item) ?? extractExitCode(ev);
      const hasCompletionPayload =
        item.result !== undefined ||
        ev.result !== undefined ||
        item.output !== undefined ||
        item.aggregated_output !== undefined ||
        typeof parsedCode === 'number';
      const isStartEvent =
        ev.type === 'item.started' ||
        ev.subtype === 'started' ||
        itemType === 'exec_command_begin' ||
        (item.status === 'started' && ev.type !== 'item.updated' && ev.subtype !== 'updated');
      const isUpdateOrCompletionEvent =
        ev.type === 'item.updated' ||
        ev.type === 'item.completed' ||
        ev.subtype === 'updated' ||
        ev.subtype === 'completed' ||
        itemType === 'exec_command_end' ||
        (!isStartEvent && typeof item.status === 'string' && item.status !== 'started') ||
        hasCompletionPayload ||
        isFailedToolObject(item) ||
        isFailedToolObject(ev);

      const matchIdx =
        !toolId && isUpdateOrCompletionEvent
          ? findMatchingPendingUnkeyedIndex(
              unkeyedToolCalls,
              {
                type: normalizedType,
                explicitName: incomingName ? String(incomingName) : null,
                command: incomingCommand ? String(incomingCommand) : null,
                path: incomingPath ? String(incomingPath) : null
              },
              explicitNameByToolEntry
            )
          : -1;

      const prevEntry = toolId
        ? toolCallsById.get(String(toolId))
        : matchIdx !== -1
          ? unkeyedToolCalls[matchIdx]
          : null;
      const prevRaw = prevEntry ? rawInputsByToolEntry.get(prevEntry) : null;
      const prevExplicitName = prevEntry ? explicitNameByToolEntry.get(prevEntry) || null : null;

      const rawCommand = incomingRawCommand || prevRaw?.command || prevEntry?.command || null;
      const command = incomingCommand || prevEntry?.command || null;
      const pathArg = incomingPath || prevEntry?.path || null;
      const explicitName = incomingName ? String(incomingName) : prevExplicitName;
      const name = explicitName || prevEntry?.name || normalizedType;

      const exitCode = typeof parsedCode === 'number' ? parsedCode : prevEntry?.exitCode;
      const isFailed =
        isFailedToolObject(item) ||
        isFailedToolObject(ev) ||
        (typeof exitCode === 'number' && exitCode !== 0) ||
        prevEntry?.status === 'failed';

      const rawStatus =
        typeof item.status === 'string' && item.status.trim()
          ? item.status.trim()
          : typeof ev.subtype === 'string' && ev.subtype.trim()
            ? ev.subtype.trim()
            : null;
      const status = isFailed
        ? 'failed'
        : ev.type === 'item.updated' || ev.subtype === 'updated'
          ? rawStatus && rawStatus !== 'started' && !FAILED_STATUS_REGEX.test(rawStatus)
            ? rawStatus
            : prevEntry?.status && prevEntry.status !== 'started'
              ? prevEntry.status
              : 'in_progress'
          : rawStatus && !FAILED_STATUS_REGEX.test(rawStatus)
            ? rawStatus
            : ev.type === 'item.completed' || itemType === 'exec_command_end' || hasCompletionPayload
              ? 'completed'
              : ev.type === 'item.started' || itemType === 'exec_command_begin'
                ? 'started'
                : prevEntry?.status || 'observed';

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
        ...ev,
        ...item,
        type: normalizedType,
        kind: normalizedType,
        name: String(name || normalizedType),
        tool: item.tool ?? prevRaw?.tool,
        tool_name: item.tool_name ?? ev.tool_name ?? prevRaw?.tool_name,
        toolName: item.toolName ?? ev.toolName ?? prevRaw?.toolName,
        function: item.function ?? ev.function ?? prevRaw?.function,
        command: rawCommand || command,
        path: pathArg,
        arguments: parsedArgsObj || item.arguments || prevRaw?.arguments,
        input: item.input ?? prevRaw?.input,
        args: item.args ?? prevRaw?.args,
        result: item.result ?? ev.result ?? prevRaw?.result,
        error: item.error ?? ev.error ?? prevRaw?.error,
        failure: item.failure ?? ev.failure ?? prevRaw?.failure,
        subtype: ev.subtype ?? item.subtype ?? prevRaw?.subtype,
        ...(typeof exitCode === 'number' ? { exitCode } : {}),
        status
      };

      rawInputsByToolEntry.set(entry, mergedRawInput);
      if (explicitName) {
        explicitNameByToolEntry.set(entry, explicitName);
      }
      if (toolId) {
        toolCallsById.set(String(toolId), entry);
      } else if (matchIdx !== -1) {
        unkeyedToolCalls[matchIdx] = entry;
      } else {
        unkeyedToolCalls.push(entry);
      }
      continue;
    }

    const msgObj =
      item.message && typeof item.message === 'object'
        ? item.message
        : ev.message && typeof ev.message === 'object'
          ? ev.message
          : item;
    const msgRole = msgObj?.role || item.role || ev.role;
    if (
      itemType === 'agent_message' ||
      (itemType === 'message' && (!msgRole || msgRole === 'assistant'))
    ) {
      if (Array.isArray(msgObj?.content)) {
        for (const part of msgObj.content) {
          if (
            part &&
            typeof part === 'object' &&
            (part.type === 'tool_use' || part.type === 'tool_call' || part.type === 'function_call')
          ) {
            const rawArgs = part.input || part.args || part.arguments || null;
            const parsedPartArgs = parseMaybeJsonObject(rawArgs);
            const partExplicitName =
              part.tool ||
              part.name ||
              part.tool_name ||
              part.toolName ||
              part.function?.name ||
              null;
            const partExitCode = extractExitCode(part);
            const partFailed =
              isFailedToolObject(part) || (typeof partExitCode === 'number' && partExitCode !== 0);
            const partCmd = parsedPartArgs?.command || parsedPartArgs?.cmd || null;
            const partPath =
              parsedPartArgs?.path ||
              parsedPartArgs?.file_path ||
              parsedPartArgs?.target_file ||
              null;
            const partEntry = {
              ...(part.id || part.call_id ? { id: String(part.id || part.call_id) } : {}),
              type: part.type,
              kind: part.type,
              name: String(partExplicitName || part.type),
              ...(partCmd ? { command: String(partCmd) } : {}),
              ...(partPath ? { path: String(partPath) } : {}),
              ...(typeof partExitCode === 'number' ? { exitCode: partExitCode } : {}),
              status: partFailed ? 'failed' : part.status || 'completed'
            };
            rawInputsByToolEntry.set(partEntry, {
              ...part,
              type: part.type,
              kind: part.type,
              name: String(partExplicitName || part.type),
              command: partCmd,
              path: partPath,
              args: rawArgs
            });
            if (partExplicitName) {
              explicitNameByToolEntry.set(partEntry, String(partExplicitName));
            }
            if (part.id || part.call_id) {
              toolCallsById.set(String(part.id || part.call_id), partEntry);
            } else {
              unkeyedToolCalls.push(partEntry);
            }
          }
        }
      }
      const msgText = extractMessageText(msgObj) || extractMessageText(item);
      const msgId = msgObj?.id || item.id || ev.id || null;
      if (msgId) {
        const key = String(msgId);
        const prevText = messageIndexById.has(key) ? orderedMessages[messageIndexById.get(key)] : '';
        const effectiveText = msgText && msgText.trim() ? msgText : prevText;
        if (effectiveText && effectiveText.trim()) {
          if (messageIndexById.has(key)) {
            orderedMessages[messageIndexById.get(key)] = '';
          }
          messageIndexById.set(key, orderedMessages.length);
          orderedMessages.push(effectiveText);
        }
      } else if (msgText && msgText.trim() && ev.type !== 'item.started' && ev.subtype !== 'started') {
        orderedMessages.push(msgText);
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
    try {
      for (const entry of extractSkillsRead(skillInput)) {
        if (entry && entry.skill && !skillsByName.has(entry.skill)) {
          skillsByName.set(entry.skill, entry);
        }
      }
    } catch {
      // Isolate telemetry extraction edge cases
    }
  }

  const forbiddenCheck = detectForbiddenCouncilAccess(
    finalToolCalls,
    rawInputsByToolEntry,
    options
  );

  const nonEmptyMessages = orderedMessages.map((m) => m.trim()).filter(Boolean);
  const extractedText =
    nonEmptyMessages.length > 0
      ? nonEmptyMessages[nonEmptyMessages.length - 1]
      : finalResultText && finalResultText.trim()
        ? finalResultText.trim()
        : nonEventLines.join('\n').trim();

  return {
    text: extractedText,
    traceCoverage: malformedJsonLines > 0 ? 'partial' : 'full',
    toolCalls: finalToolCalls,
    skillsRead: [...skillsByName.values()],
    forbiddenStateAccess: forbiddenCheck.forbiddenStateAccess,
    forbiddenAccessDetails: forbiddenCheck.forbiddenAccessDetails,
    eventsParsed: true
  };
}

const CURSOR_EVENT_TYPES = new Set([
  'system',
  'user',
  'assistant',
  'tool_call',
  'tool_use',
  'function_call',
  'local_shell_call',
  'custom_tool_call',
  'file_search_call',
  'web_search_call',
  'web_search',
  'result',
  'message',
  'agent_message',
  'command_execution',
  'exec_command_begin',
  'exec_command_end',
  'mcp_tool_call',
  'file_read',
  'error',
  'item.started',
  'item.updated',
  'item.completed',
  'turn.started',
  'turn.completed'
]);

function isCursorStreamEvent(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  if (
    typeof obj.type === 'string' &&
    (CURSOR_EVENT_TYPES.has(obj.type) || obj.type.startsWith('item.'))
  ) {
    return true;
  }
  if (obj.tool_call && typeof obj.tool_call === 'object') {
    return true;
  }
  if (obj.item && typeof obj.item === 'object' && typeof obj.item.type === 'string') {
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
 * @param {Object|null} [options]
 * @returns {{ text: string, traceCoverage: 'full'|'partial'|'unavailable', toolCalls: Array<Object>, skillsRead: Array<Object>, forbiddenStateAccess: boolean, forbiddenAccessDetails: string[], eventsParsed: boolean }}
 */
export function parseCursorEventStream(stdout, options = null) {
  const raw = typeof stdout === 'string' ? stdout : String(stdout || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      text: '',
      traceCoverage: 'unavailable',
      toolCalls: [],
      skillsRead: [],
      forbiddenStateAccess: false,
      forbiddenAccessDetails: [],
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
      forbiddenStateAccess: false,
      forbiddenAccessDetails: [],
      eventsParsed: false
    };
  }

  const toolCallsById = new Map();
  const unkeyedToolCalls = [];
  const rawInputsByToolEntry = new WeakMap();
  const explicitNameByToolEntry = new WeakMap();
  const orderedMessages = [];
  const messageIndexById = new Map();
  let finalResultText = '';

  const recordTool = ({
    id,
    type = 'tool_call',
    explicitName = null,
    command,
    pathArg,
    rawArgs,
    exitCode,
    status = 'completed',
    isFailed = false,
    rawEvent = null,
    rawItem = null,
    rawSubVal = null
  }) => {
    const normalizedType =
      type === 'exec_command_begin' ||
      type === 'exec_command_end' ||
      type === 'local_shell_call'
        ? 'command_execution'
        : type;
    const isStart =
      status === 'started' &&
      rawEvent?.type !== 'item.updated' &&
      rawEvent?.subtype !== 'updated';
    const matchIdx =
      !id && !isStart
        ? findMatchingPendingUnkeyedIndex(
            unkeyedToolCalls,
            {
              type: normalizedType,
              explicitName: explicitName ? String(explicitName) : null,
              command: command ? String(command) : null,
              path: pathArg ? String(pathArg) : null
            },
            explicitNameByToolEntry
          )
        : -1;

    const prevEntry = id
      ? toolCallsById.get(String(id))
      : matchIdx !== -1
        ? unkeyedToolCalls[matchIdx]
        : null;
    const prevRaw = prevEntry ? rawInputsByToolEntry.get(prevEntry) : null;
    const prevExplicitName = prevEntry ? explicitNameByToolEntry.get(prevEntry) || null : null;

    const effectiveExplicitName = explicitName ? String(explicitName) : prevExplicitName;
    const resolvedName = effectiveExplicitName || prevEntry?.name || normalizedType;
    const effectiveCommand = command || prevEntry?.command || null;
    const effectivePath = pathArg || prevEntry?.path || null;
    const effectiveExitCode = typeof exitCode === 'number' ? exitCode : prevEntry?.exitCode;
    const effectiveStatus =
      isFailed ||
      prevEntry?.status === 'failed' ||
      (typeof effectiveExitCode === 'number' && effectiveExitCode !== 0)
        ? 'failed'
        : status;

    const entry = {
      ...(id ? { id: String(id) } : {}),
      type: normalizedType,
      kind: normalizedType,
      name: String(resolvedName),
      ...(effectiveCommand ? { command: String(effectiveCommand) } : {}),
      ...(effectivePath ? { path: String(effectivePath) } : {}),
      ...(typeof effectiveExitCode === 'number' ? { exitCode: effectiveExitCode } : {}),
      status: effectiveStatus
    };

    const rawInput = {
      ...prevRaw,
      ...(rawEvent && typeof rawEvent === 'object' ? rawEvent : {}),
      ...(rawItem && typeof rawItem === 'object' ? rawItem : {}),
      ...(rawSubVal && typeof rawSubVal === 'object' ? rawSubVal : {}),
      type: normalizedType,
      kind: normalizedType,
      name: String(resolvedName),
      tool: rawSubVal?.tool ?? rawItem?.tool ?? prevRaw?.tool,
      tool_name:
        rawSubVal?.tool_name ?? rawItem?.tool_name ?? rawEvent?.tool_name ?? prevRaw?.tool_name,
      toolName:
        rawSubVal?.toolName ?? rawItem?.toolName ?? rawEvent?.toolName ?? prevRaw?.toolName,
      function:
        rawSubVal?.function ?? rawItem?.function ?? rawEvent?.function ?? prevRaw?.function,
      command: effectiveCommand,
      path: effectivePath,
      arguments: rawItem?.arguments ?? prevRaw?.arguments,
      input: rawItem?.input ?? prevRaw?.input,
      args: rawArgs ?? prevRaw?.args,
      result: rawSubVal?.result ?? rawItem?.result ?? rawEvent?.result ?? prevRaw?.result,
      error: rawSubVal?.error ?? rawItem?.error ?? rawEvent?.error ?? prevRaw?.error,
      failure: rawSubVal?.failure ?? rawItem?.failure ?? rawEvent?.failure ?? prevRaw?.failure,
      subtype: rawEvent?.subtype ?? rawItem?.subtype ?? prevRaw?.subtype,
      ...(typeof effectiveExitCode === 'number' ? { exitCode: effectiveExitCode } : {}),
      status: effectiveStatus
    };

    rawInputsByToolEntry.set(entry, rawInput);
    if (effectiveExplicitName) {
      explicitNameByToolEntry.set(entry, effectiveExplicitName);
    }
    if (id) {
      toolCallsById.set(String(id), entry);
    } else if (matchIdx !== -1) {
      unkeyedToolCalls[matchIdx] = entry;
    } else {
      unkeyedToolCalls.push(entry);
    }
  };

  for (const ev of parsedEvents) {
    const item =
      ev.item && typeof ev.item === 'object'
        ? ev.item
        : ev.payload && typeof ev.payload === 'object'
          ? ev.payload
          : ev;
    const evType = item.type || ev.type;

    if (
      evType === 'tool_call' ||
      evType === 'tool_use' ||
      evType === 'function_call' ||
      evType === 'local_shell_call' ||
      evType === 'custom_tool_call' ||
      evType === 'file_search_call' ||
      evType === 'web_search_call' ||
      evType === 'web_search' ||
      evType === 'command_execution' ||
      evType === 'exec_command_begin' ||
      evType === 'exec_command_end' ||
      evType === 'mcp_tool_call' ||
      evType === 'file_read'
    ) {
      const callId = item.call_id || item.id || ev.call_id || ev.id || null;
      let explicitName =
        item.tool ||
        item.name ||
        item.tool_name ||
        item.toolName ||
        item.function?.name ||
        item.function_name ||
        item.functionName ||
        ev.tool_name ||
        ev.toolName ||
        ev.name ||
        (item.server && item.tool ? `${item.server}.${item.tool}` : null) ||
        null;
      let command = item.command || item.cmd || item.action?.command || item.action?.cmd || null;
      let pathArg = item.path || item.file_path || null;
      let rawArgs = item.args || item.arguments || item.input || item.action || null;
      let exitCode = extractExitCode(item) ?? extractExitCode(ev);
      let subVal = null;

      const toolCallObj =
        ev.tool_call && typeof ev.tool_call === 'object'
          ? ev.tool_call
          : item.tool_call && typeof item.tool_call === 'object'
            ? item.tool_call
            : null;

      if (toolCallObj) {
        const subKeys = Object.keys(toolCallObj);
        if (subKeys.length > 0) {
          const subKey = subKeys[0];
          subVal = toolCallObj[subKey];
          explicitName =
            subVal?.tool ||
            subVal?.name ||
            subVal?.tool_name ||
            subVal?.toolName ||
            subVal?.function?.name ||
            explicitName ||
            subKey ||
            null;
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
          pathArg =
            pathArg ||
            parsedSubArgs?.path ||
            parsedSubArgs?.file_path ||
            parsedSubArgs?.target_file ||
            null;
          const subExitCode = extractExitCode(subVal);
          if (typeof subExitCode === 'number') {
            exitCode = subExitCode;
          }
        }
      } else {
        const parsedRawArgs = parseMaybeJsonObject(rawArgs);
        if (parsedRawArgs) {
          command = command || parsedRawArgs.command || parsedRawArgs.cmd || null;
          pathArg =
            pathArg ||
            parsedRawArgs.path ||
            parsedRawArgs.file_path ||
            parsedRawArgs.target_file ||
            null;
        }
      }

      if (typeof command === 'object' && Array.isArray(command)) {
        command = command.join(' ');
      }

      const isFailed =
        isFailedToolObject(subVal) ||
        isFailedToolObject(item) ||
        isFailedToolObject(ev) ||
        (typeof exitCode === 'number' && exitCode !== 0);

      const rawStatus =
        typeof subVal?.status === 'string' && subVal.status.trim()
          ? subVal.status.trim()
          : typeof item.status === 'string' && item.status.trim()
            ? item.status.trim()
            : typeof ev.subtype === 'string' && ev.subtype.trim()
              ? ev.subtype.trim()
              : null;

      const status = isFailed
        ? 'failed'
        : ev.type === 'item.updated' || ev.subtype === 'updated'
          ? rawStatus && rawStatus !== 'started' && !FAILED_STATUS_REGEX.test(rawStatus)
            ? rawStatus
            : 'in_progress'
          : rawStatus && !FAILED_STATUS_REGEX.test(rawStatus)
            ? rawStatus
            : ev.type === 'item.started' || evType === 'exec_command_begin'
              ? 'started'
              : 'completed';

      recordTool({
        id: callId,
        type: evType,
        explicitName,
        command,
        pathArg,
        rawArgs,
        exitCode,
        status,
        isFailed,
        rawEvent: ev,
        rawItem: item,
        rawSubVal: subVal
      });
      continue;
    }

    const msgObj =
      ev.message && typeof ev.message === 'object'
        ? ev.message
        : item.message && typeof item.message === 'object'
          ? item.message
          : item;
    const msgRole = msgObj?.role || item.role || ev.role;
    if (
      evType === 'assistant' ||
      evType === 'agent_message' ||
      (evType === 'message' && (!msgRole || msgRole === 'assistant'))
    ) {
      if (Array.isArray(msgObj?.content)) {
        for (const part of msgObj.content) {
          if (
            part &&
            typeof part === 'object' &&
            (part.type === 'tool_use' || part.type === 'tool_call' || part.type === 'function_call')
          ) {
            const rawArgs = part.input || part.args || part.arguments || null;
            const parsedPartArgs = parseMaybeJsonObject(rawArgs);
            const partExplicitName =
              part.tool ||
              part.name ||
              part.tool_name ||
              part.toolName ||
              part.function?.name ||
              null;
            const partExitCode = extractExitCode(part);
            const partFailed =
              isFailedToolObject(part) ||
              (typeof partExitCode === 'number' && partExitCode !== 0);
            recordTool({
              id: part.id || part.call_id || null,
              type: part.type,
              explicitName: partExplicitName,
              command: parsedPartArgs?.command || parsedPartArgs?.cmd || null,
              pathArg:
                parsedPartArgs?.path ||
                parsedPartArgs?.file_path ||
                parsedPartArgs?.target_file ||
                null,
              rawArgs,
              exitCode: partExitCode,
              status: partFailed ? 'failed' : part.status || 'completed',
              isFailed: partFailed,
              rawItem: part
            });
          }
        }
      }
      const msgText = extractMessageText(msgObj) || extractMessageText(item);
      const msgId = msgObj?.id || item.id || ev.id || null;
      if (msgId) {
        const key = String(msgId);
        const prevText = messageIndexById.has(key) ? orderedMessages[messageIndexById.get(key)] : '';
        const effectiveText = msgText && msgText.trim() ? msgText : prevText;
        if (effectiveText && effectiveText.trim()) {
          if (messageIndexById.has(key)) {
            orderedMessages[messageIndexById.get(key)] = '';
          }
          messageIndexById.set(key, orderedMessages.length);
          orderedMessages.push(effectiveText);
        }
      } else if (msgText && msgText.trim() && ev.type !== 'item.started' && ev.subtype !== 'started') {
        orderedMessages.push(msgText);
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
    try {
      for (const entry of extractSkillsRead(skillInput)) {
        if (entry && entry.skill && !skillsByName.has(entry.skill)) {
          skillsByName.set(entry.skill, entry);
        }
      }
    } catch {
      // Isolate telemetry extraction edge cases
    }
  }

  const forbiddenCheck = detectForbiddenCouncilAccess(
    finalToolCalls,
    rawInputsByToolEntry,
    options
  );

  const nonEmptyMessages = orderedMessages.map((m) => m.trim()).filter(Boolean);
  const extractedText =
    nonEmptyMessages.length > 0
      ? nonEmptyMessages[nonEmptyMessages.length - 1]
      : finalResultText && finalResultText.trim()
        ? finalResultText.trim()
        : nonEventLines.join('\n').trim();

  return {
    text: extractedText,
    traceCoverage: malformedJsonLines > 0 ? 'partial' : 'full',
    toolCalls: finalToolCalls,
    skillsRead: [...skillsByName.values()],
    forbiddenStateAccess: forbiddenCheck.forbiddenStateAccess,
    forbiddenAccessDetails: forbiddenCheck.forbiddenAccessDetails,
    eventsParsed: true
  };
}

/**
 * Normalizes trace metadata on a provider call record.
 *
 * @param {Object} [trace]
 * @param {Object} [defaults]
 * @returns {{ traceCoverage: 'full'|'partial'|'unavailable', toolCalls: Array<Object>, skillsRead: Array<Object>, forbiddenStateAccess: boolean, forbiddenAccessDetails: string[], durationMs: number, outcome: 'success'|'error' }}
 */
export function normalizeProviderTrace(trace, defaults = {}) {
  const validCoverages = new Set(['full', 'partial', 'unavailable']);
  const defaultCoverage = defaults.provider === 'antigravity' ? 'unavailable' : 'partial';
  const traceCoverage = validCoverages.has(trace?.traceCoverage)
    ? trace.traceCoverage
    : defaultCoverage;
  const toolCalls = Array.isArray(trace?.toolCalls) ? trace.toolCalls : [];
  const skillsRead = Array.isArray(trace?.skillsRead) ? trace.skillsRead : [];
  const detectedForbidden =
    toolCalls.length > 0
      ? detectForbiddenCouncilAccess(toolCalls)
      : { forbiddenStateAccess: false, forbiddenAccessDetails: [] };
  const mergedDetails = [
    ...new Set([
      ...(Array.isArray(trace?.forbiddenAccessDetails) ? trace.forbiddenAccessDetails : []),
      ...detectedForbidden.forbiddenAccessDetails
    ])
  ];
  const forbiddenStateAccess =
    Boolean(trace?.forbiddenStateAccess) ||
    detectedForbidden.forbiddenStateAccess ||
    mergedDetails.length > 0;
  const durationMs =
    typeof trace?.durationMs === 'number'
      ? trace.durationMs
      : (typeof defaults.durationMs === 'number' ? defaults.durationMs : 0);
  const outcome =
    forbiddenStateAccess
      ? 'error'
      : trace?.outcome === 'error' || trace?.outcome === 'success'
        ? trace.outcome
        : (defaults.exitCode === 0 || defaults.exitCode === undefined ? 'success' : 'error');

  return {
    traceCoverage,
    toolCalls,
    skillsRead,
    forbiddenStateAccess,
    forbiddenAccessDetails: mergedDetails,
    durationMs,
    outcome
  };
}

/**
 * Builds a sanitized child process environment when executing in `cwd`,
 * setting `PWD` to `cwd` and scrubbing inherited `OLDPWD` and `INIT_CWD`
 * so isolated seats do not inherit host repository paths from the parent shell/npm.
 *
 * @param {string|null|undefined} cwd
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv|undefined}
 */
export function buildSanitizedCliEnv(cwd, env) {
  const normalizedCwd = typeof cwd === 'string' ? cwd.trim() : '';
  if (!normalizedCwd) {
    return env;
  }
  const baseEnv = env || process.env;
  const nextEnv = { ...baseEnv, PWD: normalizedCwd };
  if (!env || env.OLDPWD === undefined || !Object.prototype.hasOwnProperty.call(env, 'OLDPWD')) {
    delete nextEnv.OLDPWD;
  }
  if (!env || env.INIT_CWD === undefined || !Object.prototype.hasOwnProperty.call(env, 'INIT_CWD')) {
    delete nextEnv.INIT_CWD;
  }
  return nextEnv;
}

/**
 * Executes a CLI process directly via child_process.spawn with POSIX process-group isolation,
 * bounded stdout/stderr collection, and timeout/abort escalation.
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
const DEFAULT_KILL_GRACE_MS = 250;

export async function execCli(executable, args = [], options = {}) {
  const maxBuffer = options.maxBuffer || DEFAULT_MAX_BUFFER;
  const killGraceMs =
    typeof options.killGraceMs === 'number' &&
    Number.isFinite(options.killGraceMs) &&
    options.killGraceMs >= 0
      ? options.killGraceMs
      : DEFAULT_KILL_GRACE_MS;

  if (options.signal?.aborted) {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    abortErr.code = 'ABORT_ERR';
    abortErr.exitCode = null;
    abortErr.stdout = '';
    abortErr.stderr = '';
    if (options.signal.reason !== undefined) {
      abortErr.cause = options.signal.reason;
    }
    sanitizeCliError(abortErr, executable, args, options.prompt);
    throw abortErr;
  }

  const isPosix = process.platform !== 'win32';
  const normalizedCwd =
    typeof options.cwd === 'string' && options.cwd.trim() ? options.cwd.trim() : undefined;
  const effectiveEnv = buildSanitizedCliEnv(normalizedCwd, options.env);
  const spawnOptions = {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...(isPosix ? { detached: true } : {}),
    ...(normalizedCwd ? { cwd: normalizedCwd } : {}),
    ...(effectiveEnv ? { env: effectiveEnv } : {})
  };

  return new Promise((resolve, reject) => {
    let terminationCause = null;
    let maxBufferError = null;
    let terminating = false;
    let sigkillSent = false;
    let groupDrainExhausted = false;
    let pendingClose = null;
    let settled = false;
    let timeoutTimer = null;
    let killTimer = null;
    let drainTimer = null;
    let child = null;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const clearTimersAndListeners = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (drainTimer) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    const destroyStdioStreams = () => {
      try { child?.stdin?.destroy(); } catch {}
      try { child?.stdout?.destroy(); } catch {}
      try { child?.stderr?.destroy(); } catch {}
    };

    const isProcessGroupDead = () => {
      if (!isPosix || !child?.pid) {
        return true;
      }
      try {
        process.kill(-child.pid, 0);
        return false;
      } catch (err) {
        return Boolean(err && err.code === 'ESRCH');
      }
    };

    const signalProcessTree = (sig) => {
      if (!child || !child.pid) {
        return false;
      }
      if (isPosix) {
        try {
          process.kill(-child.pid, sig);
          return true;
        } catch (err) {
          if (!err || err.code !== 'ESRCH') {
            // Fall through to direct child.kill attempt
          }
        }
      }
      if (child.exitCode === null && child.signalCode === null) {
        try {
          return child.kill(sig);
        } catch {
          return false;
        }
      }
      return false;
    };

    const scheduleStdioDrain = (attempt = 0) => {
      if (settled) {
        return;
      }
      if (drainTimer) {
        if (pendingClose) {
          drainTimer.ref?.();
        }
        return;
      }
      drainTimer = setTimeout(() => {
        drainTimer = null;
        if (settled) {
          return;
        }
        if (!sigkillSent) {
          if (isProcessGroupDead() && pendingClose) {
            finalizeClose(pendingClose.code, pendingClose.signalCode);
            return;
          }
          scheduleStdioDrain(0);
          return;
        }
        if (isProcessGroupDead() || attempt >= 5) {
          if (attempt >= 5) {
            groupDrainExhausted = true;
          }
          destroyStdioStreams();
          if (pendingClose) {
            finalizeClose(pendingClose.code, pendingClose.signalCode);
          }
          return;
        }
        signalProcessTree('SIGKILL');
        scheduleStdioDrain(attempt + 1);
      }, 15);
      if (!pendingClose) {
        drainTimer.unref?.();
      }
    };

    const terminateChild = (cause) => {
      if (settled) {
        return;
      }
      if (terminationCause === null) {
        terminationCause = cause;
      }
      if (terminating || !child || !child.pid) {
        return;
      }
      terminating = true;
      signalProcessTree('SIGTERM');
      if (killGraceMs === 0) {
        sigkillSent = true;
        signalProcessTree('SIGKILL');
        if (pendingClose && isProcessGroupDead()) {
          finalizeClose(pendingClose.code, pendingClose.signalCode);
          return;
        }
        scheduleStdioDrain();
        return;
      }
      if (!killTimer) {
        killTimer = setTimeout(() => {
          killTimer = null;
          if (settled) {
            return;
          }
          if (drainTimer) {
            clearTimeout(drainTimer);
            drainTimer = null;
          }
          sigkillSent = true;
          signalProcessTree('SIGKILL');
          if (pendingClose && isProcessGroupDead()) {
            finalizeClose(pendingClose.code, pendingClose.signalCode);
            return;
          }
          scheduleStdioDrain();
        }, killGraceMs);
        if (!pendingClose) {
          killTimer.unref?.();
        }
      }
    };

    const onAbort = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      terminateChild('abort');
    };

    try {
      child = spawn(executable, args, spawnOptions);
    } catch (spawnErr) {
      settled = true;
      clearTimersAndListeners();
      spawnErr.exitCode = null;
      spawnErr.stdout = '';
      spawnErr.stderr = '';
      sanitizeCliError(spawnErr, executable, args, options.prompt);
      return reject(spawnErr);
    }

    const appendChunk = (chunks, currentBytes, chunk, streamName) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (currentBytes + buf.length > maxBuffer) {
        const remaining = Math.max(0, maxBuffer - currentBytes);
        if (remaining > 0) {
          chunks.push(buf.subarray(0, remaining));
        }
        if (!maxBufferError) {
          maxBufferError = new RangeError(`${streamName} maxBuffer length exceeded`);
          maxBufferError.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        }
        terminateChild('maxBuffer');
        return maxBuffer;
      }
      chunks.push(buf);
      return currentBytes + buf.length;
    };

    child.stdout?.on('data', (chunk) => {
      if (maxBufferError) return;
      stdoutBytes = appendChunk(stdoutChunks, stdoutBytes, chunk, 'stdout');
    });

    child.stderr?.on('data', (chunk) => {
      if (maxBufferError) return;
      stderrBytes = appendChunk(stderrChunks, stderrBytes, chunk, 'stderr');
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimersAndListeners();
      destroyStdioStreams();
      const out = Buffer.concat(stdoutChunks).toString('utf8');
      const errOut = Buffer.concat(stderrChunks).toString('utf8');
      err.exitCode = typeof err.exitCode === 'number' ? err.exitCode : null;
      err.stdout = out;
      err.stderr = errOut;
      sanitizeCliError(err, executable, args, options.prompt);
      reject(err);
    });

    const finalizeClose = (code, signalCode) => {
      if (settled) return;
      settled = true;
      clearTimersAndListeners();
      const out = Buffer.concat(stdoutChunks).toString('utf8');
      const errOut = Buffer.concat(stderrChunks).toString('utf8');

      if (terminationCause === 'abort') {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        abortErr.code = 'ABORT_ERR';
        if (options.signal?.reason !== undefined) {
          abortErr.cause = options.signal.reason;
        }
        abortErr.exitCode = typeof code === 'number' ? code : null;
        abortErr.stdout = out;
        abortErr.stderr = errOut;
        sanitizeCliError(abortErr, executable, args, options.prompt);
        return reject(abortErr);
      }

      if (terminationCause === 'timeout') {
        const timeoutErr = new Error(`Command timed out after ${options.timeoutMs}ms`);
        timeoutErr.killed = true;
        timeoutErr.code = 'ETIMEDOUT';
        timeoutErr.signal = signalCode || child?.signalCode || 'SIGTERM';
        timeoutErr.exitCode = typeof code === 'number' ? code : null;
        timeoutErr.stdout = out;
        timeoutErr.stderr = errOut;
        sanitizeCliError(timeoutErr, executable, args, options.prompt);
        return reject(timeoutErr);
      }

      if (terminationCause === 'maxBuffer') {
        const bufErr = maxBufferError || new RangeError('stdout maxBuffer length exceeded');
        bufErr.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        bufErr.killed = true;
        bufErr.signal = signalCode || child?.signalCode || 'SIGTERM';
        bufErr.exitCode = typeof code === 'number' ? code : null;
        bufErr.stdout = out;
        bufErr.stderr = errOut;
        sanitizeCliError(bufErr, executable, args, options.prompt);
        return reject(bufErr);
      }

      if (code === 0 && !signalCode) {
        return resolve({ stdout: out, stderr: errOut, exitCode: 0 });
      }

      const cmd = [executable, ...(Array.isArray(args) ? args : [])].filter(Boolean).join(' ');
      const failMsg = errOut ? `Command failed: ${cmd}\n${errOut}` : `Command failed: ${cmd}`;
      const error = new Error(failMsg);
      error.cmd = cmd;
      error.killed = Boolean(signalCode);
      error.signal = signalCode || null;
      if (typeof code === 'number') {
        error.code = code;
      }
      error.exitCode = typeof code === 'number' ? code : null;
      error.stdout = out;
      error.stderr = errOut;
      sanitizeCliError(error, executable, args, options.prompt);
      return reject(error);
    };

    child.on('close', (code, signalCode) => {
      if (settled) return;
      if (terminating && !groupDrainExhausted && !isProcessGroupDead()) {
        pendingClose = { code, signalCode };
        killTimer?.ref?.();
        drainTimer?.ref?.();
        scheduleStdioDrain(0);
        return;
      }
      finalizeClose(code, signalCode);
    });

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    if (
      terminationCause === null &&
      typeof options.timeoutMs === 'number' &&
      Number.isFinite(options.timeoutMs) &&
      options.timeoutMs > 0
    ) {
      timeoutTimer = setTimeout(() => {
        timeoutTimer = null;
        terminateChild('timeout');
      }, options.timeoutMs);
      timeoutTimer.unref?.();
    }

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
      tools:
        record.tools === 'none' || context?.tools === 'none'
          ? 'none'
          : (record.tools || context?.tools || 'read-only'),
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

function createForbiddenStateAccessError(details, trace, exitCode = 0) {
  const detailText =
    Array.isArray(details) && details.length > 0 ? details.join(', ') : '.council/';
  const err = new Error(
    `[ForbiddenStateAccessError] Seat attempted to access forbidden .council/ state artifact: ${detailText}`
  );
  err.code = 'FORBIDDEN_STATE_ACCESS';
  err.exitCode = exitCode;
  err.trace = trace;
  return err;
}

const AGY_FAILURE_FINISH_REASONS = new Set(['print_timeout', 'interrupted', 'error']);

function parseAntigravityOutput(raw, options = null) {
  const str = typeof raw === 'string' ? raw : String(raw || '');
  let unwrappedResponse = null;
  let hasFailureMetadata = false;
  let toolCalls = [];
  let traceCoverage = 'unavailable';
  let traceForbidden = false;
  let traceForbiddenDetails = [];
  let traceSkillsRead = [];
  let streamForbidden = false;
  let streamForbiddenDetails = [];
  let streamSkillsRead = [];
  let eventsParsed = false;

  if (!str.trim()) {
    return {
      unwrappedResponse,
      hasFailureMetadata,
      toolCalls,
      skillsRead: [],
      traceCoverage,
      forbiddenStateAccess: false,
      forbiddenAccessDetails: [],
      eventsParsed: false
    };
  }

  try {
    const json = JSON.parse(str);
    if (json && typeof json === 'object') {
      if (typeof json.response === 'string') {
        unwrappedResponse = json.response;
      }
      const finishReason =
        typeof json.finished_reason === 'string'
          ? json.finished_reason.trim().toLowerCase()
          : typeof json.finish_reason === 'string'
            ? json.finish_reason.trim().toLowerCase()
            : '';
      if (AGY_FAILURE_FINISH_REASONS.has(finishReason) || Boolean(json.error)) {
        hasFailureMetadata = true;
      }
      const hasToolArrayProp =
        Array.isArray(json.toolCalls) ||
        Array.isArray(json.tool_calls) ||
        Array.isArray(json.trace?.toolCalls);
      const envelopeTools = [
        ...(Array.isArray(json.toolCalls) ? json.toolCalls : []),
        ...(Array.isArray(json.tool_calls) ? json.tool_calls : []),
        ...(Array.isArray(json.trace?.toolCalls) ? json.trace.toolCalls : [])
      ];
      if (hasToolArrayProp) {
        toolCalls = envelopeTools;
        traceCoverage = json.trace?.traceCoverage || 'partial';
        eventsParsed = true;
      }
      if (json.trace && typeof json.trace === 'object') {
        if (typeof json.trace.traceCoverage === 'string') {
          traceCoverage = json.trace.traceCoverage;
        }
        if (json.trace.forbiddenStateAccess === true) {
          traceForbidden = true;
        }
        if (Array.isArray(json.trace.forbiddenAccessDetails)) {
          traceForbiddenDetails = json.trace.forbiddenAccessDetails;
        }
        if (Array.isArray(json.trace.skillsRead)) {
          traceSkillsRead = json.trace.skillsRead;
        }
      }
      if (envelopeTools.length === 0 || isCursorStreamEvent(json)) {
        const maybeStream = parseCursorEventStream(str, options);
        if (maybeStream.eventsParsed) {
          eventsParsed = true;
          if (toolCalls.length === 0) {
            toolCalls = maybeStream.toolCalls;
          } else if (maybeStream.toolCalls.length > 0) {
            toolCalls = [...toolCalls, ...maybeStream.toolCalls];
          }
          if (!json.trace?.traceCoverage || json.trace.traceCoverage === 'unavailable') {
            traceCoverage = maybeStream.traceCoverage;
          }
          streamForbidden = Boolean(maybeStream.forbiddenStateAccess);
          streamForbiddenDetails = maybeStream.forbiddenAccessDetails || [];
          streamSkillsRead = maybeStream.skillsRead || [];
          if (unwrappedResponse === null && maybeStream.text) {
            unwrappedResponse = maybeStream.text;
          }
        }
      }
    }
  } catch {
    const maybeStream = parseCursorEventStream(str, options);
    if (maybeStream.eventsParsed) {
      eventsParsed = true;
      toolCalls = maybeStream.toolCalls;
      traceCoverage = maybeStream.traceCoverage;
      streamForbidden = Boolean(maybeStream.forbiddenStateAccess);
      streamForbiddenDetails = maybeStream.forbiddenAccessDetails || [];
      streamSkillsRead = maybeStream.skillsRead || [];
      if (maybeStream.text) {
        unwrappedResponse = maybeStream.text;
      }
    }
  }

  const envelopeCheck =
    toolCalls.length > 0
      ? detectForbiddenCouncilAccess(toolCalls, null, options)
      : { forbiddenStateAccess: false, forbiddenAccessDetails: [] };
  const forbiddenAccessDetails = [
    ...new Set([
      ...traceForbiddenDetails,
      ...streamForbiddenDetails,
      ...envelopeCheck.forbiddenAccessDetails
    ])
  ];
  const forbiddenStateAccess =
    Boolean(traceForbidden) ||
    Boolean(streamForbidden) ||
    envelopeCheck.forbiddenStateAccess ||
    forbiddenAccessDetails.length > 0;

  const envelopeSkills = toolCalls.length > 0 ? extractSkillsRead(toolCalls) : [];
  const skillsByName = new Map();
  for (const s of [...traceSkillsRead, ...streamSkillsRead, ...envelopeSkills]) {
    const skillName = typeof s === 'string' ? s : s?.skill;
    if (skillName && !skillsByName.has(skillName)) {
      skillsByName.set(skillName, { skill: skillName, evidence: 'skill_instructions_read' });
    }
  }

  return {
    unwrappedResponse,
    hasFailureMetadata,
    toolCalls,
    skillsRead: [...skillsByName.values()],
    traceCoverage,
    forbiddenStateAccess,
    forbiddenAccessDetails,
    eventsParsed
  };
}

function hasDotCouncilEntry(dirPath) {
  try {
    fs.lstatSync(path.join(dirPath, '.council'));
    return true;
  } catch (err) {
    if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) {
      throw err;
    }
  }
  try {
    const names = fs.readdirSync(dirPath);
    return names.some((name) => name.toLowerCase() === '.council');
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return false;
    }
    throw err;
  }
}

function makeTempDirsWritableForCleanup(dirPath) {
  let stat;
  try {
    stat = fs.lstatSync(dirPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return;
    }
    throw err;
  }
  if (!stat.isDirectory()) {
    return;
  }
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return;
    }
    throw err;
  }
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return;
    }
    throw err;
  }
  for (const name of entries) {
    makeTempDirsWritableForCleanup(path.join(dirPath, name));
  }
}

function cleanupTempWorkspace(tempDir, { suppressErrors = false } = {}) {
  if (!tempDir) return;
  let chmodErr = null;
  try {
    makeTempDirsWritableForCleanup(tempDir);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      chmodErr = err;
    }
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: false });
  } catch (rmErr) {
    if (suppressErrors) {
      return;
    }
    if (rmErr && rmErr.code === 'ENOENT') {
      if (chmodErr) {
        throw chmodErr;
      }
      return;
    }
    throw chmodErr || rmErr;
  }
  if (chmodErr && !suppressErrors) {
    throw chmodErr;
  }
}

function copySafeWorkspace(srcDir, destDir, realRoot, realTempSafeCwd) {
  const names = fs.readdirSync(srcDir);
  for (const name of names) {
    if (name.toLowerCase() === '.council' || name === 'node_modules') {
      continue;
    }
    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);
    const stat = fs.lstatSync(srcPath);

    if (stat.isSymbolicLink()) {
      let realTarget;
      try {
        realTarget = fs.realpathSync(srcPath);
      } catch {
        // Omit broken symlink
        continue;
      }
      const relToRoot = path.relative(realRoot, realTarget);
      if (
        relToRoot === '..' ||
        relToRoot.startsWith('../') ||
        relToRoot.startsWith('..\\') ||
        path.isAbsolute(relToRoot)
      ) {
        // Omit workspace-escaping symlink
        continue;
      }
      const relParts = relToRoot.split(/[\\/]+/).filter(Boolean);
      if (relParts.some((p) => p.toLowerCase() === '.council' || p === 'node_modules')) {
        // Omit symlink targeting .council or node_modules
        continue;
      }
      const mappedAbsTarget = relToRoot ? path.join(realTempSafeCwd, relToRoot) : realTempSafeCwd;
      const relLink = path.relative(path.dirname(destPath), mappedAbsTarget) || '.';
      fs.symlinkSync(relLink, destPath);
    } else if (stat.isDirectory()) {
      const rawDirMode = stat.mode & 0o777;
      const safeDirMode = (rawDirMode & 0o200) === 0 ? 0o700 : (rawDirMode | 0o700);
      fs.mkdirSync(destPath, { mode: safeDirMode });
      fs.chmodSync(destPath, safeDirMode);
      copySafeWorkspace(srcPath, destPath, realRoot, realTempSafeCwd);
    } else if (stat.isFile()) {
      try {
        fs.copyFileSync(srcPath, destPath, fs.constants.COPYFILE_FICLONE);
      } catch (copyErr) {
        if (
          copyErr &&
          (copyErr.code === 'EACCES' || copyErr.code === 'EPERM' || copyErr.code === 'ENOENT')
        ) {
          throw copyErr;
        }
        fs.copyFileSync(srcPath, destPath);
      }
      fs.chmodSync(destPath, (stat.mode & 0o777) | 0o600);
    }
  }
}

function prepareIsolatedCliWorkspace({ effectiveTools, cwd, context, env }) {
  const explicitCwd =
    effectiveTools === 'none'
      ? null
      : typeof cwd === 'string' && cwd.trim()
        ? cwd.trim()
        : typeof context?.cwd === 'string' && context.cwd.trim()
          ? context.cwd.trim()
          : null;

  if (!explicitCwd) {
    const tempCwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-seat-cwd-'));
    return {
      effectiveCwd: tempCwdDir,
      tempCwdDir,
      forbiddenWorkspaceRoots: [],
      effectiveEnv: buildSanitizedCliEnv(tempCwdDir, env)
    };
  }

  if (!hasDotCouncilEntry(explicitCwd)) {
    return {
      effectiveCwd: explicitCwd,
      tempCwdDir: null,
      forbiddenWorkspaceRoots: [],
      effectiveEnv: buildSanitizedCliEnv(explicitCwd, env)
    };
  }

  const resolvedRoot = path.resolve(explicitCwd);
  const realRoot = fs.realpathSync(resolvedRoot);
  const forbiddenWorkspaceRoots = [...new Set([resolvedRoot, realRoot])];
  const tempSafeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'council-safe-cwd-'));

  try {
    const realTempSafeCwd = fs.realpathSync(tempSafeCwd);
    copySafeWorkspace(realRoot, realTempSafeCwd, realRoot, realTempSafeCwd);
  } catch (err) {
    cleanupTempWorkspace(tempSafeCwd, { suppressErrors: true });
    throw err;
  }

  const effectiveEnv = buildSanitizedCliEnv(tempSafeCwd, env);
  if (effectiveEnv && typeof effectiveEnv === 'object') {
    delete effectiveEnv.OLDPWD;
    delete effectiveEnv.INIT_CWD;
  }

  return {
    effectiveCwd: tempSafeCwd,
    tempCwdDir: tempSafeCwd,
    forbiddenWorkspaceRoots,
    effectiveEnv
  };
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
  killGraceMs,
  tools,
  cwd,
  env,
  exec = execCli,
  context,
  onCallRecord
} = {}) {
  const effectiveKillGraceMs = killGraceMs ?? context?.killGraceMs;
  const defaultEffort = context?.reasoningEffort || 'high';
  const parsed = parseModelAndEffort(model, defaultEffort);
  const baseModel = extractCanonicalBaseModel(model, defaultEffort);
  const trimmedModel = String(model || '').trim();
  const isDateStamped = /-\d{8}(?:\s*\([^)]*\))?$/i.test(trimmedModel);
  const isCanonicalAgyFamily =
    baseModel === 'gemini-4-argon' ||
    baseModel === 'gemini-4-carbon' ||
    baseModel === 'claude-opus-5-5' ||
    baseModel === 'claude-sonnet-5-5';
  const agySelectorEffort =
    parsed.effort === 'low' || parsed.effort === 'medium' ? parsed.effort : 'high';
  const cliModel =
    isCanonicalAgyFamily && !isDateStamped ? `${baseModel}-${agySelectorEffort}` : parsed.model;
  const effectiveTools =
    tools === 'none' || context?.tools === 'none'
      ? 'none'
      : (tools ?? context?.tools ?? 'read-only');
  const { effectiveCwd, tempCwdDir, forbiddenWorkspaceRoots, effectiveEnv } =
    prepareIsolatedCliWorkspace({ effectiveTools, cwd, context, env });
  const args = [
    '--output-format', 'json',
    '--mode', 'plan',
    '--sandbox',
    '--disable-slash-commands',
    '--model', cliModel,
    '--effort', parsed.effort,
    '--print=' + prompt
  ];

  const startTime = Date.now();
  let exitCode = 0;
  let cleanedUp = false;
  let primaryError = null;

  try {
    const result = await exec(executable, args, {
      signal,
      timeoutMs,
      ...(effectiveKillGraceMs !== undefined ? { killGraceMs: effectiveKillGraceMs } : {}),
      cwd: effectiveCwd,
      env: effectiveEnv
    });
    exitCode = typeof result?.exitCode === 'number' ? result.exitCode : 0;
    const durationMs = Date.now() - startTime;
    const raw = result?.stdout || '';
    const parsedOut = parseAntigravityOutput(raw, { forbiddenWorkspaceRoots });
    const resolvedOutput =
      typeof parsedOut.unwrappedResponse === 'string'
        ? (parsedOut.unwrappedResponse.trim() ? parsedOut.unwrappedResponse : '')
        : raw.trim();
    const isErrorOutcome =
      parsedOut.forbiddenStateAccess ||
      parsedOut.hasFailureMetadata ||
      !resolvedOutput.trim();

    const trace = {
      traceCoverage: parsedOut.traceCoverage,
      toolCalls: parsedOut.toolCalls,
      skillsRead: parsedOut.skillsRead,
      forbiddenStateAccess: parsedOut.forbiddenStateAccess,
      forbiddenAccessDetails: parsedOut.forbiddenAccessDetails,
      durationMs,
      outcome: isErrorOutcome ? 'error' : 'success'
    };

    if (parsedOut.forbiddenStateAccess) {
      throw createForbiddenStateAccessError(parsedOut.forbiddenAccessDetails, trace, exitCode);
    }

    cleanedUp = true;
    cleanupTempWorkspace(tempCwdDir);

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'antigravity',
        model,
        tools: effectiveTools,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs,
        trace
      }
    });

    return resolvedOutput;
  } catch (err) {
    primaryError = err;
    const durationMs = Date.now() - startTime;
    exitCode = typeof err.exitCode === 'number'
      ? err.exitCode
      : (typeof err.code === 'number' ? err.code : 1);

    sanitizeCliError(err, executable, args, prompt);
    const parsedErr =
      !err?.trace && typeof err?.stdout === 'string' && err.stdout.trim()
        ? parseAntigravityOutput(err.stdout, { forbiddenWorkspaceRoots })
        : null;

    const errorTrace = err?.trace
      ? {
          ...err.trace,
          durationMs: typeof err.trace.durationMs === 'number' ? err.trace.durationMs : durationMs,
          outcome: 'error'
        }
      : {
          traceCoverage: parsedErr ? parsedErr.traceCoverage : 'unavailable',
          toolCalls: parsedErr ? parsedErr.toolCalls : [],
          skillsRead: parsedErr ? parsedErr.skillsRead : [],
          forbiddenStateAccess: parsedErr ? parsedErr.forbiddenStateAccess : false,
          forbiddenAccessDetails: parsedErr ? parsedErr.forbiddenAccessDetails : [],
          durationMs,
          outcome: 'error'
        };
    if (!err.trace && parsedErr?.forbiddenStateAccess) {
      const detailText =
        parsedErr.forbiddenAccessDetails.length > 0
          ? parsedErr.forbiddenAccessDetails.join(', ')
          : '.council/';
      err.code = 'FORBIDDEN_STATE_ACCESS';
      err.message = `[ForbiddenStateAccessError] Seat attempted to access forbidden .council/ state artifact: ${detailText}`;
    }
    err.trace = errorTrace;
    err._providerCallRecorded = true;

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'antigravity',
        model,
        tools: effectiveTools,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs: errorTrace.durationMs,
        trace: errorTrace
      }
    });

    throw err;
  } finally {
    if (!cleanedUp) {
      cleanupTempWorkspace(tempCwdDir, { suppressErrors: primaryError !== null });
    }
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
  killGraceMs,
  tools,
  cwd,
  env,
  exec = execCli,
  context,
  onCallRecord,
  ignoreUserConfig,
  disableHooks
} = {}) {
  const effectiveKillGraceMs = killGraceMs ?? context?.killGraceMs;
  const defaultEffort = context?.reasoningEffort || 'high';
  const parsed = parseModelAndEffort(model, defaultEffort);
  const baseModel = extractCanonicalBaseModel(model, defaultEffort);
  const cliModel =
    baseModel === 'gpt-6-astra' || baseModel === 'gpt-6.1-sol' ? baseModel : parsed.model;
  const effectiveTools =
    tools === 'none' || context?.tools === 'none'
      ? 'none'
      : (tools ?? context?.tools ?? 'read-only');
  const { effectiveCwd, tempCwdDir, forbiddenWorkspaceRoots, effectiveEnv } =
    prepareIsolatedCliWorkspace({ effectiveTools, cwd, context, env });
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
    '-m', cliModel,
    '-c', `model_reasoning_effort="${parsed.codexEffort}"`,
    prompt
  ];

  if (shouldIgnoreUserConfig) {
    args.splice(args.indexOf('--ephemeral') + 1, 0, '--ignore-user-config');
  }

  const startTime = Date.now();
  let exitCode = 0;
  let cleanedUp = false;
  let primaryError = null;

  try {
    const result = await exec(executable, args, {
      signal,
      timeoutMs,
      ...(effectiveKillGraceMs !== undefined ? { killGraceMs: effectiveKillGraceMs } : {}),
      cwd: effectiveCwd,
      env: effectiveEnv
    });
    exitCode = typeof result?.exitCode === 'number' ? result.exitCode : 0;
    const durationMs = Date.now() - startTime;
    const parsedStream = parseCodexEventStream(result?.stdout || '', { forbiddenWorkspaceRoots });

    const trace = {
      traceCoverage: parsedStream.traceCoverage,
      toolCalls: parsedStream.toolCalls,
      skillsRead: parsedStream.skillsRead,
      forbiddenStateAccess: parsedStream.forbiddenStateAccess,
      forbiddenAccessDetails: parsedStream.forbiddenAccessDetails,
      durationMs,
      outcome: parsedStream.forbiddenStateAccess ? 'error' : 'success'
    };

    if (parsedStream.forbiddenStateAccess) {
      throw createForbiddenStateAccessError(parsedStream.forbiddenAccessDetails, trace, exitCode);
    }

    cleanedUp = true;
    cleanupTempWorkspace(tempCwdDir);

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'codex',
        model,
        tools: effectiveTools,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs,
        trace
      }
    });

    return parsedStream.text;
  } catch (err) {
    primaryError = err;
    const durationMs = Date.now() - startTime;
    exitCode = typeof err.exitCode === 'number'
      ? err.exitCode
      : (typeof err.code === 'number' ? err.code : 1);

    sanitizeCliError(err, executable, args, prompt);
    const parsedErrStream = err?.trace
      ? null
      : parseCodexEventStream(err?.stdout || '', { forbiddenWorkspaceRoots });
    const errorTrace = err?.trace
      ? {
          ...err.trace,
          durationMs: typeof err.trace.durationMs === 'number' ? err.trace.durationMs : durationMs,
          outcome: 'error'
        }
      : {
          traceCoverage: parsedErrStream.eventsParsed ? parsedErrStream.traceCoverage : 'unavailable',
          toolCalls: parsedErrStream.toolCalls,
          skillsRead: parsedErrStream.skillsRead,
          forbiddenStateAccess: parsedErrStream.forbiddenStateAccess,
          forbiddenAccessDetails: parsedErrStream.forbiddenAccessDetails,
          durationMs,
          outcome: 'error'
        };
    if (!err.trace && parsedErrStream?.forbiddenStateAccess) {
      err.code = 'FORBIDDEN_STATE_ACCESS';
      err.message = `[ForbiddenStateAccessError] Seat attempted to access forbidden .council/ state artifact: ${parsedErrStream.forbiddenAccessDetails.join(', ')}`;
    }
    err.trace = errorTrace;
    err._providerCallRecorded = true;

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'codex',
        model,
        tools: effectiveTools,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs: errorTrace.durationMs,
        trace: errorTrace
      }
    });

    throw err;
  } finally {
    if (!cleanedUp) {
      cleanupTempWorkspace(tempCwdDir, { suppressErrors: primaryError !== null });
    }
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
  killGraceMs,
  tools,
  cwd,
  env,
  exec = execCli,
  context,
  onCallRecord
} = {}) {
  const effectiveKillGraceMs = killGraceMs ?? context?.killGraceMs;
  const baseModel = extractCanonicalBaseModel(model, 'high');
  const parsed = parseModelAndEffort(
    model,
    baseModel === 'composer-2.5' ? 'high' : (context?.reasoningEffort || 'high')
  );
  const ALLOWED_GROK_CLI_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
  const cliModel =
    baseModel === 'grok-4.7' && parsed.effort && ALLOWED_GROK_CLI_EFFORTS.has(parsed.effort)
      ? `grok-4.7-${parsed.effort}`
      : parsed.model;
  const effectiveTools =
    tools === 'none' || context?.tools === 'none'
      ? 'none'
      : (tools ?? context?.tools ?? 'read-only');
  const { effectiveCwd, tempCwdDir, forbiddenWorkspaceRoots, effectiveEnv } =
    prepareIsolatedCliWorkspace({ effectiveTools, cwd, context, env });
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--trust',
    '--mode', 'plan',
    '--sandbox', 'enabled',
    '--model', cliModel,
    prompt
  ];

  const startTime = Date.now();
  let exitCode = 0;
  let cleanedUp = false;
  let primaryError = null;

  try {
    const result = await exec(executable, args, {
      signal,
      timeoutMs,
      ...(effectiveKillGraceMs !== undefined ? { killGraceMs: effectiveKillGraceMs } : {}),
      cwd: effectiveCwd,
      env: effectiveEnv
    });
    exitCode = typeof result?.exitCode === 'number' ? result.exitCode : 0;
    const durationMs = Date.now() - startTime;
    const parsedStream = parseCursorEventStream(result?.stdout || '', { forbiddenWorkspaceRoots });

    const trace = {
      traceCoverage: parsedStream.traceCoverage,
      toolCalls: parsedStream.toolCalls,
      skillsRead: parsedStream.skillsRead,
      forbiddenStateAccess: parsedStream.forbiddenStateAccess,
      forbiddenAccessDetails: parsedStream.forbiddenAccessDetails,
      durationMs,
      outcome: parsedStream.forbiddenStateAccess ? 'error' : 'success'
    };

    if (parsedStream.forbiddenStateAccess) {
      throw createForbiddenStateAccessError(parsedStream.forbiddenAccessDetails, trace, exitCode);
    }

    cleanedUp = true;
    cleanupTempWorkspace(tempCwdDir);

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'cursor',
        model,
        tools: effectiveTools,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs,
        trace
      }
    });

    return parsedStream.text;
  } catch (err) {
    if (err && err.code === 'ENOENT' && executable === 'cursor-agent') {
      try {
        const fallbackResult = await exec('agent', args, {
          signal,
          timeoutMs,
          ...(effectiveKillGraceMs !== undefined ? { killGraceMs: effectiveKillGraceMs } : {}),
          cwd: effectiveCwd,
          env: effectiveEnv
        });
        exitCode = typeof fallbackResult?.exitCode === 'number' ? fallbackResult.exitCode : 0;
        const durationMs = Date.now() - startTime;
        const parsedFallback = parseCursorEventStream(fallbackResult?.stdout || '', {
          forbiddenWorkspaceRoots
        });

        const fallbackTrace = {
          traceCoverage: parsedFallback.traceCoverage,
          toolCalls: parsedFallback.toolCalls,
          skillsRead: parsedFallback.skillsRead,
          forbiddenStateAccess: parsedFallback.forbiddenStateAccess,
          forbiddenAccessDetails: parsedFallback.forbiddenAccessDetails,
          durationMs,
          outcome: parsedFallback.forbiddenStateAccess ? 'error' : 'success'
        };

        if (parsedFallback.forbiddenStateAccess) {
          throw createForbiddenStateAccessError(
            parsedFallback.forbiddenAccessDetails,
            fallbackTrace,
            exitCode
          );
        }

        cleanedUp = true;
        cleanupTempWorkspace(tempCwdDir);

        recordProviderCall({
          context,
          onCallRecord,
          record: {
            participantId: context?.seatId || context?.participantId || 'unknown',
            provider: 'cursor',
            model,
            tools: effectiveTools,
            argv: redactArgv(args, prompt),
            exitCode,
            durationMs,
            trace: fallbackTrace
          }
        });

        return parsedFallback.text;
      } catch (fallbackErr) {
        primaryError = fallbackErr;
        const durationMs = Date.now() - startTime;
        exitCode = typeof fallbackErr.exitCode === 'number'
          ? fallbackErr.exitCode
          : (typeof fallbackErr.code === 'number' ? fallbackErr.code : 1);

        sanitizeCliError(fallbackErr, 'agent', args, prompt);
        const parsedFallbackErr = fallbackErr?.trace
          ? null
          : parseCursorEventStream(fallbackErr?.stdout || '', { forbiddenWorkspaceRoots });
        const fallbackErrorTrace = fallbackErr?.trace
          ? {
              ...fallbackErr.trace,
              durationMs:
                typeof fallbackErr.trace.durationMs === 'number'
                  ? fallbackErr.trace.durationMs
                  : durationMs,
              outcome: 'error'
            }
          : {
              traceCoverage: parsedFallbackErr.eventsParsed
                ? parsedFallbackErr.traceCoverage
                : 'unavailable',
              toolCalls: parsedFallbackErr.toolCalls,
              skillsRead: parsedFallbackErr.skillsRead,
              forbiddenStateAccess: parsedFallbackErr.forbiddenStateAccess,
              forbiddenAccessDetails: parsedFallbackErr.forbiddenAccessDetails,
              durationMs,
              outcome: 'error'
            };
        if (!fallbackErr.trace && parsedFallbackErr?.forbiddenStateAccess) {
          fallbackErr.code = 'FORBIDDEN_STATE_ACCESS';
          fallbackErr.message = `[ForbiddenStateAccessError] Seat attempted to access forbidden .council/ state artifact: ${parsedFallbackErr.forbiddenAccessDetails.join(', ')}`;
        }
        fallbackErr.trace = fallbackErrorTrace;
        fallbackErr._providerCallRecorded = true;

        recordProviderCall({
          context,
          onCallRecord,
          record: {
            participantId: context?.seatId || context?.participantId || 'unknown',
            provider: 'cursor',
            model,
            tools: effectiveTools,
            argv: redactArgv(args, prompt),
            exitCode,
            durationMs: fallbackErrorTrace.durationMs,
            trace: fallbackErrorTrace
          }
        });

        throw fallbackErr;
      }
    }

    primaryError = err;
    const durationMs = Date.now() - startTime;
    exitCode = typeof err.exitCode === 'number'
      ? err.exitCode
      : (typeof err.code === 'number' ? err.code : 1);

    sanitizeCliError(err, executable, args, prompt);
    const parsedErrStream = err?.trace
      ? null
      : parseCursorEventStream(err?.stdout || '', { forbiddenWorkspaceRoots });
    const errorTrace = err?.trace
      ? {
          ...err.trace,
          durationMs: typeof err.trace.durationMs === 'number' ? err.trace.durationMs : durationMs,
          outcome: 'error'
        }
      : {
          traceCoverage: parsedErrStream.eventsParsed ? parsedErrStream.traceCoverage : 'unavailable',
          toolCalls: parsedErrStream.toolCalls,
          skillsRead: parsedErrStream.skillsRead,
          forbiddenStateAccess: parsedErrStream.forbiddenStateAccess,
          forbiddenAccessDetails: parsedErrStream.forbiddenAccessDetails,
          durationMs,
          outcome: 'error'
        };
    if (!err.trace && parsedErrStream?.forbiddenStateAccess) {
      err.code = 'FORBIDDEN_STATE_ACCESS';
      err.message = `[ForbiddenStateAccessError] Seat attempted to access forbidden .council/ state artifact: ${parsedErrStream.forbiddenAccessDetails.join(', ')}`;
    }
    err.trace = errorTrace;
    err._providerCallRecorded = true;

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'cursor',
        model,
        tools: effectiveTools,
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs: errorTrace.durationMs,
        trace: errorTrace
      }
    });

    throw err;
  } finally {
    if (!cleanedUp) {
      cleanupTempWorkspace(tempCwdDir, { suppressErrors: primaryError !== null });
    }
  }
}
