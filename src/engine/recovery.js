/**
 * @fileoverview Centralized recovery policy, tool-free evidence readiness checks,
 * dependency extraction, and retry model/effort capability validation.
 * ESM Module (Node >= 22).
 */

import {
  ALLOWED_EFFORTS,
  extractCanonicalBaseModel,
  downshiftEffort,
  downshiftModel
} from '../harness/cli-runner.js';

export const VALID_SELF_CONTAINED_PHASES = Object.freeze([
  'DELIBERATION',
  'JUDGE_AUDIT_SYNTHESIS',
  'VOTING'
]);

const VALID_PHASE_SET = new Set(VALID_SELF_CONTAINED_PHASES);
const EFFORT_SET = new Set(ALLOWED_EFFORTS);
const URL_REGEX =
  /\b(?:https?|file|wss?|ftp|ssh|git|psql|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?|grpc|s3|gs):\/\/[^\s"'`<>()[\]]+/gi;
const GLOB_REGEX =
  /(?:^|[\s"'`(\[,;])((?:\.\.?\/)?(?:[^\s"'`)\],;*]*\*[^\s"'`)\],;]*)|(?:(?:[A-Za-z0-9_.-]+\/)+))(?=$|[\s"'`)\],;!?]|(?:\.(?:\s|$)))/g;

const RECOGNIZED_DOMAIN_TLDS = Object.freeze([
  'com', 'org', 'net', 'io', 'dev', 'edu', 'gov', 'mil', 'int',
  'ai', 'app', 'co', 'xyz', 'gg', 'land', 'cloud', 'tech', 'tools', 'page', 'site', 'online',
  'uk', 'de', 'fr', 'jp', 'ca', 'au', 'us', 'eu', 'nl', 'ch', 'se', 'fi', 'dk',
  'pt', 'br', 'kr', 'cn', 'tw', 'hk', 'sg', 'nz', 'ie', 'cz', 'mx', 'ar', 'cl', 'za'
]);
const MULTI_PART_CCSLD_SOURCE =
  '(?:co|com|org|net|ac|gov|edu|or|ne)\\.(?:uk|in|au|jp|nz|br|kr|cn|sg|hk|tw|za|il|it|at|be|no|es)';
const DOMAIN_SUFFIX_SOURCE = `(?:${MULTI_PART_CCSLD_SOURCE}|${RECOGNIZED_DOMAIN_TLDS.join('|')})`;
const BARE_DOMAIN_EXACT_REGEX = new RegExp(
  `^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+${DOMAIN_SUFFIX_SOURCE}$`,
  'i'
);
const BARE_DOMAIN_WITH_OPTIONAL_PATH_SOURCE =
  `(?<![A-Za-z0-9_./$-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+${DOMAIN_SUFFIX_SOURCE}(?::\\d{2,5})?(?:[/?#][^\\s"'` +
  '`<>()\\[\\]]*)?(?!\\.[A-Za-z0-9]|[A-Za-z0-9_-])';

const KNOWN_STANDALONE_EXTENSIONLESS_FILES = new Set([
  'Makefile', 'GNUmakefile', 'Dockerfile', 'Containerfile', 'Jenkinsfile',
  'Vagrantfile', 'Gemfile', 'Procfile', 'Rakefile', 'Justfile', 'Brewfile',
  'Podfile', 'Fastfile', 'Appfile', 'Tiltfile', 'Earthfile', 'Taskfile',
  'Caddyfile', 'Snakefile', 'SConstruct', 'SConscript', 'CMakeLists',
  'CODEOWNERS', 'WORKSPACE', 'BUILD', 'Kbuild', 'Kconfig', 'Doxyfile'
]);

const KNOWN_PATH_EXTENSIONLESS_FILES = new Set([
  ...KNOWN_STANDALONE_EXTENSIONLESS_FILES,
  'README', 'LICENSE', 'LICENCE', 'NOTICE', 'COPYING', 'PATENTS',
  'AUTHORS', 'CONTRIBUTORS', 'MAINTAINERS', 'OWNERS', 'CHANGELOG',
  'CHANGES', 'HISTORY', 'NEWS', 'SECURITY', 'SUPPORT', 'GOVERNANCE',
  'VERSION', 'MANIFEST', 'TODO', 'ROADMAP', 'configure'
]);

const KNOWN_DOTFILES = new Set([
  '.env', '.gitignore', '.gitattributes', '.gitmodules', '.npmrc', '.nvmrc',
  '.yarnrc', '.eslintrc', '.prettierrc', '.babelrc', '.editorconfig',
  '.dockerignore', '.prettierignore', '.eslintignore', '.clang-format',
  '.clang-tidy', '.flake8', '.pylintrc', '.rubocop', '.luacheckrc'
]);

const EXTENSIONLESS_PATH_ROOT_DIRS = new Set([
  'bin', 'sbin', 'libexec', 'src', 'lib', 'pkg', 'cmd', 'internal', 'include',
  'test', 'tests', 'spec', 'specs', 'doc', 'docs', 'script', 'scripts',
  'tool', 'tools', 'config', 'configs', 'package', 'packages', 'packaging',
  'debian', 'app', 'apps', 'asset', 'assets', 'resource', 'resources',
  'static', 'public', 'vendor', 'third_party', 'third-party', 'fixture',
  'fixtures', 'migration', 'migrations', 'hook', 'hooks', 'example',
  'examples', 'sample', 'samples', 'bench', 'benchmarks', 'schema', 'schemas',
  'proto', 'protos', 'data', 'certs', 'templates', 'infra', 'deploy',
  'docker', 'k8s', 'helm', 'charts', 'etc', 'usr', '.github', '.githooks',
  '.husky', '.circleci', '.vscode'
]);

const IGNORED_PROSE_SLASH_TOKENS = new Set([
  'and/or', 'either/or', 'read/write', 'yes/no', 'true/false', 'on/off',
  'in/out', 'up/down', 'min/max', 'pub/sub', 'req/res', 'request/response',
  'client/server', 'input/output', 'key/value', 'pros/cons', 'pass/fail',
  'start/stop', 'open/close', 'push/pull', 'send/receive', 'send/recv',
  'before/after', 'old/new', 'hot/cold', 'blue/green', 'sync/async',
  'active/passive', 'active/active', 'leader/follower', 'primary/replica',
  'primary/secondary', 'master/slave', 'cpu/mem', 'cpu/gpu', 'cpu/ram',
  'model/effort', 'seat/judge', 'accept/object', 'internal/external',
  'public/private', 'local/remote', 'static/dynamic', 'dev/prod', 'test/prod',
  'test/dev', 'test/staging', 'staging/prod', 'train/test', 'doc/spec',
  'docs/specs', 'spec/impl', 'cmd/ctrl', 'let/var', 'var/const', 'try/catch',
  'async/await', 'if/else', 'get/set', 'opt/in', 'opt/out', 'i/o', 'ci/cd',
  'tcp/ip', 'udp/ip', 'ssl/tls', 'n/a', 'w/o', 'c/o', 's/mime', 'os/2',
  'gnu/linux', 'iso/iec', 'low/medium/high', 'dev/staging/prod', 'dev/stage/prod',
  'read/write/execute', 'read/write/delete', 'create/edit/delete', 'red/green/refactor'
]);

const RATE_UNIT_NUMERATORS = new Set([
  'op', 'ops', 'req', 'reqs', 'request', 'requests', 'tx', 'tps', 'qps', 'rps',
  'msg', 'msgs', 'message', 'messages', 'kb', 'mb', 'gb', 'tb', 'byte', 'bytes',
  'bit', 'bits', 'pkt', 'pkts', 'packet', 'packets', 'token', 'tokens',
  'call', 'calls', 'row', 'rows', 'event', 'events', 'query', 'queries',
  'read', 'reads', 'write', 'writes', 'item', 'items', 'job', 'jobs'
]);

const RATE_UNIT_DENOMINATORS = new Set([
  's', 'sec', 'second', 'seconds', 'ms', 'us', 'ns', 'min', 'minute', 'minutes',
  'hr', 'hour', 'hours', 'day', 'days', 'op', 'ops', 'req', 'reqs', 'tx',
  'msg', 'kb', 'mb', 'gb', 'tb', 'byte', 'bytes', 'bit', 'bits', 'token',
  'tokens', 'call', 'calls', 'row', 'rows', 'event', 'events', 'query', 'queries'
]);

