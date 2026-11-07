/**
 * @fileoverview Pure child_process.execFile CLI Runner for Live Harness Adapters.
 * Zero external dependencies. Zero MCP/UTCP wrappers. Zero GUI windows.
 * Node >= 22 ESM.
 */

import { execFile } from 'node:child_process';

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

const CODEX_EFFORT_MAP = Object.freeze({
  max: 'xhigh',
  xhigh: 'xhigh',
  high: 'high',
  medium: 'medium',
  low: 'low'
});

const RECOGNIZED_EFFORT_SUFFIXES = ['-max', '-xhigh', '-high', '-medium', '-low'];

/**
 * Parses model name and reasoning effort level.
 * Handles parenthesis format "gpt-6-astra (max)" and hyphenated suffixes "gemini-4-argon-high".
 * Maps 'max' to Codex 'xhigh'.
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
    const effort = parenMatch[2].trim().toLowerCase();
    const codexEffort = CODEX_EFFORT_MAP[effort] || CODEX_EFFORT_MAP[defaultEffort] || 'high';
    return { model, effort, codexEffort };
  }

  // 2. Suffix effort format: e.g. "gemini-4-argon-high", "grok-4.7-xhigh"
  for (const suffix of RECOGNIZED_EFFORT_SUFFIXES) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      const effort = suffix.slice(1);
      const codexEffort = CODEX_EFFORT_MAP[effort] || 'high';
      return { model: trimmed, effort, codexEffort };
    }
  }

  // 3. Fallback to default effort
  const effort = (defaultEffort || 'high').toLowerCase();
  const codexEffort = CODEX_EFFORT_MAP[effort] || 'high';
  return { model: trimmed, effort, codexEffort };
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
  exec = execCli
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

  const result = await exec(executable, args, { signal, timeoutMs, cwd, env });
  const raw = result.stdout || '';

  try {
    const json = JSON.parse(raw);
    if (json && typeof json.response === 'string') {
      return json.response;
    }
  } catch {
    // If not JSON envelope, fallback to raw output
  }

  return raw.trim();
}

/**
 * Provider Dispatcher: Codex (codex exec)
 * Args: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-m', model, '-c', 'model_reasoning_effort="' + codexEffort + '"', prompt]
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
  exec = execCli
} = {}) {
  const parsed = parseModelAndEffort(model, 'high');
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '-m', parsed.model,
    '-c', `model_reasoning_effort="${parsed.codexEffort}"`,
    prompt
  ];

  const result = await exec(executable, args, { signal, timeoutMs, cwd, env });
  return (result.stdout || '').trim();
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
  exec = execCli
} = {}) {
  const parsed = parseModelAndEffort(model, 'high');
  const args = [
    '--print',
    '--output-format', 'text',
    '--model', parsed.model,
    prompt
  ];

  try {
    const result = await exec(executable, args, { signal, timeoutMs, cwd, env });
    return (result.stdout || '').trim();
  } catch (err) {
    if (err && err.code === 'ENOENT' && executable === 'cursor-agent') {
      const fallbackResult = await exec('agent', args, { signal, timeoutMs, cwd, env });
      return (fallbackResult.stdout || '').trim();
    }
    throw err;
  }
}

