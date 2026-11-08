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
 * Executes a CLI process directly via execFile with timeout and abort support.
 * On non-zero exit or ENOENT, attaches exitCode, stdout, and stderr to Error.
 *
 * @param {string} executable
 * @param {string[]} [args=[]]
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.cwd]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string|Buffer} [options.input]
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
 */
export function recordProviderCall({ context, onCallRecord, record }) {
  const enrichedRecord = {
    ...record,
    tools: record.tools || context?.tools || 'read-only'
  };
  if (typeof onCallRecord === 'function') {
    onCallRecord(enrichedRecord);
  }
  if (typeof context?.onCallRecord === 'function') {
    context.onCallRecord(enrichedRecord);
  }
  if (context?.telemetry && typeof context.telemetry.emitProviderCall === 'function') {
    context.telemetry.emitProviderCall(enrichedRecord);
  }
}

/**
 * Provider Dispatcher: Antigravity (agy --print)
 * Args: ['--output-format', 'json', '--mode', 'plan', '--sandbox', '--disable-slash-commands', '--model', model, '--effort', effort, '--print=' + prompt]
 * Unwraps { response: "..." } JSON envelope if present.
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
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs
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

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'antigravity',
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs
      }
    });

    throw err;
  }
}

/**
 * Provider Dispatcher: Codex (codex exec)
 * Args: ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-m', model, '-c', 'model_reasoning_effort="' + codexEffort + '"', prompt]
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
  ignoreUserConfig = false
} = {}) {
  const parsed = parseModelAndEffort(model, 'high');
  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '-m', parsed.model,
    '-c', `model_reasoning_effort="${parsed.codexEffort}"`,
    prompt
  ];

  if (ignoreUserConfig) {
    args.splice(args.indexOf('--ephemeral') + 1, 0, '--ignore-user-config');
  }

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
        provider: 'codex',
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs
      }
    });

    return (result?.stdout || '').trim();
  } catch (err) {
    const durationMs = Date.now() - startTime;
    exitCode = typeof err.exitCode === 'number'
      ? err.exitCode
      : (typeof err.code === 'number' ? err.code : 1);

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'codex',
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs
      }
    });

    throw err;
  }
}

/**
 * Provider Dispatcher: Cursor (cursor-agent --print / agent fallback)
 * Args: ['--print', '--output-format', 'text', '--model', model, prompt]
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
    '--output-format', 'text',
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

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'cursor',
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs
      }
    });

    return (result?.stdout || '').trim();
  } catch (err) {
    if (err && err.code === 'ENOENT' && executable === 'cursor-agent') {
      try {
        const fallbackResult = await exec('agent', args, { signal, timeoutMs, cwd, env });
        exitCode = typeof fallbackResult?.exitCode === 'number' ? fallbackResult.exitCode : 0;
        const durationMs = Date.now() - startTime;

        recordProviderCall({
          context,
          onCallRecord,
          record: {
            participantId: context?.seatId || context?.participantId || 'unknown',
            provider: 'cursor',
            argv: redactArgv(args, prompt),
            exitCode,
            durationMs
          }
        });

        return (fallbackResult?.stdout || '').trim();
      } catch (fallbackErr) {
        const durationMs = Date.now() - startTime;
        exitCode = typeof fallbackErr.exitCode === 'number'
          ? fallbackErr.exitCode
          : (typeof fallbackErr.code === 'number' ? fallbackErr.code : 1);

        recordProviderCall({
          context,
          onCallRecord,
          record: {
            participantId: context?.seatId || context?.participantId || 'unknown',
            provider: 'cursor',
            argv: redactArgv(args, prompt),
            exitCode,
            durationMs
          }
        });

        throw fallbackErr;
      }
    }

    const durationMs = Date.now() - startTime;
    exitCode = typeof err.exitCode === 'number'
      ? err.exitCode
      : (typeof err.code === 'number' ? err.code : 1);

    recordProviderCall({
      context,
      onCallRecord,
      record: {
        participantId: context?.seatId || context?.participantId || 'unknown',
        provider: 'cursor',
        argv: redactArgv(args, prompt),
        exitCode,
        durationMs
      }
    });

    throw err;
  }
}