const KNOWN_FILE_EXTENSIONS = new Set([
  'c', 'h', 'hh', 'hpp', 'hxx', 'cpp', 'cc', 'cxx', 'm', 'mm',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'd',
  'py', 'pyi', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'cs', 'fs',
  'scala', 'lua', 'dart', 'zig', 'hs', 'ml', 'mli', 'ex', 'exs', 'erl',
  'clj', 'cljs', 'r', 'jl', 'pl', 'pm', 'rb', 'php', 'nim', 'v', 'sv', 'vhd',
  'proto', 'graphql', 'gql', 'prisma', 'sql',
  'json', 'jsonl', 'jsonc', 'json5', 'md', 'mdx', 'rst', 'adoc', 'tex', 'txt',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'xml', 'svg', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'lock', 'log', 'csv', 'tsv', 'diff', 'patch', 'tf', 'tfvars', 'hcl', 'nix', 'cmake', 'mk', 'wasm', 'map', 'pem', 'crt', 'key', 'bazel'
]);
const IGNORED_DOMAIN_TLDS = new Set([
  ...RECOGNIZED_DOMAIN_TLDS,
  'me', 'info', 'biz', 'in', 'it', 'at', 'be', 'no', 'es', 'il'
]);
const FILE_CANDIDATE_REGEX =
  /(^|[\s"'`(\[,;])((?:\.\.?\/|\/)?\.?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/\.?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*)(?::(\d+)(?:-(\d+))?)?(?=$|[\s"'`)\],;!?]|(?:\.(?:\s|$)))/g;
const NAMED_EXTERNAL_STANDARD_REGEX = new RegExp(
  `(?:\\b(?:RFC[\\s-]*\\d+|ISO(?:\\/IEC)?[\\s-]*\\d+(?:[-:]\\d+)*|CVE-\\d{4}-\\d+|CWE-\\d+|IEEE[\\s-]*\\d+(?:\\.\\d+)*|NIST[\\s-]+(?:SP[\\s-]+)?\\d+(?:[-.]\\d+)*|FIPS[\\s-]*\\d+(?:-\\d+)?|POSIX(?:\\.\\d+(?:-\\d+)?)?|BCP[\\s-]*\\d+|ECMA-\\d+|OWASP(?:\\s+(?:ASVS|Top\\s+\\d+|SAMM))?|W3C(?:\\s+[A-Z][A-Za-z0-9-]+)?|IETF|MDN|OpenAPI(?:\\s+\\d+(?:\\.\\d+)*)?)\\b|${BARE_DOMAIN_WITH_OPTIONAL_PATH_SOURCE})`,
  'gi'
);
const CHECK_COMMAND_OR_REPO_REGEX = /(?:`[^`]+`|\b(?:npm|npx|pnpm|yarn|node|pytest|python3?|cargo|go\s+test|make|bash|sh|zsh|git|grep|rg|curl|docker|kubectl)\b(?:\s+[-/\w.]|$)|\b(?:entire|whole|across(?:\s+the)?)\s+(?:repo|repository|codebase|workspace)\b|\b(?:repo(?:sitory)?|codebase)\s+(?:check|scan|audit|wide)\b|\brepo-wide\b|\brun\s+(?:tests?|command|script)\b)/i;
const CHECK_EXTERNAL_SOURCE_REGEX = new RegExp(
  `\\b(?:rfc\\s*\\d+|iso[\\s/-]*\\d+|ietf|w3c|owasp|cve-\\d{4}-\\d+|mdn|openapi|external(?:\\s+\\w+)?|upstream(?:\\s+\\w+)?|remote(?:\\s+\\w+)?|third[- ]party(?:\\s+\\w+)?|(?:rest|http|graphql|vendor)\\s+api)\\b|${BARE_DOMAIN_WITH_OPTIONAL_PATH_SOURCE}`,
  'i'
);

const IGNORED_SINGLE_SEGMENT_JS_NOUNS = new Set([
  'node.js',
  'next.js',
  'vue.js',
  'nuxt.js',
  'three.js',
  'react.js',
  'd3.js',
  'p5.js',
  'express.js',
  'nest.js',
  'chart.js',
  'alpine.js',
  'solid.js',
  'angular.js',
  'backbone.js',
  'ember.js',
  'meteor.js',
  'require.js'
]);

/**
 * Static adapter capability catalog for verified effort-capable models.
 * Note: Date-stamped Antigravity selectors (e.g. `claude-opus-5-5-20260501`) are
 * intentionally omitted so they fail `UNSUPPORTED_MODEL_EFFORT` unless confirmed
 * by `live_cli_catalog`.
 */
const STATIC_CAPABILITY_CATALOG = Object.freeze({
  codex: Object.freeze({
    'gpt-6-astra': Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
    'gpt-6.1-sol': Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])
  }),
  antigravity: Object.freeze({
    'gemini-4-argon': Object.freeze(['low', 'medium', 'high']),
    'gemini-4-carbon': Object.freeze(['low', 'medium', 'high']),
    'claude-sonnet-5-5': Object.freeze(['low', 'medium', 'high']),
    'claude-opus-5-5': Object.freeze(['low', 'medium', 'high'])
  }),
  cursor: Object.freeze({
    'grok-4.7': Object.freeze(['low', 'medium', 'high', 'xhigh']),
    'composer-2.5': null
  })
});

function isExplicitlyDelimitedMatch(sourceText, offset, matchLength) {
  if (typeof sourceText !== 'string' || typeof offset !== 'number' || offset <= 0) {
    return false;
  }
  const open = sourceText[offset - 1];
  const close = sourceText[offset + matchLength];
  return (
    (open === '`' && close === '`') ||
    (open === '"' && close === '"') ||
    (open === "'" && close === "'") ||
    (open === '<' && close === '>') ||
    (open === '(' && close === ')') ||
    (open === '[' && close === ']')
  );
}

function stripTrailingProsePunctuation(rawToken, sourceText, offset) {
  if (isExplicitlyDelimitedMatch(sourceText, offset, rawToken.length)) {
    return rawToken;
  }
  if (
    offset === 0 &&
    typeof sourceText === 'string' &&
    rawToken.length === sourceText.length &&
    /[?#=]/.test(rawToken) &&
    !rawToken.endsWith('.')
  ) {
    return rawToken;
  }
  return rawToken.replace(/[.,;:!?)]+$/, '');
}

function collectStrings(value, out) {
  if (typeof value === 'string') {
    if (value.trim()) {
      out.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
  }
}

function normalizeWorkspacePath(rawPath) {
  return String(rawPath || '').trim().replace(/^\.\//, '');
}

function mergeFileDependency(list, dep) {
  const existingForSource = list.filter((item) => item.source === dep.source);
  if (existingForSource.some((item) => item.unbounded)) {
    return;
  }
  if (dep.unbounded) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].source === dep.source) {
        list.splice(i, 1);
      }
    }
    list.push({ source: dep.source, unbounded: true });
    return;
  }
  const duplicate = existingForSource.some(
    (item) => item.startLine === dep.startLine && item.endLine === dep.endLine
  );
  if (!duplicate) {
    list.push({
      source: dep.source,
      startLine: dep.startLine,
      endLine: dep.endLine
    });
  }
}

function isSemanticVersionToken(token) {
  const trimmed = String(token || '').trim();
  const match = /^v?\d+(?:\.\d+)+/i.exec(trimmed);
  if (!match) {
    return false;
  }
  const rest = trimmed.slice(match[0].length);
  if (!rest) {
    return true;
  }
  if (rest.startsWith('-')) {
    return /^-[A-Za-z0-9]+(?:\.[A-Za-z0-9-]+)*$/.test(rest);
  }
  return /^\.(?:alpha|beta|rc|pre|dev|next|canary|nightly|snapshot|post|final|release)\d*$/i.test(rest);
}

function isRecognizedBareDomain(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed || isSemanticVersionToken(trimmed)) {
    return false;
  }
  return BARE_DOMAIN_EXACT_REGEX.test(trimmed);
}

function hasKnownFileExtensionOrDotfile(segment) {
  if (!segment) {
    return false;
  }
  const lower = segment.toLowerCase();
  if (KNOWN_DOTFILES.has(lower) || lower.startsWith('.env.')) {
    return true;
  }
  const dotIdx = segment.lastIndexOf('.');
  if (dotIdx <= 0) {
    return false;
  }
  const ext = segment.slice(dotIdx + 1).toLowerCase();
  return Boolean(ext && !IGNORED_DOMAIN_TLDS.has(ext) && KNOWN_FILE_EXTENSIONS.has(ext));
}

function hasPathFileExtensionOrDotfile(segment) {
  if (!segment || isSemanticVersionToken(segment)) {
    return false;
  }
  if (segment.startsWith('.') && segment.length > 1) {
    return true;
  }
  const dotIdx = segment.lastIndexOf('.');
  if (dotIdx <= 0) {
    return false;
  }
  const ext = segment.slice(dotIdx + 1);
  return /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(ext);
}

function isRateSlashExpression(left, right) {
  if (!RATE_UNIT_DENOMINATORS.has(right.toLowerCase())) {
    return false;
  }
  const lowerLeft = left.toLowerCase();
  return RATE_UNIT_NUMERATORS.has(lowerLeft) || /^\d+(?:\.\d+)?[kmgbt]?b?$/i.test(left);
}

function isProviderModelSlashExpression(left, right) {
  return (
    /^(?:codex|antigravity|cursor|openai|gemini|claude|mock)$/i.test(left) &&
    /^(?:gpt|gemini|claude|grok|composer|mock)-/i.test(right)
  );
}

function isNonPathSlashExpression(source, segments) {
  const lower = source.toLowerCase();
  if (IGNORED_PROSE_SLASH_TOKENS.has(lower)) {
    return true;
  }
  if (segments.every((seg) => /^[A-Z0-9]{1,6}$/.test(seg))) {
    return true;
  }
  if (segments.length === 2) {
    const [left, right] = segments;
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      return true;
    }
    if (/^(?:http|https|grpc|tls|ssl|os|http2)$/i.test(left) && /^v?\d+(?:\.\d+)*$/i.test(right)) {
      return true;
    }
    if (isRateSlashExpression(left, right) || isProviderModelSlashExpression(left, right)) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a matched file candidate as a workspace file ('file'), a known
 * runtime/framework noun to mask without adding a dependency ('mask_only'), or
 * non-file text to leave intact for external standard/domain extraction ('leave').
 */
function classifyFileCandidate(rawToken, startRaw, endRaw) {
  const hasExplicitDotSlash = rawToken.startsWith('./');
  const source = normalizeWorkspacePath(rawToken);
  if (!source || source.includes('..')) {
    return 'leave';
  }

  if (!source.includes('/')) {
    if (IGNORED_SINGLE_SEGMENT_JS_NOUNS.has(source.toLowerCase())) {
      return hasExplicitDotSlash || startRaw !== undefined ? 'file' : 'mask_only';
    }
    if (!hasExplicitDotSlash) {
      if (isSemanticVersionToken(source)) {
        return 'leave';
      }
      if (isRecognizedBareDomain(source) && endRaw === undefined) {
        return 'leave';
      }
      if (KNOWN_STANDALONE_EXTENSIONLESS_FILES.has(source) || hasKnownFileExtensionOrDotfile(source)) {
        return 'file';
      }
      if (startRaw !== undefined) {
        if (endRaw !== undefined) {
          return 'file';
        }
        if (KNOWN_PATH_EXTENSIONLESS_FILES.has(source)) {
          return 'file';
        }
        const dotIdx = source.lastIndexOf('.');
        const ext = dotIdx > 0 ? source.slice(dotIdx + 1).toLowerCase() : '';
        if (ext && !IGNORED_DOMAIN_TLDS.has(ext) && /^[a-z][a-z0-9]{0,11}$/.test(ext)) {
          return 'file';
        }
      }
      return 'leave';
    }
    return 'file';
  }

  const segments = source.split('/').filter(Boolean);
  if (segments.length === 0) {
    return 'leave';
  }
  if (!rawToken.startsWith('/') && !hasExplicitDotSlash && isRecognizedBareDomain(segments[0])) {
    return 'leave';
  }
  if (hasExplicitDotSlash || startRaw !== undefined) {
    return 'file';
  }
  if (IGNORED_PROSE_SLASH_TOKENS.has(source.toLowerCase())) {
    return 'leave';
  }
  if (segments.length === 2 && isProviderModelSlashExpression(segments[0], segments[1])) {
    return 'leave';
  }

  const basename = segments[segments.length - 1];
  if (
    hasPathFileExtensionOrDotfile(basename) ||
    KNOWN_PATH_EXTENSIONLESS_FILES.has(basename) ||
    EXTENSIONLESS_PATH_ROOT_DIRS.has(segments[0].toLowerCase())
  ) {
    return 'file';
  }
  if (isNonPathSlashExpression(source, segments)) {
    return 'leave';
  }
  if (
    segments.some((seg) => seg.startsWith('.') || seg.includes('_')) ||
    (segments.length === 2 &&
      /^[a-z][a-z0-9-]*$/.test(segments[0]) &&
      basename.length >= 3 &&
      /^[A-Z][A-Z0-9_-]*$/.test(basename)) ||
    (segments.length >= 3 && (rawToken.startsWith('/') || segments.some((seg) => /[-0-9]/.test(seg))))
  ) {
    return 'file';
  }
  return 'leave';
}

/**
 * Extract workspace file references, broad directory/glob exploration patterns,
 * and external URLs/standards/domains from prompt/topic/candidate/proof text inputs.
 *
 * @param {string|string[]} inputs
 * @returns {{
 *   workspaceFileDeps: Array<{ source: string, startLine?: number, endLine?: number, unbounded?: boolean }>,
 *   workspaceBroadDeps: string[],
 *   externalDeps: string[]
 * }}
 */
export function extractVerificationDependencies(inputs) {
  const strings = [];
  collectStrings(inputs, strings);

  const workspaceFileDeps = [];
  const workspaceBroadDeps = [];
  const seenBroad = new Set();
  const externalDeps = [];
  const seenExternal = new Set();

  for (const text of strings) {
    // 1. Extract external URI scheme URLs first and mask them so URL paths
    //    or embedded standard tokens are not misclassified or duplicated.
    let masked = text.replace(URL_REGEX, (rawUrl, ...args) => {
      const offset = args[args.length - 2];
      const sourceStr = args[args.length - 1];
      const cleaned = stripTrailingProsePunctuation(rawUrl, sourceStr, offset);
      const urlKey = `url:${cleaned}`;
      if (cleaned && !seenExternal.has(urlKey)) {
        seenExternal.add(urlKey);
        externalDeps.push(cleaned);
      }
      return ' '.repeat(rawUrl.length);
    });

    // 2. Mask ellipses (`...`, `..`) before glob/file/standard extraction.
    masked = masked.replace(/\.{2,}/g, (m) => ' '.repeat(m.length));

    // 3. Extract broad workspace globs and directory references (`src/**`, `**/*.js`, `src/engine/`),
    //    leaving unprefixed bare domains with trailing slashes or wildcards intact for external detection.
    masked = masked.replace(GLOB_REGEX, (full, candidate) => {
      const cleanedCandidate = candidate.includes('*') ? candidate.replace(/\.(?=$)/, '') : candidate;
      const hasRelativePrefix = cleanedCandidate.startsWith('./') || cleanedCandidate.startsWith('../');
      const trimmed = cleanedCandidate.replace(/^\.\//, '');
      const firstSeg = trimmed.split('/')[0];
      if (!hasRelativePrefix && !cleanedCandidate.startsWith('/') && isRecognizedBareDomain(firstSeg)) {
        return full;
      }
      const looksBroad = trimmed.includes('*')
        ? (trimmed.includes('/') || trimmed.includes('.'))
        : (trimmed.endsWith('/') && trimmed.length > 1 && /[A-Za-z0-9_-]/.test(trimmed));
      if (!looksBroad) {
        return full;
      }
      if (!seenBroad.has(trimmed)) {
        seenBroad.add(trimmed);
        workspaceBroadDeps.push(trimmed);
      }
      const idx = full.indexOf(cleanedCandidate);
      return `${full.slice(0, idx)}${' '.repeat(cleanedCandidate.length)}${full.slice(idx + cleanedCandidate.length)}`;
    });

    // 4. Extract concrete workspace files BEFORE named external standards so file paths like
    //    `src/openapi.js` or `docs/rfc9110.md` are recorded as files and masked from standard matching.
    masked = masked.replace(FILE_CANDIDATE_REGEX, (full, lead, rawToken, startRaw, endRaw) => {
      const decision = classifyFileCandidate(rawToken, startRaw, endRaw);
      if (decision === 'leave') {
        return full;
      }
      if (decision === 'file') {
        const source = normalizeWorkspacePath(rawToken);
        if (startRaw !== undefined) {
          const startLine = Number.parseInt(startRaw, 10);
          const endLine = endRaw !== undefined ? Number.parseInt(endRaw, 10) : startLine;
          mergeFileDependency(workspaceFileDeps, {
            source,
            startLine: Math.min(startLine, endLine),
            endLine: Math.max(startLine, endLine)
          });
        } else {
          mergeFileDependency(workspaceFileDeps, { source, unbounded: true });
        }
      }
      return `${lead}${' '.repeat(full.length - lead.length)}`;
    });

    // 5. Extract named external standards/identifiers and bare external domains/endpoints
    //    across remaining text before removing version tokens so `OpenAPI 3.1.0` stays intact.
    masked = masked.replace(NAMED_EXTERNAL_STANDARD_REGEX, (rawStd, ...args) => {
      const offset = args[args.length - 2];
      const sourceStr = args[args.length - 1];
      const normalized = stripTrailingProsePunctuation(rawStd, sourceStr, offset).replace(/\s+/g, ' ').trim();
      if (!normalized || isSemanticVersionToken(normalized)) {
        return rawStd;
      }
      const stdKey = canonicalizeExternalDepKey(normalized);
      if (!seenExternal.has(stdKey)) {
        seenExternal.add(stdKey);
        externalDeps.push(normalized);
      }
      return ' '.repeat(rawStd.length);
    });
  }

  return {
    workspaceFileDeps,
    workspaceBroadDeps,
    externalDeps
  };
}

function formatEvidenceFailure(detail, missingDependencies = []) {
  return {
    ready: false,
    reasonCode: 'evidence_access_failure',
    vetoReason: detail,
    reason: `Tool-free recovery refused (insufficient self-contained evidence: ${detail})`,
    missingDependencies
  };
}

function checkPhasePrerequisites({
  phase,
  round,
  removesTools,
  topic,
  proofs,
  candidate,
  previousCandidate,
  openObjections,
  admittedProofs
}) {
  if (phase === 'DELIBERATION') {
    if (round > 1) {
      if (!previousCandidate || !Array.isArray(openObjections) || openObjections.length === 0) {
        return formatEvidenceFailure(
          'Round > 1 deliberation requires previousCandidate and openObjections',
          ['previousCandidate/openObjections']
        );
      }
    }
    return null;
  }
  if (phase === 'JUDGE_AUDIT_SYNTHESIS') {
    if (!Array.isArray(proofs) || proofs.length === 0) {
      return formatEvidenceFailure(
        'JUDGE_AUDIT_SYNTHESIS requires submitted proofs',
        ['proofs']
      );
    }
    return null;
  }
  if (phase === 'VOTING') {
    if (!candidate || typeof candidate !== 'object') {
      return formatEvidenceFailure(
        'VOTING requires an active candidate',
        ['candidate']
      );
    }
    if (removesTools && (!Array.isArray(admittedProofs) || admittedProofs.length === 0)) {
      return formatEvidenceFailure(
        'VOTING tool-removing recovery requires admittedProofs',
        ['admittedProofs']
      );
    }
    return null;
  }
  return formatEvidenceFailure(`unsupported recovery phase "${String(phase)}"`, [String(phase)]);
}

function appendProofTexts(list, texts) {
  if (!Array.isArray(list)) return;
  for (const proof of list) {
    if (proof?.scope) texts.push(String(proof.scope));
    if (proof?.statement) texts.push(String(proof.statement));
    if (proof?.judgeAdmittedStatement) texts.push(String(proof.judgeAdmittedStatement));
    if (proof?.source) texts.push(String(proof.source));
  }
}

function resolveBackingProofs({
  phase,
  round = 1,
  proofs = [],
  priorProofs = [],
  admittedProofs = [],
  openObjections = [],
  previousCandidate = null
}) {
  if (Number(round) <= 1 || (phase !== 'DELIBERATION' && phase !== 'JUDGE_AUDIT_SYNTHESIS')) {
    return [];
  }
  const referencedIds = new Set();
  if (Array.isArray(openObjections)) {
    for (const obj of openObjections) {
      if (typeof obj?.proofId === 'string' && obj.proofId.trim()) {
        referencedIds.add(obj.proofId.trim());
      }
    }
  }
  if (phase === 'DELIBERATION' && Array.isArray(previousCandidate?.clauses)) {
    for (const clause of previousCandidate.clauses) {
      if (typeof clause?.proofId === 'string' && clause.proofId.trim()) {
        referencedIds.add(clause.proofId.trim());
      }
      if (Array.isArray(clause?.citedProofIds)) {
        for (const pid of clause.citedProofIds) {
          if (typeof pid === 'string' && pid.trim()) referencedIds.add(pid.trim());
        }
      }
      if (Array.isArray(clause?.proofIds)) {
        for (const pid of clause.proofIds) {
          if (typeof pid === 'string' && pid.trim()) referencedIds.add(pid.trim());
        }
      }
      if (Array.isArray(clause?.supportingProofs)) {
        for (const pid of clause.supportingProofs) {
          if (typeof pid === 'string' && pid.trim()) referencedIds.add(pid.trim());
        }
      }
    }
  }
  if (referencedIds.size === 0) {
    return [];
  }

  const seenIds = new Set(
    (Array.isArray(proofs) ? proofs : [])
      .map((p) => (typeof p?.id === 'string' ? p.id.trim() : ''))
      .filter(Boolean)
  );
  const backingProofs = [];
  const pool = [
    ...(Array.isArray(priorProofs) ? priorProofs : []),
    ...(Array.isArray(admittedProofs) ? admittedProofs : [])
  ];
  for (const proof of pool) {
    if (!proof || typeof proof !== 'object') continue;
    const pid = typeof proof.id === 'string' ? proof.id.trim() : '';
    if (!pid || !referencedIds.has(pid) || seenIds.has(pid)) {
      continue;
    }
    seenIds.add(pid);
    backingProofs.push(proof);
  }
  return backingProofs;
}

function collectPhasePromptTexts({
  phase,
  round = 1,
  topic,
  clarifications,
  proofs,
  priorProofs = [],
  backingProofs = null,
  candidate,
  previousCandidate,
  openObjections,
  admittedProofs
}) {
  const texts = [];
  if (typeof topic === 'string' && topic.trim()) {
    texts.push(topic);
  }
  if (phase === 'DELIBERATION' && Array.isArray(clarifications)) {
    for (const c of clarifications) {
      if (typeof c === 'string' && c.trim()) {
        texts.push(c);
      } else if (c && typeof c === 'object') {
        if (c.question) texts.push(String(c.question));
        if (c.answer) texts.push(String(c.answer));
        if (c.source) texts.push(String(c.source));
        if (c.text) texts.push(String(c.text));
      }
    }
  }
  if (phase === 'DELIBERATION' && previousCandidate && typeof previousCandidate === 'object') {
    if (typeof previousCandidate.summary === 'string') {
      texts.push(previousCandidate.summary);
    }
    if (Array.isArray(previousCandidate.clauses)) {
      for (const clause of previousCandidate.clauses) {
        if (clause?.context) texts.push(String(clause.context));
        if (clause?.conclusion) texts.push(String(clause.conclusion));
      }
    }
  }
  if (Array.isArray(openObjections)) {
    for (const obj of openObjections) {
      if (obj?.reason) texts.push(String(obj.reason));
    }
  }
  if ((phase === 'JUDGE_AUDIT_SYNTHESIS' || phase === 'VOTING') && candidate && typeof candidate === 'object') {
    if (typeof candidate.summary === 'string') {
      texts.push(candidate.summary);
    }
    if (Array.isArray(candidate.clauses)) {
      for (const clause of candidate.clauses) {
        if (clause?.context) texts.push(String(clause.context));
        if (clause?.conclusion) texts.push(String(clause.conclusion));
      }
    }
  }
  appendProofTexts(proofs, texts);
  const resolvedBacking = Array.isArray(backingProofs)
    ? backingProofs
    : resolveBackingProofs({
        phase,
        round,
        proofs,
        priorProofs,
        admittedProofs,
        openObjections,
        previousCandidate
      });
  if (resolvedBacking.length > 0) {
    appendProofTexts(resolvedBacking, texts);
  }
  if (phase === 'VOTING') {
    appendProofTexts(admittedProofs, texts);
  }
  return texts;
}

function augmentProofDependencies(proofList, deps) {
  if (!Array.isArray(proofList)) return;
  for (const proof of proofList) {
    if (!proof || typeof proof !== 'object') continue;
    const rawSource = typeof proof.source === 'string' ? proof.source.trim() : '';
    const rawStatement = typeof proof.statement === 'string' ? proof.statement.trim() : '';
    const rawAdmittedStatement =
      typeof proof.judgeAdmittedStatement === 'string' ? proof.judgeAdmittedStatement.trim() : '';
    const sourceDeps = rawSource ? extractVerificationDependencies([rawSource]) : null;
    const sourceHasConcreteFile = Boolean(
      sourceDeps &&
      sourceDeps.workspaceFileDeps.length > 0 &&
      sourceDeps.workspaceBroadDeps.length === 0 &&
      sourceDeps.externalDeps.length === 0
    );

    if (proof.kind === 'benchmark') {
      if (
        rawSource &&
        !sourceHasConcreteFile &&
        !deps.externalDeps.includes(rawSource) &&
        !deps.workspaceBroadDeps.includes(rawSource)
      ) {
        deps.externalDeps.push(rawSource);
      }
      continue;
    }

    if (proof.kind === 'check') {
      const sourceIsCommandOrRepo = !sourceHasConcreteFile && rawSource && CHECK_COMMAND_OR_REPO_REGEX.test(rawSource);
      const statementMatch = [rawStatement, rawAdmittedStatement].find(
        (s) => s && CHECK_COMMAND_OR_REPO_REGEX.test(s)
      );
      const statementIsCommandOrRepo = Boolean(statementMatch);
      if (sourceIsCommandOrRepo || statementIsCommandOrRepo) {
        const label = sourceIsCommandOrRepo ? rawSource : statementMatch.slice(0, 80);
        if (label && !deps.workspaceBroadDeps.includes(label)) {
          deps.workspaceBroadDeps.push(label);
        }
      }
      if (
        rawSource &&
        !sourceHasConcreteFile &&
        !sourceIsCommandOrRepo &&
        (!sourceDeps || sourceDeps.externalDeps.length === 0) &&
        !deps.externalDeps.includes(rawSource) &&
        !deps.workspaceBroadDeps.includes(rawSource) &&
        CHECK_EXTERNAL_SOURCE_REGEX.test(rawSource)
      ) {
        deps.externalDeps.push(rawSource);
      }
    }
  }
}

function isValidEvidenceItem(item) {
  return Boolean(item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim().length > 0);
}

function doesCoveredArtifactSatisfyFileDep(dep, artifact, evidenceById) {
  if (!artifact || typeof artifact !== 'object') {
    return false;
  }
  const ev = evidenceById.get(artifact.evidenceId);
  if (!isValidEvidenceItem(ev)) {
    return false;
  }
  const artifactSource = normalizeWorkspacePath(artifact.source);
  if (!artifactSource || artifactSource !== dep.source) {
    return false;
  }
  if (ev.source !== undefined && normalizeWorkspacePath(ev.source) !== artifactSource) {
    return false;
  }
  if (artifact.coverage === 'complete_artifact') {
    return true;
  }
  if (dep.unbounded) {
    return false;
  }
  const cov = artifact.coverage;
  if (!cov || typeof cov !== 'object') {
    return false;
  }
  if (
    !Number.isInteger(cov.startLine) ||
    !Number.isInteger(cov.endLine) ||
    cov.startLine < 1 ||
    cov.endLine < cov.startLine
  ) {
    return false;
  }
  const depEnd = Number.isInteger(dep.endLine) ? dep.endLine : dep.startLine;
  return cov.startLine <= dep.startLine && cov.endLine >= depEnd;
}

function isUrlExternalSource(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value || '').trim());
}

function parseBareDomainEndpoint(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || isUrlExternalSource(trimmed)) {
    return null;
  }
  const delimMatch = /[/?#]/.exec(trimmed);
  const authority = delimMatch ? trimmed.slice(0, delimMatch.index) : trimmed;
  const suffix = delimMatch ? trimmed.slice(delimMatch.index) : '';
  const host = authority.replace(/:\d{2,5}$/, '');
  if (!isRecognizedBareDomain(host)) {
    return null;
  }
  return {
    authorityLower: authority.toLowerCase(),
    suffix
  };
}

function canonicalizeExternalDepKey(value) {
  const trimmed = String(value || '').trim();
  if (isUrlExternalSource(trimmed)) {
    return `url:${trimmed}`;
  }
  const bare = parseBareDomainEndpoint(trimmed);
  if (bare) {
    return bare.suffix ? `endpoint:${bare.authorityLower}${bare.suffix}` : `domain:${bare.authorityLower}`;
  }
  return `std:${trimmed.replace(/[\s-]+/g, '').toLowerCase()}`;
}

function externalSourcesMatch(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (!sa || !sb) {
    return false;
  }
  if (isUrlExternalSource(sa) || isUrlExternalSource(sb)) {
    return sa === sb;
  }
  const bareA = parseBareDomainEndpoint(sa);
  const bareB = parseBareDomainEndpoint(sb);
  if ((bareA && bareA.suffix) || (bareB && bareB.suffix)) {
    if (!bareA || !bareB) {
      return false;
    }
    return bareA.authorityLower === bareB.authorityLower && bareA.suffix === bareB.suffix;
  }
  return sa.toLowerCase() === sb.toLowerCase();
}

function doesCoveredArtifactSatisfyExternalDep(extSource, artifact, evidenceById) {
  if (!artifact || typeof artifact !== 'object') {
    return false;
  }
  const ev = evidenceById.get(artifact.evidenceId);
  if (!isValidEvidenceItem(ev)) {
    return false;
  }
  if (!externalSourcesMatch(artifact.source, extSource)) {
    return false;
  }
  if (ev.source !== undefined && !externalSourcesMatch(ev.source, extSource)) {
    return false;
  }
  return artifact.coverage === 'complete_artifact';
}

/**
 * Evaluate whether a participant may safely retry without tools (`tools: 'none'`).
 * Enforces Spec §1 evidence-coverage, roundScope, conceptualNoExternalVerification,
 * and open-ended `effectiveCwd` exploration guards.
 *
 * @param {object} params
 * @returns {{ ready: boolean, reasonCode: string|null, reason: string|null, missingDependencies: string[] }}
 */
export function evaluateToolFreeEvidenceReadiness(params = {}) {
  const {
    phase = 'DELIBERATION',
    round = 1,
    errorClass = 'TimeoutError',
    topic = '',
    clarifications = [],
    evidence = [],
    proofs = [],
    priorProofs = [],
    candidate = null,
    previousCandidate = null,
    openObjections = [],
    admittedProofs = [],
    selfContainedInput = null,
    originalInvocationMeta = {}
  } = params;

  const effectiveTools = originalInvocationMeta?.effectiveTools ?? 'read-only';
  const effectiveCwd = originalInvocationMeta?.effectiveCwd;
  const removesTools = effectiveTools !== 'none';

  // Spec §1: never retry HeadlessToolDeniedError when attempt already ran with tools: 'none'.
  if (!removesTools) {
    if (errorClass === 'HeadlessToolDeniedError') {
      return formatEvidenceFailure(
        'headless tool permission was denied even with tools: "none"',
        ['headless tool permission']
      );
    }
    const prereqError = checkPhasePrerequisites({
      phase,
      round,
      removesTools: false,
      topic,
      proofs,
      candidate,
      previousCandidate,
      openObjections,
      admittedProofs
    });
    if (prereqError) {
      return prereqError;
    }
    return { ready: true, reasonCode: null, reason: null, missingDependencies: [] };
  }

  // Tool removal requested (`read-only` / `full` -> `none`).
  const prereqError = checkPhasePrerequisites({
    phase,
    round,
    removesTools: true,
    topic,
    proofs,
    candidate,
    previousCandidate,
    openObjections,
    admittedProofs
  });
  if (prereqError) {
    return prereqError;
  }

  if (!selfContainedInput || typeof selfContainedInput !== 'object' || Array.isArray(selfContainedInput)) {
    return formatEvidenceFailure(
      'selfContainedInput contract is required when removing tools',
      ['selfContainedInput']
    );
  }

  if (!Array.isArray(selfContainedInput.phases) || !selfContainedInput.phases.includes(phase)) {
    return formatEvidenceFailure(
      `selfContainedInput.phases does not authorize phase "${phase}"`,
      [`selfContainedInput.phases:${phase}`]
    );
  }

  if (round > 1 && selfContainedInput.roundScope !== 'all_rounds') {
    return formatEvidenceFailure(
      'round > 1 requires selfContainedInput.roundScope === "all_rounds"',
      ['selfContainedInput.roundScope:all_rounds']
    );
  }

  const backingProofs = resolveBackingProofs({
    phase,
    round,
    proofs,
    priorProofs,
    admittedProofs,
    openObjections,
    previousCandidate
  });
  const texts = collectPhasePromptTexts({
    phase,
    round,
    topic,
    clarifications,
    proofs,
    priorProofs,
    backingProofs,
    candidate,
    previousCandidate,
    openObjections,
    admittedProofs
  });
  const deps = extractVerificationDependencies(texts);

  // Spec §1 & §7 item 2: external `kind: 'benchmark'` sources and `kind: 'check'`
  // command/repo/external claims in proofs, prior backing proofs & admittedProofs veto unattested recovery.
  augmentProofDependencies(proofs, deps);
  if (backingProofs.length > 0) {
    augmentProofDependencies(backingProofs, deps);
  }
  if (phase === 'VOTING') {
    augmentProofDependencies(admittedProofs, deps);
  }

  // Spec §1 line 119: When `effectiveCwd` is attached in Round 1 DELIBERATION and
  // no concrete workspace file dependencies are cited, refuse open-ended exploration
  // even if unrelated coveredArtifacts or conceptual flags were provided.
  if (
    effectiveCwd !== undefined &&
    effectiveCwd !== null &&
    phase === 'DELIBERATION' &&
    round === 1 &&
    deps.workspaceFileDeps.length === 0
  ) {
    return formatEvidenceFailure(
      'open-ended DELIBERATION round 1 with attached cwd requires concrete workspace file citations',
      ['concrete workspace file citations']
    );
  }

  if (deps.workspaceBroadDeps.length > 0) {
    return formatEvidenceFailure(
      `broad workspace exploration dependencies cannot be verified tool-free (${deps.workspaceBroadDeps.join(', ')})`,
      deps.workspaceBroadDeps
    );
  }

  const hasAnyDeps = deps.workspaceFileDeps.length > 0 || deps.externalDeps.length > 0;
  const isUnattachedCwd = effectiveCwd === undefined || effectiveCwd === null;
  const conceptualAllowed =
    selfContainedInput.conceptualNoExternalVerification === true &&
    isUnattachedCwd &&
    errorClass === 'TimeoutError' &&
    !hasAnyDeps;

  if (conceptualAllowed) {
    return { ready: true, reasonCode: null, reason: null, missingDependencies: [] };
  }

  const evidenceById = new Map();
  if (Array.isArray(evidence)) {
    for (const item of evidence) {
      if (item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim()) {
        evidenceById.set(item.id.trim(), item);
      }
    }
  }

  const coveredArtifacts = Array.isArray(selfContainedInput.coveredArtifacts)
    ? selfContainedInput.coveredArtifacts
    : [];

  if (!hasAnyDeps) {
    const hasValidAttestation = coveredArtifacts.some((ca) => {
      const ev = ca && typeof ca === 'object' ? evidenceById.get(ca.evidenceId) : null;
      return Boolean(ca?.source && ca?.coverage && isValidEvidenceItem(ev));
    });
    if (!hasValidAttestation) {
      return formatEvidenceFailure(
        'no qualifying [E#]-backed coveredArtifacts or conceptual contract satisfies tool-free execution',
        ['coveredArtifacts']
      );
    }
    return { ready: true, reasonCode: null, reason: null, missingDependencies: [] };
  }

  const missingDependencies = [];
  for (const fileDep of deps.workspaceFileDeps) {
    const matched = coveredArtifacts.some((ca) =>
      doesCoveredArtifactSatisfyFileDep(fileDep, ca, evidenceById)
    );
    if (!matched) {
      const label = fileDep.unbounded
        ? fileDep.source
        : `${fileDep.source}:${fileDep.startLine}-${fileDep.endLine}`;
      missingDependencies.push(label);
    }
  }

  for (const extDep of deps.externalDeps) {
    const matched = coveredArtifacts.some((ca) =>
      doesCoveredArtifactSatisfyExternalDep(extDep, ca, evidenceById)
    );
    if (!matched) {
      missingDependencies.push(extDep);
    }
  }

  if (missingDependencies.length > 0) {
    return formatEvidenceFailure(
      `uncovered verification dependencies: ${missingDependencies.join(', ')}`,
      missingDependencies
    );
  }

  return { ready: true, reasonCode: null, reason: null, missingDependencies: [] };
}

/**
 * Inspect a raw model string directly for an inline effort annotation
 * (either `model (effort)` or `model-(low|medium|high|xhigh|max)`), since
 * `parseModelAndEffort` does not expose `hasExplicitEffort`.
 *
 * @param {string} modelString
 * @returns {{
 *   hasInlineEffort: boolean,
 *   rawInlineEffort: string|null,
 *   strippedBase: string,
 *   syntax: 'paren'|'hyphen'|null,
 *   invalidEffort: string|null
 * }}
 */
function detectInlineEffort(modelString) {
  const trimmed = String(modelString || '').trim();
  const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const rawEffort = parenMatch[2].trim().toLowerCase();
    return {
      hasInlineEffort: true,
      rawInlineEffort: rawEffort,
      strippedBase: parenMatch[1].trim(),
      syntax: 'paren',
      invalidEffort: EFFORT_SET.has(rawEffort) ? null : rawEffort
    };
  }

  const suffixMatch = trimmed.match(/^(.+?)-(low|medium|high|xhigh|max)$/i);
  if (suffixMatch) {
    const rawEffort = suffixMatch[2].toLowerCase();
    return {
      hasInlineEffort: true,
      rawInlineEffort: rawEffort,
      strippedBase: suffixMatch[1].trim(),
      syntax: 'hyphen',
      invalidEffort: null
    };
  }

  return {
    hasInlineEffort: false,
    rawInlineEffort: null,
    strippedBase: trimmed,
    syntax: null,
    invalidEffort: null
  };
}

function extractLiveCatalogSelectors(capabilityCatalog) {
  if (!capabilityCatalog || capabilityCatalog.ok === false) {
    return null;
  }
  let rawSelectors = null;
  if (Array.isArray(capabilityCatalog)) {
    rawSelectors = capabilityCatalog;
  } else if (capabilityCatalog instanceof Set) {
    rawSelectors = [...capabilityCatalog];
  } else if (Array.isArray(capabilityCatalog.selectors)) {
    rawSelectors = capabilityCatalog.selectors;
  }
  if (!rawSelectors || rawSelectors.length === 0) {
    return null;
  }
  const normalized = rawSelectors
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  return normalized.length > 0 ? new Set(normalized) : null;
}

function formatEffectiveModelForHarness({
  harness,
  originalTrimmed,
  canonicalBase,
  targetEffort,
  fallbackApplied,
  hasInlineEffort
}) {
  if (!fallbackApplied && hasInlineEffort) {
    return originalTrimmed;
  }
  if (!fallbackApplied && originalTrimmed) {
    return originalTrimmed;
  }
  if (harness === 'codex') {
    return `${canonicalBase} (${targetEffort})`;
  }
  if (harness === 'antigravity' || harness === 'cursor') {
    return `${canonicalBase}-${targetEffort}`;
  }
  if (hasInlineEffort) {
    return downshiftModel(originalTrimmed, targetEffort);
  }
  return `${originalTrimmed} (${targetEffort})`;
}

function hasVerifiedCapabilityDescriptor(
  verifiedCapabilities,
  { harness, canonicalBase, targetEffort }
) {
  if (!verifiedCapabilities) {
    return false;
  }
  const candidateHyphen = targetEffort ? `${canonicalBase}-${targetEffort}`.toLowerCase() : canonicalBase.toLowerCase();
  const candidateParen = targetEffort ? `${canonicalBase} (${targetEffort})`.toLowerCase() : canonicalBase.toLowerCase();

  if (Array.isArray(verifiedCapabilities) || verifiedCapabilities instanceof Set) {
    for (const entry of verifiedCapabilities) {
      const normalized = String(entry || '').trim().toLowerCase();
      if (normalized === candidateHyphen || normalized === candidateParen) {
        return true;
      }
    }
    return false;
  }

  if (typeof verifiedCapabilities !== 'object') {
    return false;
  }

  if (harness && verifiedCapabilities[harness] && typeof verifiedCapabilities[harness] === 'object') {
    if (
      hasVerifiedCapabilityDescriptor(verifiedCapabilities[harness], {
        harness: '',
        canonicalBase,
        targetEffort
      })
    ) {
      return true;
    }
  }

  if (Array.isArray(verifiedCapabilities.selectors) || verifiedCapabilities.selectors instanceof Set) {
    for (const sel of verifiedCapabilities.selectors) {
      const normalized = String(sel || '').trim().toLowerCase();
      if (normalized === candidateHyphen || normalized === candidateParen) {
        return true;
      }
    }
  }

  const modelsDesc = verifiedCapabilities.models;
  if (Array.isArray(modelsDesc) || modelsDesc instanceof Set) {
    for (const entry of modelsDesc) {
      const normalized = String(entry || '').trim().toLowerCase();
      if (normalized === candidateHyphen || normalized === candidateParen || normalized === canonicalBase.toLowerCase()) {
        return true;
      }
    }
  } else if (modelsDesc && typeof modelsDesc === 'object') {
    const entry = modelsDesc[canonicalBase] ?? modelsDesc[canonicalBase.toLowerCase()];
    if (entry === true) {
      return true;
    }
    const efforts = Array.isArray(entry) ? entry : (Array.isArray(entry?.efforts) ? entry.efforts : null);
    if (efforts && (!targetEffort || efforts.includes(targetEffort))) {
      return true;
    }
  }

  if (verifiedCapabilities[candidateHyphen] === true || verifiedCapabilities[candidateParen] === true) {
    return true;
  }

  return false;
}

function buildUnsupportedResolution({
  requestedModel = null,
  requestedEffort = null,
  retryEffortFallback = false,
  errorCode = 'UNSUPPORTED_MODEL_EFFORT',
  error
}) {
  return {
    supported: false,
    requestedModel,
    requestedEffort,
    effectiveModel: null,
    effectiveEffort: null,
    fallbackApplied: false,
    provenance: retryEffortFallback ? 'unverified' : null,
    errorCode,
    error
  };
}

/**
 * Resolve retry model and reasoning effort across harness static policies and
 * optional live CLI model catalogs, enforcing `CONFLICTING_MODEL_EFFORT` (when
 * `retryEffortFallback` is enabled), `UNSUPPORTED_MODEL_EFFORT`, `composer-2.5`
 * null-effort rules, and the `medium` retry cap (without raising `low`).
 *
 * @param {object} params
 * @returns {{
 *   supported: boolean,
 *   requestedModel: string|null,
 *   requestedEffort: string|null,
 *   effectiveModel: string|null,
 *   effectiveEffort: string|null,
 *   fallbackApplied: boolean,
 *   provenance: 'live_cli_catalog'|'adapter_static_policy'|'unverified'|null,
 *   errorCode: string|null,
 *   error: string|null
 * }}
 */
export function resolveRetryModelAndEffort(params = {}) {
  const {
    harness = '',
    model = '',
    explicitReasoningEffort,
    reasoningEffort,
    hasExplicitReasoningEffort = false,
    defaultEffort = 'high',
    retryEffortFallback = false,
    capabilityCatalog = null,
    verifiedCapabilities = null
  } = params;

  const normalizedHarness = String(harness || '').trim().toLowerCase();
  const originalTrimmed = typeof model === 'string' ? model.trim() : '';

  if (!originalTrimmed) {
    return buildUnsupportedResolution({
      retryEffortFallback,
      error: 'UNSUPPORTED_MODEL_EFFORT: Model identifier must be a non-empty string.'
    });
  }

  const inline = detectInlineEffort(originalTrimmed);
  if (inline.invalidEffort !== null) {
    return buildUnsupportedResolution({
      requestedModel: originalTrimmed,
      retryEffortFallback,
      error: `UNSUPPORTED_MODEL_EFFORT: Unsupported inline reasoning effort "${inline.invalidEffort}" on model "${originalTrimmed}".`
    });
  }

  const rawConfiguredEffort =
    explicitReasoningEffort !== undefined ? explicitReasoningEffort : reasoningEffort;
  let normalizedConfiguredEffort = null;
  if (rawConfiguredEffort !== undefined && rawConfiguredEffort !== null && String(rawConfiguredEffort).trim() !== '') {
    normalizedConfiguredEffort = String(rawConfiguredEffort).trim().toLowerCase();
    if (!EFFORT_SET.has(normalizedConfiguredEffort)) {
      return buildUnsupportedResolution({
        requestedModel: originalTrimmed,
        retryEffortFallback,
        error: `UNSUPPORTED_MODEL_EFFORT: Unsupported reasoningEffort "${rawConfiguredEffort}".`
      });
    }
  }

  const isExplicitSeatEffort = Boolean(hasExplicitReasoningEffort);

  // Enforce CONFLICTING_MODEL_EFFORT ONLY when retryEffortFallback === true.
  if (
    retryEffortFallback === true &&
    inline.hasInlineEffort &&
    isExplicitSeatEffort &&
    normalizedConfiguredEffort &&
    inline.rawInlineEffort !== normalizedConfiguredEffort
  ) {
    return buildUnsupportedResolution({
      requestedModel: originalTrimmed,
      requestedEffort: inline.rawInlineEffort,
      retryEffortFallback,
      errorCode: 'CONFLICTING_MODEL_EFFORT',
      error: `CONFLICTING_MODEL_EFFORT: Model "${originalTrimmed}" declares inline effort "${inline.rawInlineEffort}" which conflicts with explicit reasoningEffort "${normalizedConfiguredEffort}".`
    });
  }

  const normalizedDefault =
    typeof defaultEffort === 'string' && EFFORT_SET.has(defaultEffort.trim().toLowerCase())
      ? defaultEffort.trim().toLowerCase()
      : 'high';

  const canonicalBase = extractCanonicalBaseModel(inline.strippedBase, normalizedDefault);

  // Cursor / Composer special case: `composer-2.5` has NO effort levels (requested/effective = null).
  if (canonicalBase === 'composer-2.5') {
    if (normalizedHarness && normalizedHarness !== 'cursor' && normalizedHarness !== 'mock') {
      return buildUnsupportedResolution({
        requestedModel: originalTrimmed,
        retryEffortFallback,
        error: `UNSUPPORTED_MODEL_EFFORT: Model "composer-2.5" is not supported on harness "${normalizedHarness}".`
      });
    }
    if (inline.hasInlineEffort || originalTrimmed.toLowerCase() !== 'composer-2.5') {
      return buildUnsupportedResolution({
        requestedModel: originalTrimmed,
        retryEffortFallback,
        error: `UNSUPPORTED_MODEL_EFFORT: Model "composer-2.5" does not accept inline reasoning effort ("${originalTrimmed}").`
      });
    }
    if (retryEffortFallback === true && isExplicitSeatEffort && normalizedConfiguredEffort) {
      return buildUnsupportedResolution({
        requestedModel: originalTrimmed,
        retryEffortFallback,
        error: `UNSUPPORTED_MODEL_EFFORT: Model "composer-2.5" does not support explicit reasoningEffort "${normalizedConfiguredEffort}".`
      });
    }
    return {
      supported: true,
      requestedModel: originalTrimmed,
      requestedEffort: null,
      effectiveModel: 'composer-2.5',
      effectiveEffort: null,
      fallbackApplied: false,
      provenance: retryEffortFallback ? 'adapter_static_policy' : null,
      errorCode: null,
      error: null
    };
  }

  const requestedEffort = inline.hasInlineEffort
    ? inline.rawInlineEffort
    : (normalizedConfiguredEffort || normalizedDefault);

  if (!retryEffortFallback) {
    return {
      supported: true,
      requestedModel: originalTrimmed,
      requestedEffort,
      effectiveModel: originalTrimmed,
      effectiveEffort: requestedEffort,
      fallbackApplied: false,
      provenance: null,
      errorCode: null,
      error: null
    };
  }

  // retryEffortFallback === true: cap at 'medium', never raise 'low'.
  const targetEffort = downshiftEffort(requestedEffort, 'medium');
  const fallbackApplied = targetEffort !== requestedEffort;
  const liveSelectors = extractLiveCatalogSelectors(capabilityCatalog);

  let provenance = null;

  if (liveSelectors) {
    const candidateHyphen = `${canonicalBase}-${targetEffort}`.toLowerCase();
    const candidateParen = `${canonicalBase} (${targetEffort})`.toLowerCase();
    const matchedLive =
      liveSelectors.has(candidateHyphen) ||
      liveSelectors.has(candidateParen) ||
      (normalizedHarness === 'mock' && liveSelectors.has(originalTrimmed.toLowerCase()));
    if (matchedLive) {
      provenance = 'live_cli_catalog';
    } else if (normalizedHarness === 'antigravity') {
      return buildUnsupportedResolution({
        requestedModel: originalTrimmed,
        requestedEffort,
        retryEffortFallback,
        error: `UNSUPPORTED_MODEL_EFFORT: Target fallback selector "${candidateHyphen}" for model "${originalTrimmed}" was not found in live CLI catalog.`
      });
    }
  }

  if (
    !provenance &&
    hasVerifiedCapabilityDescriptor(verifiedCapabilities, {
      harness: normalizedHarness,
      canonicalBase,
      targetEffort
    })
  ) {
    provenance =
      verifiedCapabilities?.source === 'live_cli_catalog'
        ? 'live_cli_catalog'
        : 'adapter_static_policy';
  }

  if (!provenance) {
    if (normalizedHarness === 'mock') {
      provenance = 'adapter_static_policy';
    } else {
      const harnessCatalog = STATIC_CAPABILITY_CATALOG[normalizedHarness];
      const allowedEfforts = harnessCatalog?.[canonicalBase];
      if (!Array.isArray(allowedEfforts)) {
        return buildUnsupportedResolution({
          requestedModel: originalTrimmed,
          requestedEffort,
          retryEffortFallback,
          error: `UNSUPPORTED_MODEL_EFFORT: Model "${originalTrimmed}" on harness "${normalizedHarness || 'unknown'}" has no verified effort capability without a live CLI catalog.`
        });
      }
      if (!allowedEfforts.includes(targetEffort)) {
        return buildUnsupportedResolution({
          requestedModel: originalTrimmed,
          requestedEffort,
          retryEffortFallback,
          error: `UNSUPPORTED_MODEL_EFFORT: Target effort "${targetEffort}" is not supported for "${canonicalBase}" on harness "${normalizedHarness}".`
        });
      }
      if ((normalizedHarness === 'cursor' || normalizedHarness === 'antigravity') && !allowedEfforts.includes(requestedEffort)) {
        return buildUnsupportedResolution({
          requestedModel: originalTrimmed,
          requestedEffort,
          retryEffortFallback,
          error: `UNSUPPORTED_MODEL_EFFORT: Effort "${requestedEffort}" is not supported for "${canonicalBase}" on harness "${normalizedHarness}".`
        });
      }
      provenance = 'adapter_static_policy';
    }
  }

  const effectiveModel = formatEffectiveModelForHarness({
    harness: normalizedHarness,
    originalTrimmed,
    canonicalBase,
    targetEffort,
    fallbackApplied,
    hasInlineEffort: inline.hasInlineEffort
  });

  return {
    supported: true,
    requestedModel: originalTrimmed,
    requestedEffort,
    effectiveModel,
    effectiveEffort: targetEffort,
    fallbackApplied,
    provenance,
    errorCode: null,
    error: null
  };
}

/**
 * Validate retry-effort-fallback capability and inline-vs-explicit effort conflicts
 * across configured judge and seats (used by CLI preflight and unit tests).
 *
 * @param {object} params
 * @param {object} params.config
 * @param {Record<string, object|string[]>} [params.catalogByHarness]
 * @returns {{ valid: boolean, errors: string[], results: Record<string, object> }}
 */
export function validateRetryFallbackCapability({
  config = {},
  catalogByHarness = {},
  verifiedCapabilitiesByHarness = {},
  verifiedCapabilities = null
} = {}) {
  const errors = [];
  const results = {};

  const globalEffort =
    config?.reasoningEffort !== undefined ? config.reasoningEffort : config?.['reasoning-effort'];

  const participants = [];
  if (config?.judge && typeof config.judge === 'object') {
    participants.push({ label: 'judge', id: config.judge.id || 'judge', participant: config.judge });
  }
  if (Array.isArray(config?.seats)) {
    for (let i = 0; i < config.seats.length; i += 1) {
      const seat = config.seats[i];
      if (seat && typeof seat === 'object') {
        participants.push({
          label: `seat "${seat.id || i}"`,
          id: seat.id || `seat-${i}`,
          participant: seat
        });
      }
    }
  }

  for (const entry of participants) {
    const p = entry.participant;
    const harnessKey = String(p.harness || '').trim().toLowerCase();
    const hasExplicitReasoningEffort =
      typeof p._explicitReasoningEffort === 'boolean'
        ? p._explicitReasoningEffort
        : (typeof p.hasExplicitReasoningEffort === 'boolean'
            ? p.hasExplicitReasoningEffort
            : (p.reasoningEffort !== undefined || p['reasoning-effort'] !== undefined));

    const explicitReasoningEffort =
      p.reasoningEffort !== undefined
        ? p.reasoningEffort
        : (p['reasoning-effort'] !== undefined ? p['reasoning-effort'] : globalEffort);

    const resolution = resolveRetryModelAndEffort({
      harness: p.harness,
      model: p.model,
      explicitReasoningEffort,
      hasExplicitReasoningEffort,
      retryEffortFallback: true,
      capabilityCatalog: catalogByHarness?.[harnessKey] ?? catalogByHarness?.[p.harness] ?? null,
      verifiedCapabilities:
        p.verifiedCapabilities ??
        verifiedCapabilitiesByHarness?.[harnessKey] ??
        verifiedCapabilitiesByHarness?.[p.harness] ??
        verifiedCapabilities ??
        null
    });

    results[entry.id] = resolution;
    if (!resolution.supported) {
      errors.push(`${entry.label}: ${resolution.error}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    results
  };
}

/**
 * Pure recovery planner enforcing Spec §2 7-step precedence:
 *   1. `!isRetryable` -> `non_retryable`
 *   2. `retries >= maxRetries` -> `retries_exhausted`
 *   3. `toolFreeRecoveryUsed === true` -> `tool_free_already_used`
 *   4. `remainingBudget <= 0 || remainingBudget < minViable` -> `budget_exhausted`
 *   5. `TimeoutError` / `HeadlessToolDeniedError` -> `evaluateToolFreeEvidenceReadiness` -> `evidence_access_failure`
 *   6. `retryEffortFallback && (TimeoutError | HeadlessToolDeniedError)` -> `resolveRetryModelAndEffort` -> `unsupported_fallback`
 *   7. `canRetry: true` with `setsToolFreeRecoveryUsed: removesTools` and complete `retryDiagnostics`
 *
 * @param {object} params
 * @returns {object}
 */
export function planParticipantRecovery(params = {}) {
  const {
    participantId = null,
    role = 'seat',
    error = null,
    errorClass: providedErrorClass = null,
    isRetryable = true,
    retries = 0,
    maxRetries = 0,
    remainingBudget = Infinity,
    minViable = 0,
    toolFreeRecoveryUsed = false,
    originalAttemptTools,
    phase = 'DELIBERATION',
    round = 1,
    topic = '',
    clarifications = [],
    evidence = [],
    proofs = [],
    priorProofs = [],
    candidate = null,
    previousCandidate = null,
    openObjections = [],
    admittedProofs = [],
    selfContainedInput = null,
    originalInvocationMeta = {},
    harness,
    model,
    reasoningEffort,
    hasExplicitReasoningEffort = false,
    retryEffortFallback = false,
    capabilityCatalog = null,
    verifiedCapabilities = null
  } = params;

  const resolvedErrorClass =
    providedErrorClass ||
    (error?.code === 'HEADLESS_TOOL_DENIED' || error?.name === 'HeadlessToolDeniedError'
      ? 'HeadlessToolDeniedError'
      : error?.name || 'Error');
  const primaryFaultReason =
    typeof error?.message === 'string' && error.message.trim()
      ? error.message.trim()
      : resolvedErrorClass;

  // Step 1: non-retryable
  if (!isRetryable) {
    return {
      canRetry: false,
      terminationKind: 'non_retryable',
      reason: error?.message || `Non-retryable ${resolvedErrorClass}`,
      errorCode: null,
      setsToolFreeRecoveryUsed: false,
      retryDiagnostics: null
    };
  }

  // Step 2: retries exhausted
  if (retries >= maxRetries) {
    return {
      canRetry: false,
      terminationKind: 'retries_exhausted',
      reason: `Retry limit exhausted (${retries}/${maxRetries})`,
      errorCode: null,
      setsToolFreeRecoveryUsed: false,
      retryDiagnostics: null
    };
  }

  // Step 3: single tool-free recovery limit across ALL error classes
  if (toolFreeRecoveryUsed === true) {
    return {
      canRetry: false,
      terminationKind: 'tool_free_already_used',
      reason: 'Tool-free recovery already used once; refusing additional retry',
      errorCode: null,
      setsToolFreeRecoveryUsed: false,
      retryDiagnostics: null
    };
  }

  // Step 4: budget exhausted
  if (remainingBudget <= 0 || remainingBudget < minViable) {
    return {
      canRetry: false,
      terminationKind: 'budget_exhausted',
      reason: `Insufficient remaining budget (${remainingBudget}ms < ${minViable}ms minimum viable)`,
      errorCode: null,
      setsToolFreeRecoveryUsed: false,
      retryDiagnostics: null
    };
  }

  const origTools = originalAttemptTools ?? originalInvocationMeta?.effectiveTools ?? 'read-only';
  const isTimeoutOrToolDenied =
    resolvedErrorClass === 'TimeoutError' || resolvedErrorClass === 'HeadlessToolDeniedError';
  const removesTools = isTimeoutOrToolDenied && origTools !== 'none';

  // Step 5: tool-free readiness check for TimeoutError / HeadlessToolDeniedError
  if (isTimeoutOrToolDenied) {
    const readiness = evaluateToolFreeEvidenceReadiness({
      phase,
      round,
      errorClass: resolvedErrorClass,
      topic,
      clarifications,
      evidence,
      proofs,
      priorProofs,
      candidate,
      previousCandidate,
      openObjections,
      admittedProofs,
      selfContainedInput,
      originalInvocationMeta: {
        ...originalInvocationMeta,
        effectiveTools: origTools
      }
    });
    if (!readiness.ready) {
      const vetoDetail = readiness.vetoReason || readiness.reason;
      return {
        canRetry: false,
        terminationKind: 'evidence_access_failure',
        reason: `Tool-free recovery refused (insufficient self-contained evidence: ${vetoDetail}): ${primaryFaultReason}`,
        missingDependencies: readiness.missingDependencies,
        errorCode: null,
        setsToolFreeRecoveryUsed: false,
        retryDiagnostics: null
      };
    }
  }

  const nextTools = isTimeoutOrToolDenied ? 'none' : origTools;
  const nextCwd =
    nextTools === 'none'
      ? undefined
      : (originalInvocationMeta?.configuredWorkspaceCwd ?? originalInvocationMeta?.effectiveCwd);

  // Step 6: effort fallback only for TimeoutError / HeadlessToolDeniedError when retryEffortFallback === true
  const shouldApplyEffortFallback = Boolean(retryEffortFallback && isTimeoutOrToolDenied);
  let modelResolution = null;

  if (model !== undefined && model !== null && String(model).trim() !== '') {
    modelResolution = resolveRetryModelAndEffort({
      harness,
      model,
      explicitReasoningEffort: reasoningEffort,
      hasExplicitReasoningEffort,
      retryEffortFallback: shouldApplyEffortFallback,
      capabilityCatalog,
      verifiedCapabilities
    });

    if (shouldApplyEffortFallback && !modelResolution.supported) {
      return {
        canRetry: false,
        terminationKind: 'unsupported_fallback',
        reason: modelResolution.error,
        errorCode: modelResolution.errorCode,
        setsToolFreeRecoveryUsed: false,
        retryDiagnostics: null
      };
    }
  }

  const nextModel = modelResolution ? modelResolution.effectiveModel : model;
  const nextReasoningEffort = modelResolution
    ? modelResolution.effectiveEffort
    : (reasoningEffort ?? null);
  const fallbackApplied = Boolean(shouldApplyEffortFallback && modelResolution?.fallbackApplied);
  const fallbackReason = fallbackApplied ? resolvedErrorClass : null;
  const capabilityProvenance = shouldApplyEffortFallback
    ? (modelResolution?.provenance ?? null)
    : null;

  // Step 7: approved retry plan
  return {
    canRetry: true,
    terminationKind: null,
    reason: null,
    errorCode: null,
    nextTools,
    nextCwd,
    nextModel,
    nextReasoningEffort,
    setsToolFreeRecoveryUsed: removesTools,
    retryDiagnostics: {
      participantId,
      role,
      phase,
      round,
      attempt: retries + 1,
      requestedModel: modelResolution?.requestedModel ?? model ?? null,
      requestedEffort: modelResolution?.requestedEffort ?? (reasoningEffort ?? null),
      effectiveModel: nextModel ?? null,
      effectiveEffort: nextReasoningEffort ?? null,
      capabilityProvenance,
      fallbackEnabled: Boolean(retryEffortFallback),
      fallbackApplied,
      fallbackReason,
      tools: nextTools
    }
  };
}
