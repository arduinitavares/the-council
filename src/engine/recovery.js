/**
 * @fileoverview Centralized recovery policy, tool-free evidence readiness checks,
 * dependency extraction, and retry model/effort capability validation.
 * ESM Module (Node >= 22).
 */

import {
  ALLOWED_EFFORTS,
  VALID_DRAIN_STATUSES,
  normalizeExitCode,
  normalizeSignalName,
  extractCanonicalBaseModel,
  downshiftEffort,
  downshiftModel
} from '../harness/cli-runner.js';

export const MAX_PRIMARY_FAULT_REASON_CHARS = 500;
const MAX_DIAGNOSTIC_DETAIL_CHARS = 240;

/** Collapses whitespace to one line and bounds length without splitting surrogate pairs. */
export function boundSingleLineFaultMessage(value, maxChars = MAX_PRIMARY_FAULT_REASON_CHARS) {
  if (value === null || value === undefined) return '';
  const singleLine = String(value).replace(/\s+/g, ' ').trim();
  const limit = Number.isFinite(maxChars) ? Math.floor(maxChars) : MAX_PRIMARY_FAULT_REASON_CHARS;
  if (!singleLine || limit <= 0) return '';
  if (singleLine.length <= limit) return singleLine;
  if (limit <= 3) return singleLine.slice(0, limit);
  let cut = singleLine.slice(0, limit - 3);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}...`;
}

/** Formats concise single-line diagnostic suffix without duplicating text in `baseText`. */
export function formatErrorDiagnosticSuffix(error, baseText = '') {
  if (!error || typeof error !== 'object') return '';
  const baseRaw = typeof baseText === 'string' ? baseText : String(baseText || '');
  const baseNorm = baseRaw.replace(/\s+/g, ' ').trim();
  const hasBase = (s) => Boolean(s) && baseNorm.includes(s);
  const stripEllipsis = (s) => (s.endsWith('...') ? s.slice(0, -3) : s);
  const isDupInBase = (s) => Boolean(s) && hasBase(stripEllipsis(s) || s);
  const firstText = (...vals) => vals.find((v) => typeof v === 'string' && v.trim()) || '';

  const skipCause = 'drainStatus' in error || error.inheritCauseDiagnostics === false;
  const pickOwn = (obj, k) =>
    obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined
      ? obj[k]
      : undefined;
  const pick = (k) => {
    const v1 = pickOwn(error, k);
    if (v1 !== undefined) return v1;
    const v2 = pickOwn(error.trace, k);
    if (v2 !== undefined) return v2;
    if (skipCause) return undefined;
    const v3 = pickOwn(error.cause, k);
    if (v3 !== undefined) return v3;
    return pickOwn(error.cause?.trace, k);
  };
  const pickText = (k) =>
    firstText(error[k], error.trace?.[k]) ||
    (skipCause ? '' : firstText(error.cause?.[k], error.cause?.trace?.[k]));

  const rawDrain = pick('drainStatus');
  const drainStatus = typeof rawDrain === 'string' && VALID_DRAIN_STATUSES.has(rawDrain) ? rawDrain : null;
  const drainExpired = drainStatus === 'drain_expired';
  const exitCode = drainExpired ? null : normalizeExitCode(pick('exitCode'));
  const signal = drainExpired ? null : normalizeSignalName(pick('signal'));

  const parts = [];
  if (exitCode !== null) {
    const escapedCode = String(exitCode).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(?:^|\\D)exit code ${escapedCode}(?!\\d)`).test(baseNorm)) parts.push(`(exit code ${exitCode})`);
  }
  if (signal && !new RegExp(`\\b${signal}\\b`).test(baseNorm)) parts.push(`(signal ${signal})`);
  if (drainStatus && !hasBase(`drain: ${drainStatus}`)) parts.push(`(drain: ${drainStatus})`);

  if (!drainExpired) {
    const stderrExcerpt = boundSingleLineFaultMessage(pickText('stderr'), MAX_DIAGNOSTIC_DETAIL_CHARS);
    if (stderrExcerpt && !isDupInBase(stderrExcerpt)) parts.push(`— stderr: ${stderrExcerpt}`);

    const envelopeExcerpt = boundSingleLineFaultMessage(pickText('envelopeError'), MAX_DIAGNOSTIC_DETAIL_CHARS);
    const stderrNeedle = stripEllipsis(stderrExcerpt) || stderrExcerpt;
    const envelopeNeedle = stripEllipsis(envelopeExcerpt) || envelopeExcerpt;
    if (
      envelopeExcerpt &&
      !isDupInBase(envelopeExcerpt) &&
      (!stderrExcerpt || (!stderrExcerpt.includes(envelopeNeedle) && !envelopeExcerpt.includes(stderrNeedle)))
    ) {
      parts.push(`— envelope: ${envelopeExcerpt}`);
    }
  }

  if (parts.length === 0) return '';
  const suffixText = parts.join(' ');
  return !baseNorm || /\s$/.test(baseRaw) ? suffixText : ` ${suffixText}`;
}

export const VALID_SELF_CONTAINED_PHASES = Object.freeze([
  'DELIBERATION',
  'JUDGE_AUDIT_SYNTHESIS',
  'VOTING'
]);

const VALID_PHASE_SET = new Set(VALID_SELF_CONTAINED_PHASES);
const EFFORT_SET = new Set(ALLOWED_EFFORTS);
const ENDPOINT_BALANCED_TAIL_SOURCE = '(?:[^\\s"\'`<>\\[\\]]|\\[[^\\s"\'`<>\\[\\]]*\\])*';
const URL_REGEX = new RegExp(
  `\\b(?:https?|file|wss?|ftp|ssh|git|psql|postgres(?:ql)?|mysql|redis|mongodb(?:\\+srv)?|grpc|s3|gs):\\/\\/[^\\s"'\`<>()[\\]]${ENDPOINT_BALANCED_TAIL_SOURCE}`,
  'gi'
);
const EXPLICIT_DELIMITED_TOKEN_REGEX = /(?:`[^`\s]+`|"[^"\s]+"|'[^'\s]+'|<[^<>\s]+>)/g;
const BROAD_RUN_SCAN_REGEX = /[^\s"'`<>;]+/g;
const DIRECTORY_CANDIDATE_REGEX = /^(?:\.\.?\/|\/)?(?:[A-Za-z0-9_.-]+\/)+$/;
const NON_STAR_PATH_SKELETON_REGEX =
  /^(?:\.\.?\/|\/)?\.?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/\.?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/;
const CITATION_TAG_SLASH_LIST_REGEX = /^\[(?:[EPCO])?\d+\](?:\/\[(?:[EPCO])?\d+\])+$/;
const BRACE_SEQ_CONTENT_REGEX =
  /^(?:-?\d+\.\.-?\d+(?:\.\.-?\d+)?|[A-Za-z]\.\.[A-Za-z](?:\.\.-?\d+)?)$/;
const QUERY_PARAM_ASSIGN_REGEX = /\?[^?/\s=]*=/;

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
const BARE_DOMAIN_LOOKBEHIND_SOURCE = '(?<![A-Za-z0-9_/$-]|(?<!\\.)\\.)';
const BARE_DOMAIN_HOST_SOURCE = `(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+${DOMAIN_SUFFIX_SOURCE}`;
const BARE_DOMAIN_WITH_SUFFIX_REGEX = new RegExp(
  `${BARE_DOMAIN_LOOKBEHIND_SOURCE}${BARE_DOMAIN_HOST_SOURCE}(?::\\d{1,5})?[/?#]${ENDPOINT_BALANCED_TAIL_SOURCE}`,
  'gi'
);
const BARE_DOMAIN_WITH_OPTIONAL_PATH_SOURCE =
  `${BARE_DOMAIN_LOOKBEHIND_SOURCE}${BARE_DOMAIN_HOST_SOURCE}(?::\\d{2,5})?(?:[/?#]${ENDPOINT_BALANCED_TAIL_SOURCE})?(?!\\.[A-Za-z0-9]|[A-Za-z0-9_-])`;

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
  'CONTRIBUTING', 'CODE_OF_CONDUCT', 'VERSION', 'MANIFEST', 'TODO',
  'ROADMAP', 'ATTRIBUTION', 'CREDITS', 'INSTALL', 'configure'
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
const BARE_DOMAIN_ENDPOINT_REGEX = new RegExp(BARE_DOMAIN_WITH_OPTIONAL_PATH_SOURCE, 'gi');
const NAMED_EXTERNAL_STANDARD_REGEX = new RegExp(
  `\\b(?:RFC[\\s-]*\\d+|ISO(?:\\/IEC)?[\\s-]*\\d+(?:[-:]\\d+)*|CVE-\\d{4}-\\d+|CWE-\\d+|IEEE[\\s-]*\\d+(?:\\.\\d+)*|NIST[\\s-]+(?:SP[\\s-]+)?\\d+(?:[-.]\\d+)*|FIPS[\\s-]*\\d+(?:-\\d+)?|POSIX(?:\\.\\d+(?:-\\d+)?)?|BCP[\\s-]*\\d+|ECMA-\\d+|OWASP(?:\\s+(?:ASVS|Top\\s+\\d+|SAMM))?|W3C(?:\\s+[A-Z][A-Za-z0-9-]+)?|IETF|MDN|OpenAPI(?:\\s+\\d+(?:\\.\\d+)*)?)\\b`,
  'gi'
);
const CLI_COMMAND_VERB_SOURCE =
  '(?:npm|npx|pnpm|yarn|node|pytest|python3?|cargo|go\\s+test|make|bash|sh|zsh|git|grep|rg|curl|docker|kubectl|uname|cat|ls|whoami|printenv|netstat|lsof|realpath|readlink|basename|dirname|xargs|awk|sed|wc)';
const PROSE_STRICT_COMMAND_VERB_SOURCE =
  '(?:npm|npx|pnpm|yarn|pytest|cargo|kubectl|netstat|lsof|realpath|readlink|dirname|xargs|awk|sed|wc)';
const SHELL_EXEC_SCRIPT_TOKEN_REGEX =
  /^\.\.?\/(?:[^\s;|&<>()]+\.(?:sh|bash|zsh|fish|ps1|bat|cmd|command)|(?:[^\s;|&<>()]*\/)?(?:gradlew|mvnw|configure))$/i;
const SHELL_UNQUOTED_SCRIPT_CMD_REGEX =
  /(?:^|[\s;|&(])\.\.?\/(?:[^\s;|&<>()]+\.(?:sh|bash|zsh|fish|ps1|bat|cmd|command)|(?:[^\s;|&<>()]*\/)?(?:gradlew|mvnw|configure))(?:\s+(?:-[A-Za-z0-9-]+|[^\s;|&<>()])|[;|&]|$)/i;
const REPO_WIDE_OR_RUN_PHRASE_SOURCE =
  '(?:\\b(?:entire|whole|across(?:\\s+the)?)\\s+(?:repo|repository|codebase|workspace)\\b|\\b(?:repo(?:sitory)?|codebase)\\s+(?:check|scan|audit|wide)\\b|\\brepo-wide\\b|\\brun\\s+(?:tests?|command|script)\\b)';
const REPO_WIDE_OR_RUN_PHRASE_REGEX = new RegExp(REPO_WIDE_OR_RUN_PHRASE_SOURCE, 'i');
const UNQUOTED_CHECK_COMMAND_OR_REPO_REGEX = new RegExp(
  `(?:\\b${CLI_COMMAND_VERB_SOURCE}\\b(?:\\s+[-/\\w.]|$)|\\bmake\\b\\s+(?:-[A-Za-z0-9-]+|[./~]|test|check|build|all|clean|install|lint|fmt|ci|verify)(?:\\s|$)|\\b(?:head|tail|find|stat|ps|df|du|env|which)\\b\\s+(?:-[A-Za-z0-9]+|[./~])|${REPO_WIDE_OR_RUN_PHRASE_SOURCE})`,
  'i'
);
const UNQUOTED_PROSE_COMMAND_OR_REPO_REGEX = new RegExp(
  `(?:\\b${PROSE_STRICT_COMMAND_VERB_SOURCE}\\b\\s+(?:-[A-Za-z0-9-]+|[./~]|[a-z0-9_-]+\\.[a-z0-9]{1,8}|test|run|exec|check|build|lint|ci|audit|install|diff|status|log|show|rev-parse)\\b|\\bgo\\s+(?:test|run|build|vet|mod|generate)\\b|\\bgit\\s+(?:status|diff|log|show|rev-parse|ls-files|grep|blame|check-ignore|check-attr|rev-list|branch|tag|remote|fetch|pull|push|merge|rebase|cherry-pick|bisect|worktree)\\b|\\b(?:node|python3?|bash|sh|zsh|docker|curl|grep|rg|cat|ls)\\b\\s+(?:-[A-Za-z0-9-]+|[./~]|https?:\\/\\/|[A-Za-z0-9_./-]+\\.(?:[mc]?[jt]sx?|py|sh|bash|zsh|json|ya?ml|toml|md|txt|log)\\b)|\\bmake\\b\\s+(?:-[A-Za-z0-9-]+|[./~]|test|check|build|all|clean|install|lint|fmt|ci|verify)(?:\\s|$)|\\b(?:head|tail|find|stat|ps|df|du|env|which)\\b\\s+(?:-[A-Za-z0-9]+|[./~])|${REPO_WIDE_OR_RUN_PHRASE_SOURCE})`,
  'i'
);
const SHELL_WRAPPER_WORD_SET = new Set([
  'env',
  'command',
  'builtin',
  'time',
  'nohup',
  'nice',
  'sudo',
  'exec',
  'setsid',
  'stdbuf',
  'timeout'
]);
const SHELL_WRAPPER_SHORT_VALUE_FLAGS = new Map([
  ['exec', new Set(['a'])],
  ['env', new Set(['u', 'C', 'S', 'P'])],
  ['nice', new Set(['n'])],
  ['sudo', new Set(['u', 'g', 'h', 'p', 'r', 't', 'U', 'C', 'D', 'R', 'T'])],
  ['timeout', new Set(['s', 'k'])],
  ['stdbuf', new Set(['i', 'o', 'e'])],
  ['time', new Set(['f', 'o'])]
]);
const SHELL_WRAPPER_LONG_VALUE_FLAGS = new Map([
  ['env', new Set(['--unset', '--chdir', '--split-string', '--argv0', '--ignore-signal', '--block-signal', '--default-signal'])],
  ['nice', new Set(['--adjustment'])],
  ['sudo', new Set(['--user', '--group', '--host', '--prompt', '--role', '--type', '--other-user', '--close-from', '--chdir', '--chroot', '--command-timeout'])],
  ['timeout', new Set(['--signal', '--kill-after'])],
  ['stdbuf', new Set(['--input', '--output', '--error'])],
  ['time', new Set(['--format', '--output'])]
]);
const SHELL_ZERO_ARG_CLI_VERBS = new Set(['uname', 'ls', 'whoami', 'printenv']);
const SHELL_COMPOUND_ZERO_ARG_VERBS = new Set(['pwd', 'id']);
const SHELL_STRICT_CLI_VERBS = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'node',
  'pytest',
  'python',
  'python3',
  'cargo',
  'bash',
  'sh',
  'zsh',
  'git',
  'grep',
  'rg',
  'curl',
  'docker',
  'kubectl',
  'cat',
  'netstat',
  'lsof',
  'realpath',
  'readlink',
  'basename',
  'dirname',
  'xargs',
  'awk',
  'sed',
  'wc'
]);
const SHELL_FLAG_OR_PATH_CLI_VERBS = new Set([
  'head',
  'tail',
  'find',
  'stat',
  'ps',
  'df',
  'du',
  'env',
  'which',
  'command',
  'type',
  'echo',
  'printf'
]);
const SHELL_SPLIT_QUOTE_VERBS = new Set([
  ...SHELL_ZERO_ARG_CLI_VERBS,
  ...SHELL_STRICT_CLI_VERBS,
  ...SHELL_WRAPPER_WORD_SET,
  'make',
  'go',
  'cd'
]);
const SHELL_GIT_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'ls-files',
  'grep',
  'blame',
  'check-ignore',
  'check-attr',
  'rev-list',
  'branch',
  'tag',
  'remote',
  'fetch',
  'pull',
  'push',
  'merge',
  'rebase',
  'cherry-pick',
  'bisect',
  'worktree',
  'stash',
  'clean',
  'reset',
  'checkout',
  'switch',
  'init',
  'clone',
  'config',
  'describe',
  'reflog',
  'shortlog',
  'submodule',
  'restore'
]);
const SHELL_GO_SUBCOMMANDS = new Set([
  'test',
  'run',
  'build',
  'vet',
  'mod',
  'generate',
  'env',
  'list',
  'version',
  'fmt',
  'tool',
  'clean',
  'install',
  'get',
  'doc',
  'help',
  'work',
  'bug'
]);
const SHELL_MAKE_TARGETS = new Set(['test', 'check', 'build', 'all', 'clean', 'install', 'lint', 'fmt', 'ci', 'verify']);
const SHELL_CONTROL_PREFIX_WORDS = new Set(['!', 'if', 'then', 'elif', 'else', 'while', 'until', 'do']);
const SPLIT_QUOTE_PROSE_STOPWORDS = new Set([
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'output',
  'outputs',
  'key',
  'keys',
  'string',
  'strings',
  'field',
  'fields',
  'value',
  'values',
  'literal',
  'literals',
  'token',
  'tokens',
  'word',
  'words',
  'label',
  'labels',
  'name',
  'names',
  'option',
  'options',
  'flag',
  'flags',
  'logic',
  'check',
  'checks',
  'step',
  'steps',
  'case',
  'cases',
  'mode',
  'modes',
  'command',
  'commands',
  'verb',
  'verbs',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'from',
  'by',
  'as',
  'into',
  'onto',
  'per',
  'vs',
  'via',
  'not',
  'only',
  'also',
  'then',
  'than',
  'that',
  'this',
  'here',
  'there',
  'valid',
  'invalid',
  'allowed',
  'refused',
  'constant',
  'equal',
  'equals',
  'matched',
  'matches'
]);

const EXPLICIT_SHELL_FENCE_LANGS = new Set([
  'sh',
  'bash',
  'zsh',
  'shell',
  'console',
  'sh-session',
  'shellsession',
  'shell-session',
  'terminal',
  'fish',
  'ksh',
  'dash',
  'ash',
  'posh',
  'csh',
  'tcsh',
  'pwsh',
  'powershell',
  'ps1',
  'cmd',
  'bat',
  'batch',
  'dos',
  'mksh',
  'yash',
  'osh',
  'nushell',
  'elvish',
  'xonsh'
]);

function isExplicitShellFenceInfo(infoString) {
  if (!infoString || typeof infoString !== 'string') {
    return false;
  }
  let s = infoString.trim();
  if (!s) {
    return false;
  }
  if (s.startsWith('{')) {
    s = s.slice(1).trimStart();
  }
  if (s.startsWith('.')) {
    s = s.slice(1);
  }
  const tokMatch = /^[A-Za-z0-9_+-]+/.exec(s);
  if (!tokMatch) {
    return false;
  }
  let lang = tokMatch[0].toLowerCase();
  if (lang.startsWith('language-')) {
    lang = lang.slice(9);
  } else if (lang.startsWith('lang-')) {
    lang = lang.slice(5);
  }
  return EXPLICIT_SHELL_FENCE_LANGS.has(lang);
}

function isHorizontalWsCode(cc) {
  return cc === 32 || cc === 9 || cc === 13 || cc === 11 || cc === 12;
}

function trimHorizontalWs(str) {
  let start = 0;
  let end = str.length;
  while (start < end && isHorizontalWsCode(str.charCodeAt(start))) {
    start += 1;
  }
  while (end > start && isHorizontalWsCode(str.charCodeAt(end - 1))) {
    end -= 1;
  }
  return start === 0 && end === str.length ? str : str.slice(start, end);
}

function trimLeadingHorizontalWs(str) {
  let start = 0;
  const len = str.length;
  while (start < len && isHorizontalWsCode(str.charCodeAt(start))) {
    start += 1;
  }
  return start === 0 ? str : str.slice(start);
}

function isAsciiAlphaNumCode(cc) {
  return (cc >= 97 && cc <= 122) || (cc >= 65 && cc <= 90) || (cc >= 48 && cc <= 57);
}

function isDelimitedQuotePrefixCode(cc) {
  return isAsciiAlphaNumCode(cc) || cc === 95 || cc === 46 || cc === 47 || cc === 92 || cc === 45;
}

function isShellTokenDelimiterAt(text, idx) {
  const cc = text.charCodeAt(idx);
  if (cc <= 32) {
    return cc === 32 || cc === 10 || cc === 9 || cc === 13 || cc === 11 || cc === 12;
  }
  if (cc <= 127) {
    return cc === 59 || cc === 124 || cc === 38 || cc === 60 || cc === 62 || cc === 40 || cc === 41;
  }
  return /\s/.test(text[idx]);
}

function isTrailingApostropheBoundaryAt(text, idx) {
  const cc = text.charCodeAt(idx);
  if (cc <= 32) {
    return cc === 32 || cc === 10 || cc === 9 || cc === 13 || cc === 11 || cc === 12;
  }
  if (cc <= 127) {
    return cc === 44 || cc === 46 || cc === 59 || cc === 58 || cc === 33 || cc === 63 || cc === 41;
  }
  return /\s/.test(text[idx]);
}

function hasPotentialFileCandidateChar(str) {
  if (str.indexOf('.') !== -1 || str.indexOf('/') !== -1 || str.indexOf(':') !== -1) {
    return true;
  }
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    if (c >= 65 && c <= 90) {
      return true;
    }
  }
  return false;
}

function toAsciiLowerFast(str) {
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    if ((c >= 65 && c <= 90) || c > 127) {
      return str.toLowerCase();
    }
  }
  return str;
}

function findNextNonApostropheSingleQuote(str, fromIdx, len) {
  let pos = fromIdx;
  while (pos < len) {
    const idx = str.indexOf("'", pos);
    if (idx === -1) {
      return -1;
    }
    const isInternalApostrophe =
      isAsciiAlphaNumCode(str.charCodeAt(idx - 1)) &&
      idx + 1 < len &&
      isAsciiAlphaNumCode(str.charCodeAt(idx + 1));
    if (!isInternalApostrophe) {
      return idx;
    }
    pos = idx + 1;
  }
  return -1;
}

function stripShellBinPrefix(word) {
  if (!word || word.charCodeAt(0) !== 47) {
    return word;
  }
  return word.replace(/^(?:\/usr\/local\/bin\/|\/usr\/bin\/|\/bin\/)/i, '');
}

function normalizeInlineEscapedQuotes(text) {
  if (!text || !text.includes('\\"')) {
    return text;
  }
  let count = 0;
  let pos = text.indexOf('\\"');
  while (pos !== -1) {
    const precededBySlash = pos > 0 && text[pos - 1] === '\\';
    if (!precededBySlash) {
      count += 1;
    }
    pos = text.indexOf('\\"', pos + 2);
  }
  if (count < 2 || count % 2 !== 0) {
    return text;
  }
  return text.replace(/(^|[^\\])\\"/g, '$1"');
}

function unescapeInlineShellWords(text) {
  if (!text || !text.includes('\\')) {
    return text;
  }
  let out = '';
  let inSingle = false;
  let inDouble = false;
  const n = text.length;
  let cachedWordEnd = -1;
  let cachedLastWordCharIdx = -1;
  for (let i = 0; i < n; i += 1) {
    const ch = text[i];
    if (ch === "'" && !inDouble) {
      const isApostrophe =
        !inSingle &&
        i > 0 &&
        /[A-Za-z0-9]/.test(text[i - 1]) &&
        ((i + 1 < n && /[A-Za-z0-9]/.test(text[i + 1])) ||
          ((i + 1 >= n || /[\s,.;:!?)]/.test(text[i + 1])) && hasSingleQuoteCloseBeforeSpace(text, i, n) === -1));
      if (!isApostrophe) {
        inSingle = !inSingle;
      }
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      continue;
    }
    if (ch === '\\' && !inSingle && i + 1 < n) {
      const next = text[i + 1];
      if (!inDouble && /[A-Za-z0-9_./-]/.test(next)) {
        if (next === '.') {
          if (i >= cachedWordEnd) {
            cachedLastWordCharIdx = -1;
            let p = i;
            while (p < n && !/[\s;|&<>()]/.test(text[p])) {
              if (text[p] === '\\' && p + 1 < n) {
                const esc = text[p + 1];
                if (/\s/.test(esc)) {
                  break;
                }
                if (!/[.,;:!?]/.test(esc)) {
                  cachedLastWordCharIdx = p;
                }
                p += 2;
                continue;
              }
              if (!/[.,;:!?]/.test(text[p])) {
                cachedLastWordCharIdx = p;
              }
              p += 1;
            }
            cachedWordEnd = p;
          }
          if (cachedLastWordCharIdx <= i + 1) {
            out += ch;
            continue;
          }
        }
        out += next;
        i += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function findClosedCommandSubstitutions(text) {
  if (!text) {
    return { closedFrames: [], topLevelClosed: [] };
  }
  const firstDp = text.indexOf('$(');
  if (firstDp === -1 || text.indexOf(')', firstDp + 2) === -1) {
    return { closedFrames: [], topLevelClosed: [] };
  }
  if (activeReadinessCache && activeReadinessCache.cmdSubs.has(text)) {
    return activeReadinessCache.cmdSubs.get(text);
  }
  const n = text.length;
  const topState = { start: -1, inDouble: false, inSingle: false, noMoreSingle: false, parenDepth: 0, arith: false, children: null };
  const frameStack = [];
  const closedFrames = [];
  const topLevelClosed = [];

  for (let i = 0; i < n; i += 1) {
    const cur = frameStack.length > 0 ? frameStack[frameStack.length - 1] : topState;
    const ch = text[i];

    if (cur.inSingle) {
      if (ch === "'") {
        cur.inSingle = false;
      }
      continue;
    }

    if (ch === '\\') {
      i += 1;
      continue;
    }

    if (ch === '"') {
      cur.inDouble = !cur.inDouble;
      continue;
    }

    if (ch === "'" && !cur.inDouble) {
      const isInternalApostrophe =
        i > 0 && /[A-Za-z0-9]/.test(text[i - 1]) && i + 1 < n && /[A-Za-z0-9]/.test(text[i + 1]);
      if (!isInternalApostrophe && !cur.noMoreSingle) {
        const nextSq = text.indexOf("'", i + 1);
        if (nextSq === -1) {
          cur.noMoreSingle = true;
        } else {
          cur.inSingle = true;
        }
      }
      continue;
    }

    if (ch === '$' && i + 1 < n && text[i + 1] === '(') {
      const isArith = i + 2 < n && text[i + 2] === '(';
      frameStack.push({
        start: i,
        inDouble: false,
        inSingle: false,
        noMoreSingle: false,
        parenDepth: isArith ? 2 : 1,
        arith: isArith,
        children: null
      });
      i += isArith ? 2 : 1;
      continue;
    }

    if (frameStack.length > 0 && !cur.inDouble) {
      if (ch === '(') {
        cur.parenDepth += 1;
        continue;
      }
      if (ch === ')') {
        cur.parenDepth -= 1;
        if (cur.parenDepth === 0) {
          const popped = frameStack.pop();
          popped.end = i + 1;
          closedFrames.push(popped);
          if (frameStack.length > 0) {
            const parent = frameStack[frameStack.length - 1];
            if (!parent.children) {
              parent.children = [popped];
            } else {
              parent.children.push(popped);
            }
          } else {
            topLevelClosed.push(popped);
          }
        }
      }
    }
  }

  const res = { closedFrames, topLevelClosed };
  if (activeReadinessCache) {
    activeReadinessCache.cmdSubs.set(text, res);
  }
  return res;
}

function buildFrameOwnText(text, startIdx, endIdx, children) {
  if (!children || children.length === 0) {
    return text.slice(startIdx, endIdx);
  }
  let out = '';
  let cursor = startIdx;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.start > cursor) {
      out += text.slice(cursor, child.start);
    }
    out += ' __SUB__ ';
    cursor = child.end;
  }
  if (cursor < endIdx) {
    out += text.slice(cursor, endIdx);
  }
  return out;
}

function isFrameOwnBenignFast(text, startIdx, endIdx, children) {
  let cursor = startIdx;
  let firstWordStart = -1;
  let firstWordEnd = -1;
  const childCount = children ? children.length : 0;

  for (let c = 0; c <= childCount; c += 1) {
    const segEnd = c < childCount ? children[c].start : endIdx;
    for (let i = cursor; i < segEnd; i += 1) {
      const code = text.charCodeAt(i);
      if (code <= 32) {
        if (firstWordStart !== -1 && firstWordEnd === -1) {
          firstWordEnd = i;
        }
        continue;
      }
      const isAlphaNumUnderscore =
        (code >= 97 && code <= 122) ||
        (code >= 65 && code <= 90) ||
        (code >= 48 && code <= 57) ||
        code === 95;
      if (!isAlphaNumUnderscore) {
        return false;
      }
      if (firstWordStart === -1) {
        firstWordStart = i;
      }
    }
    if (c < childCount) {
      if (firstWordStart !== -1 && firstWordEnd === -1) {
        firstWordEnd = segEnd;
      }
      cursor = children[c].end;
    }
  }

  if (firstWordStart === -1) {
    return true;
  }
  const wordEnd = firstWordEnd === -1 ? endIdx : firstWordEnd;
  const firstWord = text.slice(firstWordStart, wordEnd).toLowerCase();
  return !SHELL_KNOWN_LOWER_STARTERS.has(firstWord);
}

function hasSingleQuoteCloseBeforeSpace(text, openIdx, n) {
  for (let j = openIdx + 1; j < n; j += 1) {
    const c = text[j];
    if (c === "'") {
      return j;
    }
    if (/\s|[;|&()]/.test(c)) {
      return -1;
    }
  }
  return -1;
}

function stripTrailingProsePunct(str) {
  let end = str.length;
  while (end > 0) {
    const ch = str[end - 1];
    if (ch === '.' || ch === ',' || ch === ';' || ch === ':' || ch === '!' || ch === '?') {
      end -= 1;
    } else {
      break;
    }
  }
  return end === str.length ? str : str.slice(0, end);
}

function hasOddPrecedingBackslashes(str, idx) {
  let count = 0;
  for (let k = idx - 1; k >= 0 && str[k] === '\\'; k -= 1) {
    count += 1;
  }
  return (count & 1) === 1;
}

const PROSE_POST_TAG_WORDS = new Set([
  'and', 'or', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'from', 'by', 'as', 'do', 'does', 'did', 'has', 'have', 'had', 'can',
  'will', 'should', 'must', 'may', 'not'
]);
const PROSE_LIST_INTRODUCERS = new Set([
  'key', 'keys', 'word', 'words', 'token', 'tokens', 'literal', 'literals',
  'string', 'strings', 'name', 'names', 'verb', 'verbs', 'field', 'fields',
  'option', 'options', 'and', 'or'
]);
const PROSE_LIST_FOLLOWERS = new Set(['and', 'or', 'in', 'of', 'is', 'are', 'was', 'were']);
const PROSE_NODE_DETERMINERS = new Set([
  'each', 'every', 'any', 'a', 'an', 'the', 'this', 'that', 'single', 'parent',
  'child', 'root', 'leaf', 'target', 'current'
]);
const VERSIONED_RUNTIME_NOUNS = new Set([
  'node', 'nodejs', 'python', 'python2', 'python3', 'go', 'golang', 'npm', 'pnpm',
  'yarn', 'bun', 'deno', 'cargo', 'rustc', 'docker', 'kubectl', 'git', 'pytest',
  'java', 'javac', 'ruby', 'php', 'perl', 'dotnet', 'clang', 'gcc', 'cmake', 'make'
]);

const PROSE_PREDICATE_POST_COMPARISON_WORDS = new Set([
  'is', 'are', 'was', 'were', 'has', 'have', 'had', 'should', 'must',
  'will', 'can', 'may', 'does', 'do', 'while', 'when', 'where', 'if', 'unless',
  'until', 'before', 'after', 'for', 'in', 'with', 'because', 'since'
]);

const SUBORDINATE_COMPARISON_INTRODUCERS = new Set([
  'if', 'when', 'while', 'unless', 'where', 'because', 'since', 'although', 'though'
]);

const COMPARISON_UNIT_SUFFIXES = [
  '%', 'ms', 's', 'sec', 'secs', 'us', 'ns', 'm', 'min', 'mins', 'h', 'hr', 'hrs', 'd',
  'b', 'kb', 'mb', 'gb', 'tb', 'kib', 'mib', 'gib', 'k', 'x', 'px', 'rem', 'em', 'vh', 'vw',
  'hz', 'khz', 'mhz', 'ghz', 'fps', 'rps', 'qps', 'tps'
];

const COMPARISON_UNIT_WORDS = new Set(COMPARISON_UNIT_SUFFIXES);

const ATTACHED_METRIC_NUMBER_REGEX = new RegExp(
  `^(?:[+-]?\\d+(?:\\.\\d+)*(?:${COMPARISON_UNIT_SUFFIXES.join('|')})?|v\\d+(?:\\.\\d+)*)$`,
  'i'
);
const RUNTIME_VERSION_TOKEN_REGEX =
  /^(?:[+-]?\d+(?:\.\d+)*(?:-(?:alpha|beta|rc)(?:\.\d+)?)?|v\d+(?:\.\d+)*(?:-(?:alpha|beta|rc)(?:\.\d+)?)?)$/i;
const UNSIGNED_RUNTIME_VERSION_TOKEN_REGEX =
  /^(?:\d+(?:\.\d+)*(?:-(?:alpha|beta|rc)(?:\.\d+)?)?|v\d+(?:\.\d+)*(?:-(?:alpha|beta|rc)(?:\.\d+)?)?)$/i;

function isShellStarterVerbLower(lower) {
  return (
    SHELL_SPLIT_QUOTE_VERBS.has(lower) ||
    SHELL_FLAG_OR_PATH_CLI_VERBS.has(lower) ||
    SHELL_COMPOUND_ZERO_ARG_VERBS.has(lower) ||
    SHELL_WRAPPER_WORD_SET.has(lower)
  );
}

function isSpaceOrTabCode(cc) {
  return cc === 32 || cc === 9;
}

function isAsciiAlphaCode(cc) {
  return (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122);
}

function isTagNameBodyCode(cc) {
  return isAsciiAlphaCode(cc) || (cc >= 48 && cc <= 57) || cc === 45;
}

function isVersionTokenStopAt(text, idx) {
  const cc = text.charCodeAt(idx);
  return isShellTokenDelimiterAt(text, idx) || cc === 44 || cc === 58 || cc === 33 || cc === 63;
}

function skipMatchedCloseTagsAt(text, pos, n, openTagStack = null, localOpenedStack = null, consumedOpenCount = 0) {
  let q = pos;
  while (q < n && isSpaceOrTabCode(text.charCodeAt(q))) {
    q += 1;
  }
  let openIdx = openTagStack ? openTagStack.length - 1 - consumedOpenCount : -1;
  let localIdx = localOpenedStack ? localOpenedStack.length - 1 : -1;
  if (openIdx < 0 && localIdx < 0) {
    return { pos: q, consumedOpenCount, remainingLocalLen: 0 };
  }
  let usedOpenCount = consumedOpenCount;
  while (q + 2 < n && text.charCodeAt(q) === 60 && text.charCodeAt(q + 1) === 47 && isAsciiAlphaCode(text.charCodeAt(q + 2))) {
    const closeLim = Math.min(n, q + 32);
    let c = q + 2;
    while (c < closeLim && isTagNameBodyCode(text.charCodeAt(c))) {
      c += 1;
    }
    if (!(c > q + 2 && c < closeLim && text.charCodeAt(c) === 62)) {
      break;
    }
    const tagLower = toAsciiLowerFast(text.slice(q + 2, c));
    if (localIdx >= 0) {
      if (localOpenedStack[localIdx] !== tagLower) {
        break;
      }
      localIdx -= 1;
    } else if (openIdx >= 0) {
      if (openTagStack[openIdx] !== tagLower) {
        break;
      }
      openIdx -= 1;
      usedOpenCount += 1;
    } else {
      break;
    }
    q = c + 1;
    while (q < n && isSpaceOrTabCode(text.charCodeAt(q))) {
      q += 1;
    }
  }
  return {
    pos: q,
    consumedOpenCount: usedOpenCount,
    remainingLocalLen: localIdx + 1
  };
}

function isRedirRhsDelimCode(code) {
  return (
    code <= 32 ||
    code === 34 || // "
    code === 38 || // &
    code === 39 || // '
    code === 40 || // (
    code === 41 || // )
    code === 44 || // ,
    code === 33 || // !
    code === 58 || // :
    code === 59 || // ;
    code === 60 || // <
    code === 62 || // >
    code === 63 || // ?
    code === 92 || // \
    code === 96 || // `
    code === 124 // |
  );
}

function matchRuntimeVersionFollowedByComparisonAt(
  text,
  pos,
  n,
  openTagStack = null,
  localOpenedStack = null,
  consumedOpenCount = 0,
  getLastCloseTagPos = null
) {
  let q = pos;
  while (q < n && isSpaceOrTabCode(text.charCodeAt(q))) {
    q += 1;
  }
  const skippedClose = skipMatchedCloseTagsAt(text, q, n, openTagStack, localOpenedStack, consumedOpenCount);
  q = skippedClose.pos;
  let usedOpenCount = skippedClose.consumedOpenCount;
  let nextLocalStack = skippedClose.remainingLocalLen > 0 ? localOpenedStack.slice(0, skippedClose.remainingLocalLen) : null;
  while (q < n && text.charCodeAt(q) === 60) {
    if (q + 1 < n && text.charCodeAt(q + 1) === 47) {
      const closeRes = skipMatchedCloseTagsAt(text, q, n, openTagStack, nextLocalStack, usedOpenCount);
      if (closeRes.pos === q) {
        break;
      }
      q = closeRes.pos;
      usedOpenCount = closeRes.consumedOpenCount;
      if (nextLocalStack) {
        nextLocalStack.length = closeRes.remainingLocalLen;
      }
      continue;
    }
    if (q + 1 < n && isAsciiAlphaCode(text.charCodeAt(q + 1))) {
      const openLim = Math.min(n, q + 32);
      let c = q + 1;
      while (c < openLim && isTagNameBodyCode(text.charCodeAt(c))) {
        c += 1;
      }
      if (c > q + 1 && c < openLim && text.charCodeAt(c) === 62) {
        const tagRaw = text.slice(q + 1, c);
        const tagLower = toAsciiLowerFast(tagRaw);
        if (
          KNOWN_PATH_EXTENSIONLESS_FILES.has(tagRaw) ||
          (getLastCloseTagPos !== null && getLastCloseTagPos(tagLower) <= c)
        ) {
          break;
        }
        if (!nextLocalStack) {
          nextLocalStack = [tagLower];
        } else {
          nextLocalStack.push(tagLower);
        }
        q = c + 1;
        while (q < n && isSpaceOrTabCode(text.charCodeAt(q))) {
          q += 1;
        }
        continue;
      }
    }
    break;
  }
  let vEnd = q;
  const vLim = Math.min(n, q + 32);
  while (vEnd < vLim && !isVersionTokenStopAt(text, vEnd)) {
    vEnd += 1;
  }
  if (vEnd === q) {
    return null;
  }
  const vTok = text.slice(q, vEnd);
  if (!UNSIGNED_RUNTIME_VERSION_TOKEN_REGEX.test(vTok)) {
    return null;
  }
  return isFollowedByComparisonOpAt(text, vEnd, n, openTagStack, nextLocalStack, usedOpenCount)
    ? { verStart: q, verEnd: vEnd }
    : null;
}

function isRuntimeVersionFollowedByComparisonAt(
  text,
  pos,
  n,
  openTagStack = null,
  localOpenedStack = null,
  consumedOpenCount = 0,
  getLastCloseTagPos = null
) {
  return (
    matchRuntimeVersionFollowedByComparisonAt(
      text,
      pos,
      n,
      openTagStack,
      localOpenedStack,
      consumedOpenCount,
      getLastCloseTagPos
    ) !== null
  );
}

function isFollowedByComparisonOpAt(
  text,
  pos,
  n,
  openTagStack = null,
  localOpenedStack = null,
  consumedOpenCount = 0
) {
  const { pos: q } = skipMatchedCloseTagsAt(text, pos, n, openTagStack, localOpenedStack, consumedOpenCount);
  if (q >= n) {
    return false;
  }
  const c0 = text.charCodeAt(q);
  const c1 = q + 1 < n ? text.charCodeAt(q + 1) : 0;
  // >= (62, 61), <= (60, 61), -> (45, 62), => (61, 62), <- (60, 45)
  if (
    (c0 === 62 && c1 === 61) ||
    (c0 === 60 && c1 === 61) ||
    (c0 === 45 && c1 === 62) ||
    (c0 === 61 && c1 === 62) ||
    (c0 === 60 && c1 === 45)
  ) {
    return true;
  }
  if ((c0 === 60 || c0 === 62) && q + 1 < n) {
    let d = q + 1;
    while (d < n && isSpaceOrTabCode(text.charCodeAt(d))) {
      d += 1;
    }
    if (d >= n) {
      return false;
    }
    const dc = text.charCodeAt(d);
    if (dc >= 48 && dc <= 57) {
      return true;
    }
    if ((dc === 43 || dc === 45 || dc === 118 || dc === 86) && d + 1 < n) {
      const nc = text.charCodeAt(d + 1);
      return nc >= 48 && nc <= 57;
    }
  }
  return false;
}

function startsCoordinatedComparisonAt(
  text,
  pos,
  n,
  openTagStack = null,
  getLastCloseTagPos = null,
  consumedOpenCount = 0
) {
  let p = pos;
  while (p < n && /[ \t]/.test(text[p])) {
    p += 1;
  }
  if (p >= n) {
    return false;
  }
  let localOpenedStack = null;
  while (p < n) {
    if (!(text[p] === '<' && p + 1 < n && /[A-Za-z]/.test(text[p + 1]))) {
      break;
    }
    const tagLim = Math.min(n, p + 32);
    let t = p + 1;
    while (t < tagLim && /[A-Za-z0-9-]/.test(text[t])) {
      t += 1;
    }
    if (!(t < tagLim && text[t] === '>')) {
      break;
    }
    const tagRaw = text.slice(p + 1, t);
    const tagLower = tagRaw.toLowerCase();
    if (KNOWN_PATH_EXTENSIONLESS_FILES.has(tagRaw) || !getLastCloseTagPos || getLastCloseTagPos(tagLower) <= t) {
      break;
    }
    if (!localOpenedStack) {
      localOpenedStack = [];
    }
    localOpenedStack.push(tagLower);
    p = t + 1;
    while (p < n && /[ \t]/.test(text[p])) {
      p += 1;
    }
    if (p >= n) {
      return false;
    }
  }
  let wEnd = p;
  const wLim = Math.min(n, p + 64);
  while (wEnd < wLim && !/[\s;|&<>(),.;:!?]/.test(text[wEnd])) {
    wEnd += 1;
  }
  if (wEnd === p) {
    return false;
  }
  const lhs = text.slice(p, wEnd);
  if (/["'\\=/]/.test(lhs) || lhs.startsWith('-')) {
    return false;
  }
  const lhsLower = lhs.toLowerCase();
  if (
    (SHELL_KNOWN_LOWER_STARTERS.has(lhsLower) || SHELL_WRAPPER_WORD_SET.has(lhsLower)) &&
    !VERSIONED_RUNTIME_NOUNS.has(lhsLower)
  ) {
    return false;
  }
  if (isFollowedByComparisonOpAt(text, wEnd, n, openTagStack, localOpenedStack, consumedOpenCount)) {
    return true;
  }
  return (
    VERSIONED_RUNTIME_NOUNS.has(lhsLower) &&
    isRuntimeVersionFollowedByComparisonAt(
      text,
      wEnd,
      n,
      openTagStack,
      localOpenedStack,
      consumedOpenCount,
      getLastCloseTagPos
    )
  );
}

function isLikelyShellTokenAt(
  text,
  pos,
  n,
  openTagStack = null,
  localOpenedStack = null,
  consumedOpenCount = 0,
  getLastCloseTagPos = null
) {
  if (pos >= n) {
    return false;
  }
  let end = pos;
  const limit = Math.min(n, pos + 64);
  while (end < limit && !/[\s;|&<>()]/.test(text[end])) {
    end += 1;
  }
  if (end === pos) {
    return text[pos] === '<' || text[pos] === '>';
  }
  const rawTok = text.slice(pos, end);
  if (/["'\\=]/.test(rawTok)) {
    return true;
  }
  const cleanTok = stripTrailingProsePunct(rawTok);
  if (!cleanTok) {
    return false;
  }
  if (SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(cleanTok)) {
    return true;
  }
  const lowerTok = stripShellBinPrefix(cleanTok).toLowerCase();
  if (isShellStarterVerbLower(lowerTok)) {
    if (
      VERSIONED_RUNTIME_NOUNS.has(lowerTok) &&
      rawTok === cleanTok &&
      (isFollowedByComparisonOpAt(text, end, n, openTagStack, localOpenedStack, consumedOpenCount) ||
        isRuntimeVersionFollowedByComparisonAt(
          text,
          end,
          n,
          openTagStack,
          localOpenedStack,
          consumedOpenCount,
          getLastCloseTagPos
        ))
    ) {
      return false;
    }
    if (
      lowerTok === 'git' &&
      rawTok === cleanTok &&
      isFollowedByComparisonOpAt(text, end, n, openTagStack, localOpenedStack, consumedOpenCount)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function isProseNumericOrVersionComparison(
  tokens,
  targetRaw,
  targetClean,
  targetLastEscaped,
  fdLen,
  isMultiCharRedir,
  text,
  nextPos,
  segTokenCount,
  segHardStarterCount,
  hasPriorComparisonContext,
  openTagStack,
  getLastCloseTagPos
) {
  if (fdLen !== 0 || isMultiCharRedir || targetLastEscaped || /["'\\]/.test(targetRaw)) {
    return false;
  }
  if (tokens.length === 0) {
    return false;
  }
  const prevTok = tokens[tokens.length - 1];
  if (
    prevTok.hasUnquotedTrailingPunct ||
    prevTok.followedByRedir ||
    prevTok.precededByRedir ||
    prevTok.wasQuoted ||
    prevTok.raw.includes('\\') ||
    prevTok.isEnvAssign ||
    prevTok.trimmedClean.includes('/') ||
    prevTok.trimmedClean.startsWith('-')
  ) {
    return false;
  }
  const prevLower = prevTok.trimmedClean.toLowerCase();
  if (!prevLower) {
    return false;
  }
  if (segHardStarterCount > 0) {
    return false;
  }
  const n = text.length;
  const targetPunct = targetRaw.slice(targetClean.length);
  let afterTargetPos = nextPos;
  const postClose = skipMatchedCloseTagsAt(text, afterTargetPos, n, openTagStack, null, 0);
  afterTargetPos = postClose.pos;
  const preConsumedOpenCount = postClose.consumedOpenCount;
  let effectivePunct = targetPunct;
  if (effectivePunct === '' && preConsumedOpenCount > 0 && afterTargetPos < n && /[,.;:!?]/.test(text[afterTargetPos])) {
    let punctEnd = afterTargetPos + 1;
    while (punctEnd < n && /[,.;:!?]/.test(text[punctEnd])) {
      punctEnd += 1;
    }
    if (punctEnd >= n || /[\s)\]}]/.test(text[punctEnd])) {
      effectivePunct = text.slice(afterTargetPos, punctEnd);
      afterTargetPos = punctEnd;
      while (afterTargetPos < n && /[ \t]/.test(text[afterTargetPos])) {
        afterTargetPos += 1;
      }
    }
  }
  const targetHasNonCommaPunct = effectivePunct.length > 0 && effectivePunct !== ',';
  const coordinatedAfterComma =
    effectivePunct === ',' &&
    afterTargetPos < n &&
    startsCoordinatedComparisonAt(text, afterTargetPos, n, openTagStack, getLastCloseTagPos, preConsumedOpenCount);
  if (
    !targetHasNonCommaPunct &&
    !coordinatedAfterComma &&
    afterTargetPos < n &&
    isLikelyShellTokenAt(text, afterTargetPos, n, openTagStack, null, preConsumedOpenCount, getLastCloseTagPos)
  ) {
    return false;
  }
  const isPairVersionLhs = Boolean(prevTok.isRuntimeVersionPair && tokens.length >= 2);
  const lhsSpan = isPairVersionLhs ? 2 : 1;
  const isRuntimeStarter = SHELL_KNOWN_LOWER_STARTERS.has(prevLower) || SHELL_WRAPPER_WORD_SET.has(prevLower);
  if (isRuntimeStarter || isPairVersionLhs) {
    if ((!isPairVersionLhs && !VERSIONED_RUNTIME_NOUNS.has(prevLower)) || !RUNTIME_VERSION_TOKEN_REGEX.test(targetClean)) {
      return false;
    }
    let hasAffirmativeProseContext = hasPriorComparisonContext || coordinatedAfterComma;
    if (!hasAffirmativeProseContext && effectivePunct === ',' && afterTargetPos < n) {
      let cwEnd = afterTargetPos;
      const cwLim = Math.min(n, afterTargetPos + 16);
      while (cwEnd < cwLim && /[A-Za-z]/.test(text[cwEnd])) {
        cwEnd += 1;
      }
      const cwLower = cwEnd > afterTargetPos ? text.slice(afterTargetPos, cwEnd).toLowerCase() : '';
      if ((cwLower === 'and' || cwLower === 'or') && cwEnd < n && /[ \t]/.test(text[cwEnd])) {
        hasAffirmativeProseContext = startsCoordinatedComparisonAt(
          text,
          cwEnd,
          n,
          openTagStack,
          getLastCloseTagPos,
          preConsumedOpenCount
        );
      } else if (
        segTokenCount === lhsSpan + 1 &&
        tokens.length >= lhsSpan + 1 &&
        !tokens[tokens.length - (lhsSpan + 1)].wasQuoted &&
        !tokens[tokens.length - (lhsSpan + 1)].hasUnquotedTrailingPunct &&
        SUBORDINATE_COMPARISON_INTRODUCERS.has(tokens[tokens.length - (lhsSpan + 1)].trimmedClean.toLowerCase()) &&
        !/[\r\n;|&).,;:!?]/.test(text[afterTargetPos]) &&
        !isLikelyShellTokenAt(text, afterTargetPos, n, openTagStack, null, preConsumedOpenCount, getLastCloseTagPos)
      ) {
        hasAffirmativeProseContext = true;
      }
    }
    if (!hasAffirmativeProseContext && effectivePunct === '' && afterTargetPos < n) {
      let wEnd = afterTargetPos;
      const wLimit = Math.min(n, afterTargetPos + 32);
      while (wEnd < wLimit && !/[\s;|&<>(),.;:!?]/.test(text[wEnd])) {
        wEnd += 1;
      }
      if (wEnd > afterTargetPos && wEnd < n && /[ \t]/.test(text[wEnd])) {
        const nextW = text.slice(afterTargetPos, wEnd);
        if (!/["'\\=]/.test(nextW)) {
          const nextLower = nextW.toLowerCase();
          let afterConnPos = wEnd;
          while (afterConnPos < n && /[ \t]/.test(text[afterConnPos])) {
            afterConnPos += 1;
          }
          if (nextLower === 'and' || nextLower === 'or') {
            hasAffirmativeProseContext = startsCoordinatedComparisonAt(
              text,
              afterConnPos,
              n,
              openTagStack,
              getLastCloseTagPos,
              preConsumedOpenCount
            );
          } else if (
            PROSE_PREDICATE_POST_COMPARISON_WORDS.has(nextLower) &&
            afterConnPos < n &&
            !/[\r\n;|&).,;:!?]/.test(text[afterConnPos]) &&
            !isLikelyShellTokenAt(text, afterConnPos, n, openTagStack, null, preConsumedOpenCount, getLastCloseTagPos)
          ) {
            hasAffirmativeProseContext = true;
          }
        }
      }
    }
    if (!hasAffirmativeProseContext) {
      return false;
    }
  } else if (!ATTACHED_METRIC_NUMBER_REGEX.test(targetClean)) {
    return false;
  }
  return true;
}

const BLOCKQUOTE_QUOTED_HEAD_PROSE_FOLLOWERS = new Set([
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'in',
  'of',
  'for',
  'with',
  'from',
  'has',
  'have',
  'must',
  'should',
  'can',
  'cannot',
  'will',
  'may'
]);

function matchMarkdownBlockquotePrefixAtLineStart(text, opPos, n, getLastCloseTagPos = null, gtCol = 0) {
  let col = gtCol + 1;
  let restStart = opPos + 1;
  let hadSpaceAfterGt = false;
  let innerBaseCol = col;
  if (restStart < n) {
    const firstPost = text.charCodeAt(restStart);
    if (firstPost === 32) {
      hadSpaceAfterGt = true;
      col += 1;
      innerBaseCol = col;
      restStart += 1;
    } else if (firstPost === 9) {
      hadSpaceAfterGt = true;
      innerBaseCol = col + 1;
      col += 4 - (col & 3);
      restStart += 1;
    }
  }
  while (restStart < n && isSpaceOrTabCode(text.charCodeAt(restStart))) {
    const cc = text.charCodeAt(restStart);
    col += cc === 9 ? 4 - (col & 3) : 1;
    restStart += 1;
  }
  const innerIndentCols = col - innerBaseCol;
  if (restStart >= n || text[restStart] === '\r' || text[restStart] === '\n') {
    return hadSpaceAfterGt || opPos + 1 >= n || text[opPos + 1] === '\r' || text[opPos + 1] === '\n'
      ? { nextIndex: restStart, keepLineStart: false, nextCol: col, nextBaseCol: innerBaseCol }
      : null;
  }
  if (
    hadSpaceAfterGt &&
    text[restStart] === '>' &&
    (restStart + 1 >= n ||
      text[restStart + 1] === ' ' ||
      text[restStart + 1] === '\t' ||
      text[restStart + 1] === '\r' ||
      text[restStart + 1] === '\n')
  ) {
    return {
      nextIndex: restStart,
      keepLineStart: innerIndentCols <= 3,
      nextCol: col,
      nextBaseCol: innerIndentCols <= 3 ? col : innerBaseCol
    };
  }
  if (
    hadSpaceAfterGt &&
    innerIndentCols <= 3 &&
    (text[restStart] === '`' || text[restStart] === '~')
  ) {
    const fc = text.charCodeAt(restStart);
    let fEnd = restStart + 1;
    while (fEnd < n && text.charCodeAt(fEnd) === fc) {
      fEnd += 1;
    }
    if (fEnd - restStart >= 3) {
      let validFence = true;
      if (fc === 96) {
        for (let q = fEnd; q < n; q += 1) {
          const qc = text.charCodeAt(q);
          if (qc === 10 || qc === 13) break;
          if (qc === 96) {
            validFence = false;
            break;
          }
        }
      }
      if (validFence) {
        return { nextIndex: restStart, keepLineStart: true, nextCol: col, nextBaseCol: innerBaseCol };
      }
    }
  }
  if (!hadSpaceAfterGt) {
    return null;
  }
  let firstEnd = restStart;
  const firstCap = restStart + 128;
  const firstLim = Math.min(n, firstCap);
  while (firstEnd < firstLim && !isShellTokenDelimiterAt(text, firstEnd)) {
    firstEnd += 1;
  }
  if (
    firstEnd === restStart ||
    (firstEnd === firstCap && firstEnd < n && !isShellTokenDelimiterAt(text, firstEnd))
  ) {
    return null;
  }
  const firstRaw = text.slice(restStart, firstEnd);
  if (
    firstRaw[0] === '/' ||
    firstRaw.startsWith('./') ||
    firstRaw.startsWith('../') ||
    firstRaw.startsWith('~/') ||
    /[$`\\=]/.test(firstRaw)
  ) {
    return null;
  }
  const firstClean = stripTrailingProsePunct(firstRaw);
  const firstIsFile = isLikelyShellFileArg(firstClean);

  let afterFirst = firstEnd;
  while (afterFirst < n && isSpaceOrTabCode(text.charCodeAt(afterFirst))) {
    afterFirst += 1;
  }
  if (afterFirst >= n || /[\r\n;|&)]/.test(text[afterFirst])) {
    return null;
  }
  if (text[afterFirst] === '<' || text[afterFirst] === '>' || text[afterFirst] === '(') {
    if (firstIsFile || /["']/.test(firstRaw) || firstRaw === '-') {
      return null;
    }
    if (text[afterFirst] === '>') {
      return isFollowedByComparisonOpAt(text, firstEnd, n) ? { nextIndex: restStart, keepLineStart: false } : null;
    }
    if (text[afterFirst] === '<') {
      return isFollowedByComparisonOpAt(text, firstEnd, n) ||
        (afterFirst + 1 < n && isAsciiAlphaCode(text.charCodeAt(afterFirst + 1)))
        ? { nextIndex: restStart, keepLineStart: false }
        : null;
    }
    let p = afterFirst + 1;
    while (p < n && isSpaceOrTabCode(text.charCodeAt(p))) {
      p += 1;
    }
    if (p >= n || isLikelyShellTokenAt(text, p, n, null, null, 0, getLastCloseTagPos)) {
      return null;
    }
    return { nextIndex: restStart, keepLineStart: false };
  }

  let secondEnd = afterFirst;
  const secondCap = afterFirst + 128;
  const secondLim = Math.min(n, secondCap);
  while (secondEnd < secondLim && !isShellTokenDelimiterAt(text, secondEnd)) {
    secondEnd += 1;
  }
  if (
    secondEnd === afterFirst ||
    (secondEnd === secondCap && secondEnd < n && !isShellTokenDelimiterAt(text, secondEnd))
  ) {
    return null;
  }
  const secondRaw = text.slice(afterFirst, secondEnd);
  const secondClean = stripTrailingProsePunct(secondRaw);
  const secondLower = stripShellBinPrefix(secondClean).toLowerCase();
  if (
    secondRaw[0] === '/' ||
    secondRaw.startsWith('./') ||
    secondRaw.startsWith('../') ||
    secondRaw.startsWith('~/') ||
    (secondRaw.length > 1 && secondRaw[0] === '-' && secondRaw !== '--') ||
    /[$`\\=#{}]/.test(secondRaw) ||
    SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(secondClean) ||
    (/^\d+$/.test(secondRaw) && secondEnd < n && (text[secondEnd] === '<' || text[secondEnd] === '>'))
  ) {
    return null;
  }
  if (secondRaw === '-' || secondRaw === '--' || secondRaw === '—' || secondRaw === '–') {
    let afterSecond = secondEnd;
    while (afterSecond < n && isSpaceOrTabCode(text.charCodeAt(afterSecond))) {
      afterSecond += 1;
    }
    let thirdEnd = afterSecond;
    const thirdCap = afterSecond + 64;
    const thirdLim = Math.min(n, thirdCap);
    while (thirdEnd < thirdLim && !isShellTokenDelimiterAt(text, thirdEnd)) {
      thirdEnd += 1;
    }
    if (thirdEnd === afterSecond || (thirdEnd === thirdCap && thirdEnd < n && !isShellTokenDelimiterAt(text, thirdEnd))) {
      return null;
    }
    const thirdRaw = text.slice(afterSecond, thirdEnd);
    const thirdClean = stripTrailingProsePunct(thirdRaw);
    const thirdLower = stripShellBinPrefix(thirdClean).toLowerCase();
    if (
      !thirdClean ||
      /["'$`\\=/]/.test(thirdRaw) ||
      !/^[A-Za-z]{2,}$/.test(thirdClean) ||
      isShellStarterVerbLower(thirdLower) ||
      SHELL_CONTROL_PREFIX_WORDS.has(thirdLower)
    ) {
      return null;
    }
    return { nextIndex: restStart, keepLineStart: false };
  }
  if (!secondClean) {
    return null;
  }

  if (/["']/.test(secondRaw)) {
    if (firstIsFile || /["']/.test(firstRaw) || firstRaw === '-') {
      return null;
    }
    const scStart = secondClean[0];
    const scEnd = secondClean[secondClean.length - 1];
    const unquotedSecond =
      secondClean.length >= 2 && ((scStart === '"' && scEnd === '"') || (scStart === "'" && scEnd === "'"))
        ? secondClean.slice(1, -1)
        : secondClean.replace(/^["']+|["']+$/g, '');
    if (
      !unquotedSecond ||
      /["'\s/]/.test(unquotedSecond) ||
      isLikelyShellFileArg(unquotedSecond) ||
      SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(unquotedSecond)
    ) {
      return null;
    }
    const unqLower = stripShellBinPrefix(unquotedSecond).toLowerCase();
    if (isShellStarterVerbLower(unqLower) || SHELL_CONTROL_PREFIX_WORDS.has(unqLower)) {
      if (!/^[A-Z][A-Za-z0-9-]*$/.test(firstClean)) {
        return null;
      }
      let afterSecond = secondEnd;
      while (afterSecond < n && isSpaceOrTabCode(text.charCodeAt(afterSecond))) {
        afterSecond += 1;
      }
      let thirdEnd = afterSecond;
      const thirdLim = Math.min(n, afterSecond + 32);
      while (thirdEnd < thirdLim && !isShellTokenDelimiterAt(text, thirdEnd)) {
        thirdEnd += 1;
      }
      const thirdRaw = text.slice(afterSecond, thirdEnd);
      const thirdClean = stripTrailingProsePunct(thirdRaw);
      const thirdLower = thirdClean.toLowerCase();
      if (
        !thirdClean ||
        /["'$`\\=/]/.test(thirdRaw) ||
        !BLOCKQUOTE_QUOTED_HEAD_PROSE_FOLLOWERS.has(thirdLower)
      ) {
        return null;
      }
      if (thirdLower === 'and' || thirdLower === 'or') {
        let afterThird = thirdEnd;
        while (afterThird < n && isSpaceOrTabCode(text.charCodeAt(afterThird))) {
          afterThird += 1;
        }
        let fourthEnd = afterThird;
        const fourthLim = Math.min(n, afterThird + 64);
        while (fourthEnd < fourthLim && !isShellTokenDelimiterAt(text, fourthEnd)) {
          fourthEnd += 1;
        }
        const fourthRaw = text.slice(afterThird, fourthEnd);
        const fourthClean = stripTrailingProsePunct(fourthRaw);
        const fc0 = fourthClean[0];
        const fcLast = fourthClean[fourthClean.length - 1];
        if (
          fourthClean.length < 3 ||
          !((fc0 === '"' && fcLast === '"') || (fc0 === "'" && fcLast === "'"))
        ) {
          return null;
        }
        const unquotedFourth = fourthClean.slice(1, -1);
        if (
          !unquotedFourth ||
          /["'\s/]/.test(unquotedFourth) ||
          isLikelyShellFileArg(unquotedFourth) ||
          SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(unquotedFourth)
        ) {
          return null;
        }
        let afterFourth = fourthEnd;
        while (afterFourth < n && isSpaceOrTabCode(text.charCodeAt(afterFourth))) {
          afterFourth += 1;
        }
        let fifthEnd = afterFourth;
        const fifthLim = Math.min(n, afterFourth + 32);
        while (fifthEnd < fifthLim && !isShellTokenDelimiterAt(text, fifthEnd)) {
          fifthEnd += 1;
        }
        const fifthRaw = text.slice(afterFourth, fifthEnd);
        const fifthClean = stripTrailingProsePunct(fifthRaw);
        const fifthLower = fifthClean.toLowerCase();
        if (
          !fifthClean ||
          /["'$`\\=/]/.test(fifthRaw) ||
          !BLOCKQUOTE_QUOTED_HEAD_PROSE_FOLLOWERS.has(fifthLower) ||
          fifthLower === 'and' ||
          fifthLower === 'or'
        ) {
          return null;
        }
      }
    }
    return { nextIndex: restStart, keepLineStart: false };
  }

  if (isShellStarterVerbLower(secondLower) || SHELL_CONTROL_PREFIX_WORDS.has(secondLower)) {
    const allowedRuntimeComparison =
      secondRaw === secondClean &&
      !firstIsFile &&
      !/["']/.test(firstRaw) &&
      firstRaw !== '-' &&
      ((VERSIONED_RUNTIME_NOUNS.has(secondLower) &&
        (isFollowedByComparisonOpAt(text, secondEnd, n) ||
          isRuntimeVersionFollowedByComparisonAt(text, secondEnd, n, null, null, 0, getLastCloseTagPos))) ||
        (secondLower === 'git' && isFollowedByComparisonOpAt(text, secondEnd, n)));
    if (!allowedRuntimeComparison) {
      return null;
    }
  }

  if (/["']/.test(firstRaw)) {
    const fcStart = firstClean[0];
    const fcEnd = firstClean[firstClean.length - 1];
    if (
      firstClean.length < 3 ||
      !((fcStart === '"' && fcEnd === '"') || (fcStart === "'" && fcEnd === "'"))
    ) {
      return null;
    }
    const unquotedFirst = firstClean.slice(1, -1);
    if (
      !unquotedFirst ||
      /["'\s/]/.test(unquotedFirst) ||
      isLikelyShellFileArg(unquotedFirst) ||
      SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(unquotedFirst) ||
      !/^[A-Za-z]{2,}$/.test(secondClean)
    ) {
      return null;
    }
    const unqFirstLower = stripShellBinPrefix(unquotedFirst).toLowerCase();
    if (isShellStarterVerbLower(unqFirstLower) || SHELL_CONTROL_PREFIX_WORDS.has(unqFirstLower)) {
      const secLower = secondClean.toLowerCase();
      if (!BLOCKQUOTE_QUOTED_HEAD_PROSE_FOLLOWERS.has(secLower) || secLower === 'and' || secLower === 'or') {
        return null;
      }
    }
    return { nextIndex: restStart, keepLineStart: false };
  }
  if (firstIsFile) {
    if (!/^[A-Za-z]{2,}$/.test(secondClean)) {
      return null;
    }
    return { nextIndex: restStart, keepLineStart: false };
  }
  if (firstRaw === '-' && !/^[A-Za-z]{2,}$/.test(secondClean)) {
    return null;
  }
  return { nextIndex: restStart, keepLineStart: false };
}

function parseShellClausesLinear(text, options = {}) {
  const n = text.length;
  const allowMarkdownBlockquotes = Boolean(options.allowMarkdownBlockquotes);
  const clauses = [];
  let current = {
    tokens: [],
    hasRedirection: false,
    standaloneRedirs: null,
    isFunctionWrap: false,
    pipedIn: false,
    pipedOut: false,
    logicalChain: false
  };
  let pendingRedir = false;
  let pendingSkippedAngleTag = false;
  let openTagStack = null;
  let clearOpenTagsAtWhitespace = false;
  let cachedRuntimeCompVerbIdx = -1;
  let cachedRuntimeCompVerStart = -1;
  let cachedRuntimeCompVerEnd = -1;
  const clearRuntimeComparisonTagCache = () => {
    cachedRuntimeCompVerbIdx = -1;
    cachedRuntimeCompVerStart = -1;
    cachedRuntimeCompVerEnd = -1;
  };
  const hasTopOpenTag = (tagLower) =>
    Boolean(openTagStack && openTagStack.length > 0 && openTagStack[openTagStack.length - 1] === tagLower);
  const pushOpenTag = (tagLower) => {
    if (!openTagStack) {
      openTagStack = [tagLower];
    } else {
      openTagStack.push(tagLower);
    }
  };
  const popOpenTag = () => {
    clearRuntimeComparisonTagCache();
    if (!openTagStack || openTagStack.length === 0) {
      return;
    }
    openTagStack.pop();
    if (openTagStack.length === 0) {
      openTagStack = null;
    }
  };
  const recordStandaloneRedir = (rawSnippet) => {
    if (!rawSnippet) {
      return;
    }
    if (!current.standaloneRedirs) {
      current.standaloneRedirs = [];
    }
    current.standaloneRedirs.push(rawSnippet);
  };
  let lastCloseTagPosMap = undefined;
  let atMarkdownLineStart = allowMarkdownBlockquotes;
  let lineCol = 0;
  let lineBaseCol = 0;
  let lineBqDepth = 0;
  let inMarkdownCodeFence = false;
  let fenceCharCode = 0;
  let fenceMinLen = 0;
  let fenceBqDepth = 0;
  let segTokenCount = 0;
  let segHardStarterCount = 0;
  let pendingQuotedVerbIdx = -1;
  let pendingUnquotedVerbIdx = -1;
  let awaitingComparisonRhs = false;
  let awaitingVersionRhs = false;
  let rhsCompletedComparison = false;
  let rhsCompletedVersionComparison = false;
  let rhsCompletedUnitUsed = false;
  let afterComparisonConj = false;
  let tokenFollowsComparisonConj = false;
  let commaAfterAnyComparisonRhs = false;
  let commaAfterVersionRhs = false;
  let commaConjReady = false;
  let runtimeVerbTok = null;
  const resetSegmentState = () => {
    clearRuntimeComparisonTagCache();
    segTokenCount = 0;
    segHardStarterCount = 0;
    pendingQuotedVerbIdx = -1;
    pendingUnquotedVerbIdx = -1;
    runtimeVerbTok = null;
    awaitingComparisonRhs = false;
    awaitingVersionRhs = false;
    rhsCompletedComparison = false;
    rhsCompletedVersionComparison = false;
    rhsCompletedUnitUsed = false;
    afterComparisonConj = false;
    tokenFollowsComparisonConj = false;
  };
  const clearCommaComparisonState = () => {
    commaAfterAnyComparisonRhs = false;
    commaAfterVersionRhs = false;
    commaConjReady = false;
  };
  const markSegmentRedir = (targetEndsSentence) => {
    openTagStack = null;
    clearOpenTagsAtWhitespace = false;
    clearCommaComparisonState();
    clearRuntimeComparisonTagCache();
    if (targetEndsSentence) {
      resetSegmentState();
    } else {
      awaitingComparisonRhs = false;
      awaitingVersionRhs = false;
      rhsCompletedComparison = false;
      rhsCompletedVersionComparison = false;
      rhsCompletedUnitUsed = false;
      afterComparisonConj = false;
      tokenFollowsComparisonConj = false;
      if (runtimeVerbTok !== null) {
        segHardStarterCount += 1;
        runtimeVerbTok = null;
      }
      if (current.tokens.length > 0 && !current.tokens[current.tokens.length - 1].hasUnquotedTrailingPunct) {
        segHardStarterCount += 1;
        pendingQuotedVerbIdx = -1;
        pendingUnquotedVerbIdx = -1;
      }
    }
  };
  const noteSkippedComparison = (lhsTok) => {
    awaitingComparisonRhs = true;
    awaitingVersionRhs = Boolean(
      lhsTok && (lhsTok.isRuntimeVersionPair || VERSIONED_RUNTIME_NOUNS.has(lhsTok.trimmedClean.toLowerCase()))
    );
    rhsCompletedComparison = false;
    rhsCompletedVersionComparison = false;
    rhsCompletedUnitUsed = false;
    afterComparisonConj = false;
    tokenFollowsComparisonConj = false;
  };
  const getLastCloseTagPos = (tagLower) => {
    if (lastCloseTagPosMap === undefined) {
      if (!text.includes('</')) {
        lastCloseTagPosMap = null;
      } else {
        lastCloseTagPosMap = new Map();
        let pos = text.indexOf('</');
        while (pos !== -1) {
          let end = pos + 2;
          while (end < n && isTagNameBodyCode(text.charCodeAt(end))) {
            end += 1;
          }
          if (end > pos + 2 && end < n && text.charCodeAt(end) === 62 && isAsciiAlphaCode(text.charCodeAt(pos + 2))) {
            lastCloseTagPosMap.set(toAsciiLowerFast(text.slice(pos + 2, end)), pos);
          }
          pos = text.indexOf('</', pos + 2);
        }
      }
    }
    return lastCloseTagPosMap ? lastCloseTagPosMap.get(tagLower) ?? -1 : -1;
  };
  let i = 0;
  let noMoreDouble = false;
  let noMoreSingle = false;
  let nextBsPos = -2;

  const pushClause = () => {
    if (current.tokens.length > 0 || current.hasRedirection) {
      clauses.push(current);
      current = {
        tokens: [],
        hasRedirection: false,
        standaloneRedirs: null,
        isFunctionWrap: false,
        pipedIn: false,
        pipedOut: false,
        logicalChain: false
      };
    } else {
      current.standaloneRedirs = null;
      current.isFunctionWrap = false;
      current.pipedIn = false;
      current.pipedOut = false;
      current.logicalChain = false;
    }
    pendingRedir = false;
    pendingSkippedAngleTag = false;
    openTagStack = null;
    clearOpenTagsAtWhitespace = false;
    resetSegmentState();
    clearCommaComparisonState();
  };

  while (i < n) {
    const wsStart = i;
    if (atMarkdownLineStart) {
      while (i < n) {
        const wcc = text.charCodeAt(i);
        if (wcc === 32) {
          lineCol += 1;
          i += 1;
        } else if (wcc === 9) {
          lineCol += 4 - (lineCol & 3);
          i += 1;
        } else if ((wcc === 13 && i + 1 < n && text.charCodeAt(i + 1) === 10) || wcc === 11 || wcc === 12) {
          i += 1;
        } else {
          break;
        }
      }
    } else {
      while (i < n) {
        const hcc = text.charCodeAt(i);
        if (!isHorizontalWsCode(hcc) || (hcc === 13 && (i + 1 >= n || text.charCodeAt(i + 1) !== 10))) {
          break;
        }
        i += 1;
      }
    }
    if (clearOpenTagsAtWhitespace && i > wsStart) {
      openTagStack = null;
      clearOpenTagsAtWhitespace = false;
      clearRuntimeComparisonTagCache();
    }
    if (i >= n) {
      break;
    }
    const ch = text[i];
    const lineStartHere = atMarkdownLineStart;
    atMarkdownLineStart = false;
    const indentCols = lineStartHere ? lineCol - lineBaseCol : 0;

    if (inMarkdownCodeFence && fenceBqDepth > 0 && lineStartHere && lineBqDepth < fenceBqDepth) {
      if (lineBqDepth === 0) {
        const bqCheck = consumeBlockquotePrefixesAtLineStart(text, wsStart, n, fenceBqDepth);
        if (bqCheck.count === fenceBqDepth) {
          lineBqDepth = bqCheck.count;
          lineCol = bqCheck.col;
          lineBaseCol = bqCheck.baseCol;
          atMarkdownLineStart = true;
          clearOpenTagsAtWhitespace = false;
          i = bqCheck.pos;
          continue;
        }
      }
      inMarkdownCodeFence = false;
      fenceCharCode = 0;
      fenceMinLen = 0;
      fenceBqDepth = 0;
    }

    if (allowMarkdownBlockquotes && lineStartHere && (ch === '`' || ch === '~') && indentCols <= 3) {
      const fc = ch.charCodeAt(0);
      let runEnd = i;
      while (runEnd < n && text.charCodeAt(runEnd) === fc) {
        runEnd += 1;
      }
      const runLen = runEnd - i;
      if (runLen >= 3) {
        if (!inMarkdownCodeFence) {
          let validOpenFence = true;
          if (fc === 96) {
            for (let q = runEnd; q < n; q += 1) {
              const qc = text.charCodeAt(q);
              if (qc === 10 || qc === 13) break;
              if (qc === 96) {
                validOpenFence = false;
                break;
              }
            }
          }
          if (validOpenFence) {
            inMarkdownCodeFence = true;
            fenceCharCode = fc;
            fenceMinLen = runLen;
            fenceBqDepth = lineBqDepth;
          }
        } else if (fc === fenceCharCode && runLen >= fenceMinLen) {
          let q = runEnd;
          while (q < n && isSpaceOrTabCode(text.charCodeAt(q))) {
            q += 1;
          }
          if (q >= n || text.charCodeAt(q) === 10 || text.charCodeAt(q) === 13) {
            inMarkdownCodeFence = false;
            fenceCharCode = 0;
            fenceMinLen = 0;
            fenceBqDepth = 0;
          }
        }
      }
    }

    // Clause separators: &&, ||, ;, |, \n, \r
    if (ch === '\n' || ch === '\r' || ch === ';') {
      pushClause();
      if ((ch === '\n' || ch === '\r') && allowMarkdownBlockquotes) {
        atMarkdownLineStart = true;
        lineCol = 0;
        lineBaseCol = 0;
        lineBqDepth = 0;
      }
      i += ch === '\r' && i + 1 < n && text.charCodeAt(i + 1) === 10 ? 2 : 1;
      continue;
    }
    if (ch === '|') {
      if (i + 1 < n && text[i + 1] === '|') {
        current.logicalChain = true;
        pushClause();
        current.logicalChain = true;
        i += 2;
      } else {
        current.pipedOut = true;
        pushClause();
        current.pipedIn = true;
        i += 1;
      }
      continue;
    }
    if (ch === '&') {
      if (i + 1 < n && text[i + 1] === '&') {
        current.logicalChain = true;
        pushClause();
        current.logicalChain = true;
        i += 2;
        continue;
      }
      if (i + 1 < n && text[i + 1] === '>') {
        const redirStart = i;
        i += i + 2 < n && text[i + 2] === '>' ? 3 : 2;
        while (i < n && /[ \t]/.test(text[i])) i += 1;
        const targetStart = i;
        while (i < n && !isShellTokenDelimiterAt(text, i)) {
          if (text[i] === '\\' && i + 1 < n) {
            i += 2;
          } else if (text[i] === '"' && !noMoreDouble) {
            let closeDq = -1;
            for (let q = i + 1; q < n; q += 1) {
              if (text[q] === '\\' && q + 1 < n) {
                q += 1;
                continue;
              }
              if (text[q] === '"') {
                closeDq = q;
                break;
              }
            }
            if (closeDq === -1) {
              noMoreDouble = true;
              i += 1;
            } else {
              i = closeDq + 1;
            }
          } else if (text[i] === "'" && !noMoreSingle) {
            const endSq = text.indexOf("'", i + 1);
            if (endSq === -1) {
              noMoreSingle = true;
              i += 1;
            } else {
              i = endSq + 1;
            }
          } else {
            i += 1;
          }
        }
        const targetRaw = text.slice(targetStart, i);
        if (targetRaw) {
          const targetLastEscaped = hasOddPrecedingBackslashes(targetRaw, targetRaw.length - 1);
          const targetClean = targetLastEscaped ? targetRaw : stripTrailingProsePunct(targetRaw);
          const targetLast = targetRaw[targetRaw.length - 1];
          const targetEndsSentence =
            !targetLastEscaped &&
            (targetLast === '.' || targetLast === '!' || targetLast === '?') &&
            targetClean !== targetRaw;
          current.hasRedirection = true;
          recordStandaloneRedir(text.slice(redirStart, i));
          if (!targetEndsSentence) {
            pendingRedir = true;
          }
          if (current.tokens.length > 0) {
            current.tokens[current.tokens.length - 1].followedByRedir = true;
          }
          markSegmentRedir(targetEndsSentence);
        }
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === '(') {
      if (current.tokens.length === 1 && i + 1 < n && text[i + 1] === ')') {
        current.isFunctionWrap = true;
        pushClause();
        i += 2;
        continue;
      }
      if (current.tokens.length === 0) {
        i += 1;
        continue;
      }
      pushClause();
      i += 1;
      continue;
    }
    if (ch === ')') {
      if (current.tokens.length > 0 || current.hasRedirection || pendingRedir || openTagStack !== null) {
        pushClause();
      }
      i += 1;
      continue;
    }
    if (ch === '{' && (i + 1 >= n || /\s/.test(text[i + 1])) && current.tokens.length === 0) {
      i += 1;
      continue;
    }
    if (ch === '}' && current.tokens.length === 0) {
      i += 1;
      continue;
    }

    let fdLen = 0;
    if (ch >= '0' && ch <= '9') {
      let k = i;
      while (k < n && text[k] >= '0' && text[k] <= '9') {
        k += 1;
      }
      if (k < n && (text[k] === '<' || text[k] === '>')) {
        let isDigitBeforeMatchedCloseTag = false;
        if (openTagStack && text[k] === '<' && k + 2 < n && text[k + 1] === '/' && /[A-Za-z]/.test(text[k + 2])) {
          const closeLim = Math.min(n, k + 32);
          let c = k + 2;
          while (c < closeLim && /[A-Za-z0-9-]/.test(text[c])) {
            c += 1;
          }
          if (c > k + 2 && c < closeLim && text[c] === '>' && hasTopOpenTag(text.slice(k + 2, c).toLowerCase())) {
            isDigitBeforeMatchedCloseTag = true;
          }
        }
        let isAttachedNumericComparison = false;
        if (!isDigitBeforeMatchedCloseTag) {
          const opC = text[k];
          const nextOpCh = k + 1 < n ? text[k + 1] : '';
          const isMultiOp =
            (opC === '>' && (nextOpCh === '>' || nextOpCh === '&' || nextOpCh === '|')) ||
            (opC === '<' && (nextOpCh === '<' || nextOpCh === '&' || nextOpCh === '>'));
          const pendingVerbTok = pendingUnquotedVerbIdx !== -1 ? current.tokens[pendingUnquotedVerbIdx] : null;
          const hasActiveHardCommandBeforeDigits =
            current.hasRedirection ||
            pendingRedir ||
            current.pipedIn ||
            segHardStarterCount > 0 ||
            pendingQuotedVerbIdx !== -1 ||
            runtimeVerbTok !== null ||
            (pendingVerbTok !== null && !VERSIONED_RUNTIME_NOUNS.has(pendingVerbTok.trimmedClean.toLowerCase()));
          if (!isMultiOp && !hasActiveHardCommandBeforeDigits) {
            if (nextOpCh === '=' || (opC === '<' && nextOpCh === '-')) {
              isAttachedNumericComparison = true;
            } else if (k + 1 < n && !isRedirRhsDelimCode(text.charCodeAt(k + 1))) {
              let rEnd = k + 1;
              const rLim = Math.min(n, k + 65);
              while (rEnd < rLim && !isRedirRhsDelimCode(text.charCodeAt(rEnd))) {
                rEnd += 1;
              }
              if (rEnd > k + 1 && (rEnd === n || rEnd < rLim)) {
                let rhsSlice = text.slice(k + 1, rEnd);
                if (rhsSlice.length > 1 && rhsSlice.endsWith('.')) {
                  rhsSlice = rhsSlice.slice(0, -1);
                }
                if (ATTACHED_METRIC_NUMBER_REGEX.test(rhsSlice)) {
                  isAttachedNumericComparison = true;
                }
              }
            }
          }
        }
        if (!isDigitBeforeMatchedCloseTag && !isAttachedNumericComparison) {
          fdLen = k - i;
        }
      }
    }

    if (fdLen > 0 || ch === '<' || ch === '>') {
      const opPos = i + fdLen;
      const opChar = text[opPos];
      if (fdLen === 0) {
        if (opPos + 1 < n && text[opPos + 1] === '=') {
          const lhsTok = current.tokens.length > 0 ? current.tokens[current.tokens.length - 1] : null;
          if (lhsTok) {
            lhsTok.hadSkippedComparison = true;
            if (
              runtimeVerbTok !== null &&
              lhsTok.isRuntimeVersionPair &&
              current.tokens.length >= 2 &&
              current.tokens[current.tokens.length - 2] === runtimeVerbTok
            ) {
              runtimeVerbTok.hadSkippedComparison = true;
            }
          }
          runtimeVerbTok = null;
          noteSkippedComparison(lhsTok);
          i = opPos + (opPos + 2 < n && text[opPos + 2] === '>' ? 3 : 2);
          continue;
        }
        if (opChar === '>' && opPos > 0 && (text[opPos - 1] === '=' || text[opPos - 1] === '-')) {
          let lhsIdx = current.tokens.length - 1;
          let lhsTok = lhsIdx >= 0 ? current.tokens[lhsIdx] : null;
          if (lhsTok) {
            lhsTok.hadSkippedComparison = true;
            if ((lhsTok.raw === '-' || lhsTok.raw === '=') && !lhsTok.wasQuoted && lhsIdx >= 1) {
              lhsIdx -= 1;
              lhsTok = current.tokens[lhsIdx];
              lhsTok.hadSkippedComparison = true;
            }
            if (
              runtimeVerbTok !== null &&
              lhsTok.isRuntimeVersionPair &&
              lhsIdx >= 1 &&
              current.tokens[lhsIdx - 1] === runtimeVerbTok
            ) {
              runtimeVerbTok.hadSkippedComparison = true;
            }
          }
          runtimeVerbTok = null;
          noteSkippedComparison(lhsTok);
          i = opPos + 1;
          continue;
        }
        if (opChar === '<' && opPos + 1 < n && text[opPos + 1] === '-') {
          const lhsTok = current.tokens.length > 0 ? current.tokens[current.tokens.length - 1] : null;
          if (lhsTok) {
            lhsTok.hadSkippedComparison = true;
            if (
              runtimeVerbTok !== null &&
              lhsTok.isRuntimeVersionPair &&
              current.tokens.length >= 2 &&
              current.tokens[current.tokens.length - 2] === runtimeVerbTok
            ) {
              runtimeVerbTok.hadSkippedComparison = true;
            }
          }
          runtimeVerbTok = null;
          noteSkippedComparison(lhsTok);
          i = opPos + 2;
          continue;
        }
        const hasTagBoundaryBefore = opPos === 0 || /[\s([,;:"'>]/.test(text[opPos - 1]);
        if (
          opChar === '<' &&
          hasTagBoundaryBefore &&
          opPos + 2 < n &&
          text[opPos + 1] !== '/' &&
          text[opPos + 1] !== '<' &&
          !(
            segHardStarterCount > 0 ||
            pendingUnquotedVerbIdx !== -1 ||
            pendingQuotedVerbIdx !== -1 ||
            runtimeVerbTok !== null
          ) &&
          !/[\s;|&<>]/.test(text[opPos + 1])
        ) {
          const urlLim = Math.min(n, opPos + 512);
          let gt = opPos + 1;
          while (gt < urlLim && text[gt] !== '>' && !/[\s<;|&]/.test(text[gt])) {
            gt += 1;
          }
          if (gt > opPos + 1 && gt < urlLim && text[gt] === '>') {
            const inner = text.slice(opPos + 1, gt);
            const hasSchemeUrl = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(inner);
            const hasMailtoAutolink = /^mailto:[^\s@]+@[^\s@]+$/i.test(inner);
            const hostCandidate = inner.split(/[/?#:]/, 1)[0];
            const hostTld = hostCandidate.includes('.') ? hostCandidate.split('.').pop().toLowerCase() : '';
            const hasBareDomain =
              hostCandidate.includes('.') &&
              BARE_DOMAIN_EXACT_REGEX.test(hostCandidate) &&
              !KNOWN_FILE_EXTENSIONS.has(hostTld);
            if (hasSchemeUrl || hasMailtoAutolink || (hasBareDomain && inner.includes('/'))) {
              const afterUrl = gt + 1;
              let urlProbe = afterUrl;
              while (urlProbe < n && (text[urlProbe] === ' ' || text[urlProbe] === '\t')) {
                urlProbe += 1;
              }
              let urlHasNoRedirTarget =
                afterUrl >= n ||
                /[;\r\n)}\]]/.test(text[afterUrl]) ||
                (urlProbe > afterUrl && (urlProbe >= n || /[;)\]}|&<>\r\n]/.test(text[urlProbe])));
              if (!urlHasNoRedirTarget && afterUrl < n && /[.,:!?]/.test(text[afterUrl])) {
                if (afterUrl + 1 >= n || /[\s)\]}]/.test(text[afterUrl + 1])) {
                  if (text[afterUrl] === '.' || text[afterUrl] === '!' || text[afterUrl] === '?') {
                    urlHasNoRedirTarget = true;
                  } else {
                    let afterPunct = afterUrl + 1;
                    while (afterPunct < n && (text[afterPunct] === ' ' || text[afterPunct] === '\t')) {
                      afterPunct += 1;
                    }
                    if (
                      afterPunct >= n ||
                      !isLikelyShellTokenAt(text, afterPunct, n, openTagStack, null, 0, getLastCloseTagPos)
                    ) {
                      urlHasNoRedirTarget = true;
                    }
                  }
                }
              }
              if (!urlHasNoRedirTarget && urlProbe > afterUrl && urlProbe < n) {
                let wEnd = urlProbe;
                const wLim = Math.min(n, urlProbe + 64);
                while (wEnd < wLim && !/[\s;|&<>()]/.test(text[wEnd])) {
                  wEnd += 1;
                }
                const wRaw = text.slice(urlProbe, wEnd);
                const wClean = stripTrailingProsePunct(wRaw);
                if (
                  wRaw.length > 0 &&
                  !/["'\\=]/.test(wRaw) &&
                  wClean.length > 0 &&
                  PROSE_POST_TAG_WORDS.has(wClean.toLowerCase())
                ) {
                  if (/[.!?]$/.test(wRaw)) {
                    urlHasNoRedirTarget = true;
                  } else {
                    let afterW = wEnd;
                    while (afterW < n && (text[afterW] === ' ' || text[afterW] === '\t')) {
                      afterW += 1;
                    }
                    urlHasNoRedirTarget =
                      afterW >= n ||
                      /[\r\n;|&)]/.test(text[afterW]) ||
                      !isLikelyShellTokenAt(text, afterW, n, openTagStack, null, 0, getLastCloseTagPos);
                  }
                }
              }
              if (urlHasNoRedirTarget) {
                i = afterUrl;
                continue;
              }
            }
          }
        }
        const nextTagCc = opPos + 1 < n ? text.charCodeAt(opPos + 1) : 0;
        if (
          opChar === '<' &&
          nextTagCc !== 0 &&
          (isAsciiAlphaCode(nextTagCc) || nextTagCc === 47 || nextTagCc === 33 || nextTagCc === 63) &&
          (hasTagBoundaryBefore || nextTagCc === 47)
        ) {
          let tagEnd = -1;
          const limit = Math.min(n, opPos + 64);
          let isPlainOpenName = isAsciiAlphaCode(nextTagCc);
          let isPlainCloseName =
            nextTagCc === 47 && opPos + 2 < limit && isAsciiAlphaCode(text.charCodeAt(opPos + 2));
          for (let q = opPos + 1; q < limit; q += 1) {
            const tcc = text.charCodeAt(q);
            if (tcc === 62) {
              tagEnd = q;
              break;
            }
            if (
              tcc === 32 ||
              (tcc >= 9 && tcc <= 13) ||
              tcc === 59 ||
              tcc === 124 ||
              tcc === 38 ||
              tcc === 60 ||
              tcc === 40 ||
              tcc === 41 ||
              tcc === 34 ||
              tcc === 39 ||
              (tcc >= 128 && /\s/.test(text[q]))
            ) {
              break;
            }
            if (isPlainOpenName && q > opPos + 1 && !isTagNameBodyCode(tcc)) {
              isPlainOpenName = false;
            }
            if (isPlainCloseName && q > opPos + 2 && !isTagNameBodyCode(tcc)) {
              isPlainCloseName = false;
            }
          }
          if (tagEnd !== -1) {
            const isMatchedCloseTag =
              isPlainCloseName &&
              tagEnd > opPos + 2 &&
              openTagStack !== null &&
              openTagStack.length > 0 &&
              hasTopOpenTag(toAsciiLowerFast(text.slice(opPos + 2, tagEnd)));
            if (!hasTagBoundaryBefore) {
              if (isMatchedCloseTag) {
                popOpenTag();
                pendingSkippedAngleTag = true;
                i = tagEnd + 1;
                continue;
              }
            } else {
              const tagInner = text.slice(opPos + 1, tagEnd);
              const afterIdx = tagEnd + 1;
              let targetProbe = afterIdx;
              while (targetProbe < n && isSpaceOrTabCode(text.charCodeAt(targetProbe))) {
                targetProbe += 1;
              }
              const pendingVerbAtTag = pendingUnquotedVerbIdx !== -1 ? current.tokens[pendingUnquotedVerbIdx] : null;
              let hasActiveStarter =
                segHardStarterCount > 0 || pendingQuotedVerbIdx !== -1 || runtimeVerbTok !== null;
              if (!hasActiveStarter && pendingVerbAtTag !== null && !pendingVerbAtTag.hadSkippedComparison) {
                if (
                  !pendingVerbAtTag.wasQuoted &&
                  !pendingVerbAtTag.hasUnquotedTrailingPunct &&
                  VERSIONED_RUNTIME_NOUNS.has(toAsciiLowerFast(pendingVerbAtTag.trimmedClean))
                ) {
                  if (cachedRuntimeCompVerbIdx === pendingUnquotedVerbIdx && opPos < cachedRuntimeCompVerStart) {
                    hasActiveStarter = false;
                  } else {
                    const matchedRuntimeComp = matchRuntimeVersionFollowedByComparisonAt(
                      text,
                      opPos,
                      n,
                      openTagStack,
                      null,
                      0,
                      getLastCloseTagPos
                    );
                    if (matchedRuntimeComp !== null) {
                      cachedRuntimeCompVerbIdx = pendingUnquotedVerbIdx;
                      cachedRuntimeCompVerStart = matchedRuntimeComp.verStart;
                      cachedRuntimeCompVerEnd = matchedRuntimeComp.verEnd;
                      hasActiveStarter = false;
                    } else {
                      hasActiveStarter = true;
                    }
                  }
                } else {
                  hasActiveStarter = true;
                }
              }
              const isAutoOrSpecial =
                tagInner.length > 0 &&
                (tagInner[0] === '!' ||
                  tagInner[0] === '?' ||
                  (tagInner.length > 1 && tagInner[tagInner.length - 1] === '/'));
              const isUnmatchedCloseTag = Boolean(
                tagInner.length > 1 &&
                  tagInner[0] === '/' &&
                  /^\/[A-Za-z][A-Za-z0-9-]*$/.test(tagInner) &&
                  !isMatchedCloseTag
              );
              let hasNoOutputTarget =
                !isUnmatchedCloseTag &&
                (afterIdx >= n ||
                  /[;\r\n)}\]]/.test(text[afterIdx]) ||
                  (targetProbe > afterIdx && (targetProbe >= n || /[;)\]}|&<>\r\n]/.test(text[targetProbe]))));
              if (!isUnmatchedCloseTag && !hasNoOutputTarget && afterIdx < n && /[.,:!?]/.test(text[afterIdx])) {
                if (afterIdx + 1 >= n || /[\s)\]}]/.test(text[afterIdx + 1])) {
                  if (text[afterIdx] === '.' || text[afterIdx] === '!' || text[afterIdx] === '?') {
                    hasNoOutputTarget = true;
                  } else if (!hasActiveStarter) {
                    let afterPunct = afterIdx + 1;
                    while (afterPunct < n && /[ \t]/.test(text[afterPunct])) {
                      afterPunct += 1;
                    }
                    if (
                      afterPunct >= n ||
                      !isLikelyShellTokenAt(text, afterPunct, n, openTagStack, null, 0, getLastCloseTagPos)
                    ) {
                      hasNoOutputTarget = true;
                    }
                  }
                }
              }
              let isPairedHtmlOpenTag = false;
              let isProsePlaceholderTag = false;
              if (!isAutoOrSpecial && !hasNoOutputTarget && !isMatchedCloseTag && !hasActiveStarter) {
                if (isPlainOpenName && !KNOWN_PATH_EXTENSIONLESS_FILES.has(tagInner)) {
                  const tagLower = toAsciiLowerFast(tagInner);
                  if (getLastCloseTagPos(tagLower) > tagEnd) {
                    let pairedTargetLooksShell = false;
                    if (targetProbe > afterIdx && targetProbe < n) {
                      pairedTargetLooksShell = isLikelyShellTokenAt(
                        text,
                        targetProbe,
                        n,
                        openTagStack,
                        [tagLower],
                        0,
                        getLastCloseTagPos
                      );
                      if (!pairedTargetLooksShell) {
                        let wEnd = targetProbe;
                        const wLimit = Math.min(n, targetProbe + 64);
                        while (wEnd < wLimit && !/[\s;|&<>()]/.test(text[wEnd])) {
                          wEnd += 1;
                        }
                        const wClean = stripTrailingProsePunct(text.slice(targetProbe, wEnd));
                        if (wClean && PROSE_POST_TAG_WORDS.has(wClean.toLowerCase())) {
                          let afterW = wEnd;
                          while (afterW < n && /[ \t]/.test(text[afterW])) {
                            afterW += 1;
                          }
                          if (
                            afterW < n &&
                            isLikelyShellTokenAt(text, afterW, n, openTagStack, [tagLower], 0, getLastCloseTagPos)
                          ) {
                            pairedTargetLooksShell = true;
                          }
                        }
                      }
                    }
                    if (!pairedTargetLooksShell) {
                      isPairedHtmlOpenTag = true;
                    }
                  }
                }
                if (
                  !isPairedHtmlOpenTag &&
                  targetProbe > afterIdx &&
                  /^[a-z][a-z0-9-]*$/.test(tagInner) &&
                  !KNOWN_PATH_EXTENSIONLESS_FILES.has(tagInner)
                ) {
                  let postEnd = targetProbe;
                  const postLimit = Math.min(n, targetProbe + 64);
                  while (postEnd < postLimit && !/[\s;|&<>()]/.test(text[postEnd])) {
                    postEnd += 1;
                  }
                  const postRaw = text.slice(targetProbe, postEnd);
                  const postClean = stripTrailingProsePunct(postRaw);
                  if (
                    postRaw.length > 0 &&
                    !/["'\\=]/.test(postRaw) &&
                    postClean.length > 0 &&
                    PROSE_POST_TAG_WORDS.has(postClean.toLowerCase())
                  ) {
                    if (/[.!?]$/.test(postRaw)) {
                      isProsePlaceholderTag = true;
                    } else {
                      let afterPost = postEnd;
                      while (afterPost < n && /[ \t]/.test(text[afterPost])) {
                        afterPost += 1;
                      }
                      if (afterPost >= n || /[\r\n;|&)]/.test(text[afterPost])) {
                        isProsePlaceholderTag = true;
                      } else if (text[afterPost] === '>') {
                        let qStart = afterPost + 1;
                        while (qStart < n && /[ \t]/.test(text[qStart])) {
                          qStart += 1;
                        }
                        let qEnd = qStart;
                        const qLimit = Math.min(n, qStart + 64);
                        while (qEnd < qLimit && !/[\s;|&<>()]/.test(text[qEnd])) {
                          qEnd += 1;
                        }
                        if (qEnd > qStart && !/["'\\=]/.test(text.slice(qStart, qEnd))) {
                          let afterQ = qEnd;
                          while (afterQ < n && /[ \t]/.test(text[afterQ])) {
                            afterQ += 1;
                          }
                          isProsePlaceholderTag =
                            afterQ >= n ||
                            !isLikelyShellTokenAt(text, afterQ, n, openTagStack, null, 0, getLastCloseTagPos);
                        }
                      } else if (text[afterPost] === '<') {
                        isProsePlaceholderTag = afterPost + 1 < n && /[a-z/]/.test(text[afterPost + 1]);
                      } else {
                        isProsePlaceholderTag = !isLikelyShellTokenAt(
                          text,
                          afterPost,
                          n,
                          openTagStack,
                          null,
                          0,
                          getLastCloseTagPos
                        );
                      }
                    }
                  }
                }
              }
              if (isAutoOrSpecial || hasNoOutputTarget || isMatchedCloseTag || isPairedHtmlOpenTag || isProsePlaceholderTag) {
                if (isPairedHtmlOpenTag) {
                  pushOpenTag(toAsciiLowerFast(tagInner));
                } else if (isMatchedCloseTag) {
                  popOpenTag();
                }
                pendingSkippedAngleTag = true;
                i = tagEnd + 1;
                continue;
              }
            }
          }
        }
      }

      let nextPos = opPos + 1;
      if (opChar === '<' && nextPos < n && text[nextPos] === '<') {
        nextPos += 1;
        if (nextPos < n && (text[nextPos] === '<' || text[nextPos] === '-')) {
          nextPos += 1;
        }
      } else if (opChar === '<' && nextPos < n && (text[nextPos] === '&' || text[nextPos] === '>')) {
        nextPos += 1;
      } else if (opChar === '>' && nextPos < n && (text[nextPos] === '>' || text[nextPos] === '&' || text[nextPos] === '|')) {
        nextPos += 1;
      }
      const isMultiCharRedir = nextPos > opPos + 1;
      if (
        allowMarkdownBlockquotes &&
        !inMarkdownCodeFence &&
        fdLen === 0 &&
        opChar === '>' &&
        !isMultiCharRedir &&
        lineStartHere &&
        indentCols <= 3 &&
        !pendingSkippedAngleTag
      ) {
        const bqMatch = matchMarkdownBlockquotePrefixAtLineStart(text, opPos, n, getLastCloseTagPos, lineCol);
        if (bqMatch !== null) {
          lineBqDepth += 1;
          if (bqMatch.keepLineStart) {
            atMarkdownLineStart = true;
            lineCol = bqMatch.nextCol;
            lineBaseCol = bqMatch.nextBaseCol;
          }
          i = bqMatch.nextIndex;
          continue;
        }
      }
      const isFdDup = text[nextPos - 1] === '&';
      while (nextPos < n && /[ \t]/.test(text[nextPos])) {
        nextPos += 1;
      }
      const markRedir = (targetEndsSentence = false) => {
        current.hasRedirection = true;
        if (!targetEndsSentence) {
          pendingRedir = true;
        }
        if (current.tokens.length > 0) {
          current.tokens[current.tokens.length - 1].followedByRedir = true;
        }
        markSegmentRedir(targetEndsSentence);
      };
      if (isFdDup) {
        const fdTargetStart = nextPos;
        if (nextPos < n && text[nextPos] === '-') {
          nextPos += 1;
        } else {
          while (nextPos < n && text[nextPos] >= '0' && text[nextPos] <= '9') {
            nextPos += 1;
          }
          if (nextPos > fdTargetStart && nextPos < n && text[nextPos] === '-') {
            nextPos += 1;
          }
        }
        if (nextPos > fdTargetStart && (nextPos >= n || /[\s;|&<>().!?,;:]/.test(text[nextPos]))) {
          let fdEndsSentence = false;
          if (
            nextPos < n &&
            (text[nextPos] === '.' || text[nextPos] === '!' || text[nextPos] === '?') &&
            (nextPos + 1 >= n || /\s/.test(text[nextPos + 1]))
          ) {
            fdEndsSentence = true;
            nextPos += 1;
          }
          recordStandaloneRedir(text.slice(i, nextPos));
          markRedir(fdEndsSentence);
          i = nextPos;
          continue;
        }
      }
      const targetStart = nextPos;
      while (nextPos < n && !isShellTokenDelimiterAt(text, nextPos)) {
        if (text[nextPos] === '\\' && nextPos + 1 < n) {
          nextPos += 2;
        } else if (text[nextPos] === '"' && !noMoreDouble) {
          let closeDq = -1;
          for (let q = nextPos + 1; q < n; q += 1) {
            if (text[q] === '\\' && q + 1 < n) {
              q += 1;
              continue;
            }
            if (text[q] === '"') {
              closeDq = q;
              break;
            }
          }
          if (closeDq === -1) {
            noMoreDouble = true;
            nextPos += 1;
          } else {
            nextPos = closeDq + 1;
          }
        } else if (text[nextPos] === "'" && !noMoreSingle) {
          const endSq = text.indexOf("'", nextPos + 1);
          if (endSq === -1) {
            noMoreSingle = true;
            nextPos += 1;
          } else {
            nextPos = endSq + 1;
          }
        } else {
          nextPos += 1;
        }
      }
      const targetRaw = text.slice(targetStart, nextPos);
      if (!targetRaw) {
        i = nextPos > i ? nextPos : i + 1;
        continue;
      }
      const targetLastEscaped = hasOddPrecedingBackslashes(targetRaw, targetRaw.length - 1);
      const targetClean = targetLastEscaped ? targetRaw : stripTrailingProsePunct(targetRaw);
      const prevLhsTok = current.tokens.length > 0 ? current.tokens[current.tokens.length - 1] : null;
      const lhsSpan = prevLhsTok && prevLhsTok.isRuntimeVersionPair ? 2 : 1;
      const hasPriorComparisonContext =
        tokenFollowsComparisonConj ||
        (commaAfterVersionRhs && segTokenCount === lhsSpan) ||
        (commaConjReady && segTokenCount === lhsSpan + 1);
      if (
        isProseNumericOrVersionComparison(
          current.tokens,
          targetRaw,
          targetClean,
          targetLastEscaped,
          fdLen,
          isMultiCharRedir,
          text,
          nextPos,
          segTokenCount,
          segHardStarterCount,
          hasPriorComparisonContext,
          openTagStack,
          getLastCloseTagPos
        )
      ) {
        const lhsTok = current.tokens[current.tokens.length - 1];
        lhsTok.hadSkippedComparison = true;
        if (
          runtimeVerbTok !== null &&
          lhsTok.isRuntimeVersionPair &&
          current.tokens.length >= 2 &&
          current.tokens[current.tokens.length - 2] === runtimeVerbTok
        ) {
          runtimeVerbTok.hadSkippedComparison = true;
        }
        runtimeVerbTok = null;
        noteSkippedComparison(lhsTok);
        i = opPos + 1;
        continue;
      }
      if (runtimeVerbTok !== null) {
        segHardStarterCount += 1;
        runtimeVerbTok = null;
      }
      const targetLast = targetRaw[targetRaw.length - 1];
      const targetEndsSentence =
        !targetLastEscaped &&
        (targetLast === '.' || targetLast === '!' || targetLast === '?') &&
        targetClean !== targetRaw;
      const prevBeforeOp = opPos > 0 ? text[opPos - 1] : '';
      const hasActiveStarterForRedir =
        segHardStarterCount > 0 ||
        pendingUnquotedVerbIdx !== -1 ||
        pendingQuotedVerbIdx !== -1 ||
        runtimeVerbTok !== null;
      if (
        n >= 4096 &&
        fdLen === 0 &&
        opChar === '<' &&
        !isMultiCharRedir &&
        !hasActiveStarterForRedir &&
        segTokenCount >= 1
      ) {
        let tCur = opPos;
        let tCount = 0;
        while (tCur < n && text[tCur] === '<' && tCount < 4) {
          let tEnd = tCur + 1;
          const tLim = Math.min(n, tCur + 26);
          while (
            tEnd < tLim &&
            ((text[tEnd] >= 'a' && text[tEnd] <= 'z') ||
              (tEnd > tCur + 1 && ((text[tEnd] >= '0' && text[tEnd] <= '9') || text[tEnd] === '-')))
          ) {
            tEnd += 1;
          }
          if (!(tEnd > tCur + 1 && tEnd < tLim && text[tEnd] === '>')) {
            break;
          }
          const tName = text.slice(tCur + 1, tEnd);
          if (KNOWN_PATH_EXTENSIONLESS_FILES.has(tName)) {
            tCount = 0;
            break;
          }
          const prevClosePos = getLastCloseTagPos(tName);
          if (prevClosePos < 0 || prevClosePos >= opPos) {
            tCount = 0;
            break;
          }
          tCount += 1;
          tCur = tEnd + 1;
        }
        if (tCount > 0 && n - tCur <= 24 && /^[A-Za-z]*$/.test(text.slice(tCur, n))) {
          i = n;
          continue;
        }
      }
      const isBenignProseBlockquoteWord =
        fdLen === 0 &&
        opChar === '>' &&
        !isMultiCharRedir &&
        opPos + 1 < n &&
        text[opPos + 1] !== ' ' &&
        text[opPos + 1] !== '\t' &&
        !pendingSkippedAngleTag &&
        (opPos === 0 ||
          prevBeforeOp === ' ' ||
          prevBeforeOp === '\t' ||
          prevBeforeOp === '\r' ||
          prevBeforeOp === '\n') &&
        !hasActiveStarterForRedir &&
        /^[A-Za-z]{2,}$/.test(targetClean) &&
        !KNOWN_PATH_EXTENSIONLESS_FILES.has(targetClean);
      if (fdLen > 0 || (targetClean.length > 0 && !isBenignProseBlockquoteWord)) {
        const redirSnippetEnd =
          opChar === '<' && targetRaw.startsWith('/') && nextPos < n && text[nextPos] === '>' ? nextPos + 1 : nextPos;
        recordStandaloneRedir(text.slice(i, redirSnippetEnd));
      }
      markRedir(targetEndsSentence);
      i = nextPos > i ? nextPos : i + 1;
      continue;
    }

    const tokenStart = i;
    let value = '';
    let wasQuoted = false;
    let hasRawEq = false;
    let unprotectedSuffixStart = 0;
    let lastCharWasEscaped = false;

    while (i < n && !isShellTokenDelimiterAt(text, i)) {
      const c = text[i];
      if (c === '=' && i > tokenStart && !wasQuoted && !hasRawEq) {
        const prefix = text.slice(tokenStart, i);
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
          hasRawEq = true;
        }
      }
      if (c === '"') {
        if (noMoreDouble) {
          value += c;
          lastCharWasEscaped = false;
          i += 1;
          continue;
        }
        const nextDq = text.indexOf('"', i + 1);
        if (nextDq === -1) {
          noMoreDouble = true;
          value += c;
          lastCharWasEscaped = false;
          i += 1;
          continue;
        }
        if (nextBsPos !== -1 && nextBsPos <= i) {
          nextBsPos = text.indexOf('\\', i + 1);
        }
        const nextBs = nextBsPos;
        if (nextBs === -1 || nextBs > nextDq) {
          wasQuoted = true;
          const dqSlice = text.slice(i + 1, nextDq);
          value = value ? value + dqSlice : dqSlice;
          unprotectedSuffixStart = value.length;
          lastCharWasEscaped = false;
          i = nextDq + 1;
          continue;
        }
        let closeDq = -1;
        for (let k = nextBs; k < n; k += 1) {
          if (text[k] === '\\' && k + 1 < n) {
            k += 1;
            continue;
          }
          if (text[k] === '"') {
            closeDq = k;
            break;
          }
        }
        if (closeDq === -1) {
          noMoreDouble = true;
          value += c;
          lastCharWasEscaped = false;
          i += 1;
          continue;
        }
        wasQuoted = true;
        let segStart = i + 1;
        for (let k = nextBs; k < closeDq; k += 1) {
          if (text[k] === '\\' && k + 1 < closeDq && (text[k + 1] === '"' || text[k + 1] === '\\' || text[k + 1] === '$')) {
            if (k > segStart) value += text.slice(segStart, k);
            value += text[k + 1];
            k += 1;
            segStart = k + 1;
          }
        }
        if (segStart < closeDq) {
          const tailSlice = text.slice(segStart, closeDq);
          value = value ? value + tailSlice : tailSlice;
        }
        unprotectedSuffixStart = value.length;
        lastCharWasEscaped = false;
        i = closeDq + 1;
        continue;
      }
      if (c === "'") {
        const precededByAlphaNum = i > tokenStart && isAsciiAlphaNumCode(text.charCodeAt(i - 1));
        const followedByAlphaNum = i + 1 < n && isAsciiAlphaNumCode(text.charCodeAt(i + 1));
        if (precededByAlphaNum && followedByAlphaNum) {
          const sameWordClose = hasSingleQuoteCloseBeforeSpace(text, i, n);
          if (sameWordClose === -1) {
            value += c;
            lastCharWasEscaped = false;
            i += 1;
            continue;
          }
        }
        if (noMoreSingle) {
          value += c;
          lastCharWasEscaped = false;
          i += 1;
          continue;
        }
        const closeSq = text.indexOf("'", i + 1);
        if (closeSq === -1) {
          noMoreSingle = true;
          value += c;
          lastCharWasEscaped = false;
          i += 1;
          continue;
        }
        if (precededByAlphaNum && !followedByAlphaNum && i + 1 < n && isTrailingApostropheBoundaryAt(text, i + 1)) {
          value += c;
          lastCharWasEscaped = false;
          i += 1;
          continue;
        }
        wasQuoted = true;
        value += text.slice(i + 1, closeSq);
        unprotectedSuffixStart = value.length;
        lastCharWasEscaped = false;
        i = closeSq + 1;
        continue;
      }
      if (c === '\\' && i + 1 < n) {
        const nextC = text[i + 1];
        if (!/\s/.test(nextC)) {
          value += nextC;
          unprotectedSuffixStart = value.length;
          lastCharWasEscaped = true;
          i += 2;
          continue;
        }
      }
      const runStart = i;
      i += 1;
      while (i < n) {
        const cc = text.charCodeAt(i);
        if (
          cc <= 32 ||
          cc > 126 ||
          cc === 34 ||
          cc === 38 ||
          cc === 39 ||
          cc === 40 ||
          cc === 41 ||
          cc === 59 ||
          cc === 60 ||
          cc === 61 ||
          cc === 62 ||
          cc === 92 ||
          cc === 124
        ) {
          break;
        }
        i += 1;
      }
      const runSlice = text.slice(runStart, i);
      value = value ? value + runSlice : runSlice;
      lastCharWasEscaped = false;
    }

    if (i === tokenStart) {
      i += 1;
      continue;
    }
    const raw = text.slice(tokenStart, i);
    const unprotectedTail = unprotectedSuffixStart >= value.length ? '' : value.slice(unprotectedSuffixStart);
    const unprotectedTailClean = unprotectedTail ? stripTrailingProsePunct(unprotectedTail) : '';
    const hasUnquotedTrailingPunct = unprotectedTailClean !== unprotectedTail;
    const trimmedClean =
      wasQuoted && !lastCharWasEscaped
        ? stripTrailingProsePunct(value)
        : value.slice(0, unprotectedSuffixStart) + unprotectedTailClean;
    const resolvedClean = trimmedClean || value;
    const hasPaddingSpaces =
      value.length > 0 &&
      (value[0] === ' ' || value[0] === '\t' || value[value.length - 1] === ' ' || value[value.length - 1] === '\t');
    const hasTrailingProsePunct = resolvedClean !== value;
    const isQuotedEnvAssign =
      wasQuoted &&
      !hasPaddingSpaces &&
      !hasTrailingProsePunct &&
      resolvedClean.indexOf('=') !== -1 &&
      /^[A-Za-z_][A-Za-z0-9_]*=[^\s]*$/.test(resolvedClean);
    const strippedLower = toAsciiLowerFast(stripShellBinPrefix(resolvedClean));
    const tokObj = {
      raw,
      value,
      trimmedClean: resolvedClean,
      strippedLower,
      wasQuoted,
      hasPaddingSpaces,
      hasTrailingProsePunct,
      hasUnquotedTrailingPunct,
      hadSkippedComparison: false,
      isRuntimeVersionPair: false,
      isEnvAssign: hasRawEq || isQuotedEnvAssign,
      precededByRedir: pendingRedir,
      precededByAngleTag: pendingSkippedAngleTag,
      followedByRedir: false
    };
    const tokIdx = current.tokens.length;
    const isArrowPrefixToken = !wasQuoted && (raw === '-' || raw === '=') && i < n && text[i] === '>';
    if (runtimeVerbTok !== null && !isArrowPrefixToken) {
      segHardStarterCount += 1;
      runtimeVerbTok = null;
    }
    if (pendingQuotedVerbIdx !== -1) {
      if (!tokObj.wasQuoted && PROSE_LIST_FOLLOWERS.has(tokObj.trimmedClean.toLowerCase())) {
        pendingQuotedVerbIdx = -1;
      } else {
        segHardStarterCount += 1;
        pendingQuotedVerbIdx = -1;
      }
    }
    if (pendingUnquotedVerbIdx !== -1 && !isArrowPrefixToken) {
      const pendingVerbTok = current.tokens[pendingUnquotedVerbIdx];
      if (
        !pendingVerbTok.hadSkippedComparison &&
        !pendingVerbTok.wasQuoted &&
        !pendingVerbTok.hasUnquotedTrailingPunct &&
        VERSIONED_RUNTIME_NOUNS.has(toAsciiLowerFast(pendingVerbTok.trimmedClean)) &&
        !tokObj.wasQuoted &&
        !tokObj.hasUnquotedTrailingPunct &&
        !tokObj.raw.includes('\\') &&
        UNSIGNED_RUNTIME_VERSION_TOKEN_REGEX.test(tokObj.value) &&
        ((cachedRuntimeCompVerbIdx === pendingUnquotedVerbIdx &&
          tokenStart === cachedRuntimeCompVerStart &&
          i === cachedRuntimeCompVerEnd) ||
          isFollowedByComparisonOpAt(text, i, n, openTagStack, null, 0))
      ) {
        tokObj.isRuntimeVersionPair = true;
        runtimeVerbTok = pendingVerbTok;
      } else if (!pendingVerbTok.hadSkippedComparison) {
        segHardStarterCount += 1;
      }
      pendingUnquotedVerbIdx = -1;
      clearRuntimeComparisonTagCache();
    }
    current.tokens.push(tokObj);
    const wasAwaitingComparisonRhs = awaitingComparisonRhs;
    const wasAwaitingVersionRhs = awaitingVersionRhs;
    const prevRhsCompleted = rhsCompletedComparison;
    const prevRhsVersionCompleted = rhsCompletedVersionComparison;
    const prevRhsUnitUsed = rhsCompletedUnitUsed;
    awaitingComparisonRhs = false;
    awaitingVersionRhs = false;
    if (tokObj.hasUnquotedTrailingPunct) {
      const strippedPunct = unprotectedTail.slice(unprotectedTailClean.length);
      if (strippedPunct !== ',') {
        clearOpenTagsAtWhitespace = true;
      }
      const unitAfterRhs =
        prevRhsCompleted &&
        !tokObj.wasQuoted &&
        (unprotectedTailClean === '' ||
          (!prevRhsUnitUsed && COMPARISON_UNIT_WORDS.has(unprotectedTailClean.toLowerCase())));
      resetSegmentState();
      if (strippedPunct === ',' && (wasAwaitingComparisonRhs || unitAfterRhs)) {
        commaAfterAnyComparisonRhs = true;
        commaAfterVersionRhs = wasAwaitingVersionRhs || (unitAfterRhs && prevRhsVersionCompleted);
        commaConjReady = false;
      } else {
        clearCommaComparisonState();
      }
    } else if (!isArrowPrefixToken) {
      const tokLower = tokObj.strippedLower;
      if (wasAwaitingComparisonRhs) {
        rhsCompletedComparison = true;
        rhsCompletedVersionComparison = wasAwaitingVersionRhs;
        rhsCompletedUnitUsed = tokObj.wasQuoted || !/^[+-]?\d+(?:\.\d+)*$/.test(tokObj.trimmedClean);
        afterComparisonConj = false;
        tokenFollowsComparisonConj = false;
        clearCommaComparisonState();
      } else if (prevRhsCompleted) {
        if (!prevRhsUnitUsed && !tokObj.wasQuoted && COMPARISON_UNIT_WORDS.has(tokLower)) {
          rhsCompletedComparison = true;
          rhsCompletedVersionComparison = prevRhsVersionCompleted;
          rhsCompletedUnitUsed = true;
        } else if (!tokObj.wasQuoted && (tokLower === 'and' || tokLower === 'or')) {
          rhsCompletedComparison = false;
          rhsCompletedVersionComparison = false;
          rhsCompletedUnitUsed = false;
          afterComparisonConj = true;
          tokenFollowsComparisonConj = false;
        } else {
          rhsCompletedComparison = false;
          rhsCompletedVersionComparison = false;
          rhsCompletedUnitUsed = false;
          afterComparisonConj = false;
          tokenFollowsComparisonConj = false;
        }
      } else if (afterComparisonConj) {
        afterComparisonConj = false;
        tokenFollowsComparisonConj = !tokObj.wasQuoted;
      } else if (!(tokObj.isRuntimeVersionPair && tokenFollowsComparisonConj && !tokObj.wasQuoted)) {
        tokenFollowsComparisonConj = false;
      }

      if (segTokenCount === 0) {
        if (commaAfterAnyComparisonRhs && !tokObj.wasQuoted && (tokLower === 'and' || tokLower === 'or')) {
          commaConjReady = true;
          commaAfterVersionRhs = false;
          commaAfterAnyComparisonRhs = false;
        } else {
          commaConjReady = false;
          commaAfterAnyComparisonRhs = false;
          if (tokObj.wasQuoted) {
            commaAfterVersionRhs = false;
          }
        }
      } else if (segTokenCount === 1) {
        if (!tokObj.isRuntimeVersionPair || tokObj.wasQuoted) {
          commaAfterVersionRhs = false;
        }
        if (commaConjReady && tokObj.wasQuoted) {
          commaConjReady = false;
        }
      } else if (segTokenCount === 2 && commaConjReady && tokObj.isRuntimeVersionPair && !tokObj.wasQuoted) {
        // Preserve commaConjReady across the "<runtime_noun> <version>" pair.
      } else {
        clearCommaComparisonState();
      }

      const isVerb =
        SHELL_SPLIT_QUOTE_VERBS.has(tokLower) ||
        SHELL_FLAG_OR_PATH_CLI_VERBS.has(tokLower) ||
        SHELL_COMPOUND_ZERO_ARG_VERBS.has(tokLower);
      if (
        tokObj.isEnvAssign ||
        tokObj.precededByRedir ||
        tokObj.followedByRedir ||
        (nextBsPos !== -1 && tokObj.raw.indexOf('\\') !== -1) ||
        (tokObj.trimmedClean.charCodeAt(0) === 46 && SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(tokObj.trimmedClean))
      ) {
        segHardStarterCount += 1;
      } else if (isVerb) {
        if (!tokObj.wasQuoted) {
          if (
            !(
              tokLower === 'node' &&
              segTokenCount > 0 &&
              PROSE_NODE_DETERMINERS.has(current.tokens[tokIdx - 1].trimmedClean.toLowerCase())
            )
          ) {
            pendingUnquotedVerbIdx = tokIdx;
          }
        } else {
          const isWholeQuote =
            tokObj.raw.length >= 2 &&
            ((tokObj.raw[0] === '"' && tokObj.raw[tokObj.raw.length - 1] === '"') ||
              (tokObj.raw[0] === "'" && tokObj.raw[tokObj.raw.length - 1] === "'"));
          if (!isWholeQuote) {
            segHardStarterCount += 1;
          } else if (
            tokIdx > 0 &&
            (current.tokens[tokIdx - 1].hasUnquotedTrailingPunct ||
              PROSE_LIST_INTRODUCERS.has(current.tokens[tokIdx - 1].trimmedClean.toLowerCase()))
          ) {
            pendingQuotedVerbIdx = tokIdx;
          } else {
            segHardStarterCount += 1;
          }
        }
      }
      segTokenCount += 1;
    }
    pendingRedir = false;
    pendingSkippedAngleTag = false;
  }

  pushClause();
  return clauses;
}

function getClauseRedirReach(clause) {
  if (!clause || !clause.hasRedirection || clause.tokens.length === 0) {
    return null;
  }
  if (clause.redirReach !== undefined) {
    return clause.redirReach;
  }
  const tokens = clause.tokens;
  const len = tokens.length;
  const reach = new Uint8Array(len);
  let futureRedir = false;
  for (let r = len - 1; r >= 0; r -= 1) {
    const tok = tokens[r];
    if (tok.hasUnquotedTrailingPunct) {
      reach[r] = 0;
      futureRedir = Boolean(tok.precededByRedir) && !tok.precededByAngleTag;
    } else {
      const hit = Boolean(tok.followedByRedir) || futureRedir;
      reach[r] = hit ? 1 : 0;
      futureRedir = tok.precededByAngleTag ? false : Boolean(tok.precededByRedir) || hit;
    }
  }
  clause.redirReach = reach;
  return reach;
}

function clauseLooksLikeShellCommandFrom(clause, startIdx, isCompound, options = {}) {
  const { isSubshellOrSubCmd = false, strictProseMode = false } = options;
  const tokens = clause.tokens;
  if (!tokens || startIdx >= tokens.length) {
    return { matched: false, nextIdx: startIdx + 1 };
  }
  if (clause.isFunctionWrap && tokens.length === 1 && !clause.hasRedirection) {
    return { matched: false, nextIdx: tokens.length };
  }
  const redirReach = getClauseRedirReach(clause);
  let idx = startIdx;
  let hasEnvPrefix = false;
  let hasWrapperPrefix = false;
  let sawWrapperFlag = false;
  let prefixHasRedir = false;
  let lastWrapperLower = '';

  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (tok.precededByRedir || (!tok.hasUnquotedTrailingPunct && tok.followedByRedir)) {
      prefixHasRedir = true;
    }
    if (idx + 1 < tokens.length && !tok.wasQuoted && SHELL_CONTROL_PREFIX_WORDS.has(tok.value.toLowerCase())) {
      idx += 1;
      continue;
    }
    if (tok.isEnvAssign && idx + 1 < tokens.length) {
      hasEnvPrefix = true;
      idx += 1;
      continue;
    }
    const strippedLower = stripShellBinPrefix(tok.trimmedClean).toLowerCase();
    if (SHELL_WRAPPER_WORD_SET.has(strippedLower) && idx + 1 < tokens.length) {
      const afterTok = tokens[idx + 1];
      const nextLower = stripShellBinPrefix(afterTok.trimmedClean).toLowerCase();
      const hasUpcomingRedir = prefixHasRedir || Boolean(redirReach?.[idx]);
      if (
        !tok.wasQuoted ||
        afterTok.wasQuoted ||
        hasEnvPrefix ||
        hasUpcomingRedir ||
        isCompound ||
        isSubshellOrSubCmd ||
        nextLower.startsWith('-') ||
        SHELL_SPLIT_QUOTE_VERBS.has(nextLower) ||
        SHELL_FLAG_OR_PATH_CLI_VERBS.has(nextLower) ||
        SHELL_COMPOUND_ZERO_ARG_VERBS.has(nextLower)
      ) {
        lastWrapperLower = strippedLower;
        hasWrapperPrefix = true;
        if (SHELL_UNAMBIGUOUS_WRAPPER_SET.has(strippedLower)) {
          sawWrapperFlag = true;
        }
        idx += 1;
        let hasCommandLookupFlag = false;
        const shortValueFlags = SHELL_WRAPPER_SHORT_VALUE_FLAGS.get(strippedLower);
        const longValueFlags = SHELL_WRAPPER_LONG_VALUE_FLAGS.get(strippedLower);
        while (idx < tokens.length) {
          const arg = tokens[idx].value;
          if (arg === '--') {
            sawWrapperFlag = true;
            idx += 1;
            break;
          }
          if (arg.startsWith('--')) {
            sawWrapperFlag = true;
            idx += 1;
            if (!arg.includes('=') && longValueFlags?.has(arg) && idx < tokens.length) {
              idx += 1;
            }
            continue;
          }
          if (arg.startsWith('-') && arg.length > 1 && /[A-Za-z0-9]/.test(arg[1])) {
            const flagChar = arg[1];
            sawWrapperFlag = true;
            if (strippedLower === 'command' && (arg.includes('v') || arg.includes('V'))) {
              hasCommandLookupFlag = true;
            }
            idx += 1;
            if (arg.length === 2 && shortValueFlags?.has(flagChar) && idx < tokens.length) {
              idx += 1;
            }
            continue;
          }
          break;
        }
        if (hasCommandLookupFlag && idx < tokens.length) {
          return { matched: true, nextIdx: idx + 1, headIdx: idx };
        }
        if (strippedLower === 'timeout' && idx < tokens.length && /^\d+(?:\.\d+)?[smhd]?$/i.test(tokens[idx].value)) {
          sawWrapperFlag = true;
          idx += 1;
        }
        continue;
      }
    }
    break;
  }

  if (idx >= tokens.length) {
    if (idx > startIdx && ((lastWrapperLower !== '' && (sawWrapperFlag || prefixHasRedir)) || prefixHasRedir)) {
      return { matched: true, nextIdx: idx, headIdx: idx - 1 };
    }
    return { matched: false, nextIdx: idx };
  }

  const headTok = tokens[idx];
  const cmdRaw = stripShellBinPrefix(headTok.trimmedClean);
  const cmdLower = cmdRaw.toLowerCase();
  const remainingCount = tokens.length - 1 - idx;
  const nextTok = remainingCount > 0 ? tokens[idx + 1] : null;
  const nextVal = nextTok ? nextTok.trimmedClean : '';
  const nextLower = nextVal.toLowerCase();
  const hasRedirection =
    prefixHasRedir || Boolean(headTok.precededByRedir) || Boolean(redirReach?.[idx]);
  const hasStrongShellSyntax = hasEnvPrefix || sawWrapperFlag || hasRedirection;

  if (headTok.isEnvAssign && hasRedirection) {
    return { matched: true, nextIdx: idx + 1, headIdx: idx };
  }

  if (SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(headTok.trimmedClean) || SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(headTok.value)) {
    if (!strictProseMode || remainingCount > 0 || hasEnvPrefix || hasWrapperPrefix || hasRedirection) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
  }

  if (cmdLower === 'go') {
    if (
      (remainingCount >= 1 && (SHELL_GO_SUBCOMMANDS.has(nextLower) || nextVal.startsWith('-'))) ||
      (hasStrongShellSyntax &&
        (remainingCount === 0 ||
          headTok.followedByRedir ||
          headTok.wasQuoted ||
          headTok.raw.includes('\\') ||
          hasEnvPrefix ||
          sawWrapperFlag))
    ) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
  }

  if (SHELL_ZERO_ARG_CLI_VERBS.has(cmdLower)) {
    if (!strictProseMode || hasEnvPrefix || hasWrapperPrefix || hasRedirection || isSubshellOrSubCmd || remainingCount > 0) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
  }

  if (SHELL_COMPOUND_ZERO_ARG_VERBS.has(cmdLower)) {
    if (isCompound || hasEnvPrefix || hasWrapperPrefix || hasRedirection || isSubshellOrSubCmd) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
  }

  if (SHELL_STRICT_CLI_VERBS.has(cmdLower)) {
    const isQuotedHeadBlockedByProseStopword =
      !hasStrongShellSyntax &&
      nextTok !== null &&
      (headTok.raw.includes('"') || headTok.raw.includes("'") || headTok.raw.includes('\\')) &&
      !nextTok.wasQuoted &&
      SPLIT_QUOTE_PROSE_STOPWORDS.has(nextLower) &&
      !isRecognizedCliSubcommand(cmdLower, nextLower);
    if (isQuotedHeadBlockedByProseStopword) {
      return { matched: false, nextIdx: Math.max(startIdx + 1, idx) };
    }
    if (remainingCount >= 1 || hasStrongShellSyntax || (isSubshellOrSubCmd && hasWrapperPrefix)) {
      if (strictProseMode && cmdLower === 'git' && !hasEnvPrefix && !hasWrapperPrefix && !hasRedirection) {
        const matched = remainingCount >= 1 && (SHELL_GIT_SUBCOMMANDS.has(nextLower) || nextVal.startsWith('-'));
        return { matched, nextIdx: Math.max(startIdx + 1, idx + 1), headIdx: idx };
      }
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
    return { matched: false, nextIdx: Math.max(startIdx + 1, idx + 1) };
  }

  if (cmdLower === 'make') {
    if (remainingCount >= 1 && (/^(?:-[A-Za-z0-9-]+|[./~])/.test(nextVal) || SHELL_MAKE_TARGETS.has(nextLower))) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
    if (hasStrongShellSyntax || isSubshellOrSubCmd) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
    if (isCompound || hasWrapperPrefix) {
      const matched =
        remainingCount === 0 ||
        Boolean(nextTok?.wasQuoted) ||
        SHELL_MAKE_TARGETS.has(nextLower) ||
        !SPLIT_QUOTE_PROSE_STOPWORDS.has(nextLower);
      return { matched, nextIdx: Math.max(startIdx + 1, idx + 1), headIdx: idx };
    }
    return { matched: false, nextIdx: Math.max(startIdx + 1, idx + 1) };
  }

  if (cmdLower === 'cd') {
    if ((remainingCount >= 1 && (/^(?:[-./~]|\.\.)/.test(nextVal) || isCompound || hasWrapperPrefix)) || hasStrongShellSyntax) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
    return { matched: false, nextIdx: Math.max(startIdx + 1, idx + 1) };
  }

  if (SHELL_FLAG_OR_PATH_CLI_VERBS.has(cmdLower)) {
    if (
      (remainingCount >= 1 && /^(?:-[A-Za-z0-9-]+|[./~])/.test(nextVal)) ||
      hasStrongShellSyntax ||
      (remainingCount >= 1 && hasWrapperPrefix)
    ) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
    return { matched: false, nextIdx: Math.max(startIdx + 1, idx + 1) };
  }

  if (SHELL_WRAPPER_WORD_SET.has(cmdLower) && hasStrongShellSyntax) {
    return { matched: true, nextIdx: idx + 1, headIdx: idx };
  }

  if (idx > startIdx && lastWrapperLower !== '' && hasRedirection) {
    return { matched: true, nextIdx: idx + 1, headIdx: idx };
  }

  return { matched: false, nextIdx: Math.max(startIdx + 1, idx) };
}

function clauseLooksLikeShellCommand(clause, isCompound, options = {}) {
  if (clauseLooksLikeShellCommandFrom(clause, 0, isCompound, options).matched) {
    return true;
  }
  return Boolean(clause?.standaloneRedirs && clause.standaloneRedirs.length > 0);
}

const SHELL_KNOWN_LOWER_STARTERS = new Set([
  ...SHELL_SPLIT_QUOTE_VERBS,
  ...SHELL_FLAG_OR_PATH_CLI_VERBS,
  ...SHELL_COMPOUND_ZERO_ARG_VERBS,
  ...SHELL_CONTROL_PREFIX_WORDS,
  'entire',
  'whole',
  'across',
  'repo',
  'repository',
  'codebase',
  'run'
]);

function scanFlatShellClauses(text, options = {}) {
  if (!text) {
    return false;
  }
  const normalized = options.skipQuoteNorm ? text : normalizeInlineEscapedQuotes(text);
  const clauses = parseShellClausesLinear(normalized, {
    allowMarkdownBlockquotes: Boolean(options.allowMarkdownBlockquotes)
  });
  const isCompound = clauses.length > 1;
  for (let c = 0; c < clauses.length; c += 1) {
    if (clauseLooksLikeShellCommand(clauses[c], isCompound, options)) {
      return true;
    }
  }
  return false;
}

let activeReadinessCache = null;

function scanShellCommandText(text, options) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  const allowMarkdownBlockquotes = Boolean(options && options.allowMarkdownBlockquotes);
  const skipCodeFences = Boolean(options && options.skipCodeFences);
  const checkMode = Boolean(options && options.checkMode);
  let hasUnknownOpt = false;
  if (options) {
    for (const k of Object.keys(options)) {
      if (k !== 'allowMarkdownBlockquotes' && k !== 'skipCodeFences' && k !== 'checkMode') {
        hasUnknownOpt = true;
        break;
      }
    }
  }
  const canMemo = activeReadinessCache !== null && !hasUnknownOpt;
  const memoKey = canMemo
    ? `${allowMarkdownBlockquotes ? '1' : '0'}${skipCodeFences ? '1' : '0'}${checkMode ? '1' : '0'}:${text}`
    : '';
  if (canMemo && activeReadinessCache.shellCmd.has(memoKey)) {
    return activeReadinessCache.shellCmd.get(memoKey);
  }
  const res = scanShellCommandTextInner(text, options || {});
  if (canMemo) {
    activeReadinessCache.shellCmd.set(memoKey, res);
  }
  return res;
}

function consumeBlockquotePrefixesAtLineStart(text, pos, n, maxDepth) {
  let cur = pos;
  let col = 0;
  let baseCol = 0;
  let count = 0;
  while (count < maxDepth && cur < n) {
    let q = cur;
    let qCol = col;
    while (q < n) {
      const cc = text.charCodeAt(q);
      if (cc === 32) {
        qCol += 1;
        q += 1;
      } else if (cc === 9) {
        qCol += 4 - (qCol & 3);
        q += 1;
      } else {
        break;
      }
      if (qCol - baseCol > 3) {
        return { count, pos: cur, col, baseCol };
      }
    }
    if (q >= n || text.charCodeAt(q) !== 62) {
      return { count, pos: cur, col, baseCol };
    }
    col = qCol + 1;
    baseCol = col;
    count += 1;
    q += 1;
    if (q < n) {
      const post = text.charCodeAt(q);
      if (post === 32) {
        col += 1;
        baseCol = col;
        q += 1;
      } else if (post === 9) {
        baseCol = col + 1;
        col += 4 - (col & 3);
        q += 1;
      }
    }
    cur = q;
  }
  return { count, pos: cur, col, baseCol };
}

function stripBlockquoteFenceContainer(slice, fenceBqDepth) {
  if (!slice || fenceBqDepth <= 0) {
    return slice;
  }
  const slen = slice.length;
  const parts = [];
  let nextLf = slice.indexOf('\n');
  let nextCr = slice.indexOf('\r');
  let pos = 0;
  while (pos < slen) {
    if (nextLf !== -1 && nextLf < pos) {
      nextLf = slice.indexOf('\n', pos);
    }
    if (nextCr !== -1 && nextCr < pos) {
      nextCr = slice.indexOf('\r', pos);
    }
    let lineContentEnd = slen;
    let nextPos = slen;
    if (nextCr !== -1 && (nextLf === -1 || nextCr < nextLf)) {
      lineContentEnd = nextCr;
      nextPos = nextCr + 1 < slen && slice.charCodeAt(nextCr + 1) === 10 ? nextCr + 2 : nextCr + 1;
    } else if (nextLf !== -1) {
      lineContentEnd = nextLf;
      nextPos = nextLf + 1;
    }
    const stripped = consumeBlockquotePrefixesAtLineStart(slice, pos, lineContentEnd, fenceBqDepth);
    parts.push(slice.slice(stripped.pos, nextPos));
    pos = nextPos;
  }
  return parts.join('');
}

function findMatchingBacktickSpan(text, openPos, n, btState) {
  if (openPos + 1 >= n || text.charCodeAt(openPos + 1) !== 96) {
    if (btState.noSingleBt) {
      return { matched: false, runEnd: openPos + 1 };
    }
    let hit = text.indexOf('`', openPos + 1);
    while (hit !== -1) {
      if (hit + 1 >= n || text.charCodeAt(hit + 1) !== 96) {
        return { matched: true, innerStart: openPos + 1, innerEnd: hit, closeEnd: hit, runEnd: openPos + 1 };
      }
      let skip = hit + 2;
      while (skip < n && text.charCodeAt(skip) === 96) {
        skip += 1;
      }
      hit = text.indexOf('`', skip);
    }
    btState.noSingleBt = true;
    return { matched: false, runEnd: openPos + 1 };
  }

  let runEnd = openPos + 2;
  while (runEnd < n && text.charCodeAt(runEnd) === 96) {
    runEnd += 1;
  }
  const btLen = runEnd - openPos;

  if (!btState.skipCodeFences && btLen >= 3) {
    let p = openPos;
    while (p > 0) {
      const prevCode = text.charCodeAt(p - 1);
      if (prevCode !== 32 && prevCode !== 9 && prevCode !== 62) {
        break;
      }
      p -= 1;
    }
    const atFenceLineStart = p === 0 || text.charCodeAt(p - 1) === 10 || text.charCodeAt(p - 1) === 13;
    let validFencePrefix = false;
    let fenceBqDepth = 0;
    if (atFenceLineStart) {
      let q = p;
      let col = 0;
      let baseCol = 0;
      validFencePrefix = true;
      while (q < openPos) {
        const qc = text.charCodeAt(q);
        if (qc === 32) {
          col += 1;
          q += 1;
        } else if (qc === 9) {
          col += 4 - (col & 3);
          q += 1;
        } else if (qc === 62) {
          if (col - baseCol > 3) {
            validFencePrefix = false;
            break;
          }
          col += 1;
          baseCol = col;
          fenceBqDepth += 1;
          q += 1;
          if (q < openPos) {
            const post = text.charCodeAt(q);
            if (post === 32) {
              col += 1;
              baseCol = col;
              q += 1;
            } else if (post === 9) {
              baseCol = col + 1;
              col += 4 - (col & 3);
              q += 1;
            }
          }
        } else {
          validFencePrefix = false;
          break;
        }
        if (col - baseCol > 3) {
          validFencePrefix = false;
          break;
        }
      }
    }
    if (validFencePrefix) {
      let openLineEnd = runEnd;
      let hasBtOnInfoLine = false;
      while (openLineEnd < n) {
        const cc = text.charCodeAt(openLineEnd);
        if (cc === 10 || cc === 13) {
          break;
        }
        if (cc === 96) {
          hasBtOnInfoLine = true;
          break;
        }
        openLineEnd += 1;
      }
      if (!hasBtOnInfoLine && openLineEnd < n) {
        const fenceInfo = text.slice(runEnd, openLineEnd).trim();
        let prevLineEnd = openLineEnd;
        let pos = openLineEnd;
        if (text.charCodeAt(pos) === 13) pos += 1;
        if (pos < n && text.charCodeAt(pos) === 10) pos += 1;
        const bodyStart = pos;
        while (pos < n) {
          let contentPos = pos;
          let lineCol = 0;
          let lineBaseCol = 0;
          if (fenceBqDepth > 0) {
            const bqRes = consumeBlockquotePrefixesAtLineStart(text, pos, n, fenceBqDepth);
            if (bqRes.count < fenceBqDepth) {
              const closeAt = Math.max(runEnd - 1, prevLineEnd - 1);
              return {
                matched: true,
                isFence: true,
                fenceInfo,
                innerStart: Math.min(bodyStart, prevLineEnd),
                innerEnd: prevLineEnd,
                closeEnd: closeAt,
                runEnd,
                fenceBqDepth
              };
            }
            contentPos = bqRes.pos;
            lineCol = bqRes.col;
            lineBaseCol = bqRes.baseCol;
          }
          let cCols = lineCol;
          let cp = contentPos;
          while (cp < n && (cCols - lineBaseCol) <= 3 && isSpaceOrTabCode(text.charCodeAt(cp))) {
            cCols += text.charCodeAt(cp) === 9 ? 4 - (cCols & 3) : 1;
            cp += 1;
          }
          if ((cCols - lineBaseCol) <= 3 && cp < n && text.charCodeAt(cp) === 96) {
            let ce = cp;
            while (ce < n && text.charCodeAt(ce) === 96) {
              ce += 1;
            }
            if (ce - cp >= btLen) {
              let tail = ce;
              while (tail < n && isSpaceOrTabCode(text.charCodeAt(tail))) {
                tail += 1;
              }
              if (tail >= n || text.charCodeAt(tail) === 10 || text.charCodeAt(tail) === 13) {
                return {
                  matched: true,
                  isFence: true,
                  fenceInfo,
                  innerStart: Math.min(bodyStart, prevLineEnd),
                  innerEnd: prevLineEnd,
                  closeEnd: ce - 1,
                  runEnd,
                  fenceBqDepth
                };
              }
            }
          }
          while (pos < n && text.charCodeAt(pos) !== 10 && text.charCodeAt(pos) !== 13) {
            pos += 1;
          }
          prevLineEnd = pos;
          if (pos < n && text.charCodeAt(pos) === 13) pos += 1;
          if (pos < n && text.charCodeAt(pos) === 10) pos += 1;
        }
        return {
          matched: true,
          isFence: true,
          fenceInfo,
          innerStart: Math.min(bodyStart, n),
          innerEnd: n,
          closeEnd: n - 1,
          runEnd,
          fenceBqDepth
        };
      }
    }
  }

  if (btState.multiRuns === null) {
    const multiRuns = new Map();
    let scan = text.indexOf('`');
    while (scan !== -1) {
      let sEnd = scan + 1;
      while (sEnd < n && text.charCodeAt(sEnd) === 96) {
        sEnd += 1;
      }
      const len = sEnd - scan;
      if (len >= 2) {
        let entry = multiRuns.get(len);
        if (!entry) {
          entry = { runs: [], ptr: 0 };
          multiRuns.set(len, entry);
        }
        entry.runs.push(scan);
      }
      scan = text.indexOf('`', sEnd);
    }
    btState.multiRuns = multiRuns;
  }

  const entry = btState.multiRuns.get(btLen);
  if (entry) {
    while (entry.ptr < entry.runs.length && entry.runs[entry.ptr] < runEnd) {
      entry.ptr += 1;
    }
    if (entry.ptr < entry.runs.length) {
      const closeStart = entry.runs[entry.ptr];
      entry.ptr += 1;
      return { matched: true, innerStart: runEnd, innerEnd: closeStart, closeEnd: closeStart + btLen - 1, runEnd };
    }
  }
  return { matched: false, runEnd };
}

function scanShellCommandTextInner(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  if (!options.skipCodeFences && (text.indexOf('```') !== -1 || text.indexOf('~~~') !== -1)) {
    const fenced = extractAndMaskMarkdownCodeFences(text, {
      checkMode: Boolean(options.checkMode),
      stopOnFirst: true
    });
    if (fenced.fenceDeps.length > 0) {
      return true;
    }
    text = fenced.maskedText;
  }
  if (REPO_WIDE_OR_RUN_PHRASE_REGEX.test(text)) {
    return true;
  }
  if (text.includes('`')) {
    const btNorm = normalizeInlineEscapedQuotes(text).replace(/\\`/g, '`');
    const bn = btNorm.length;
    let noMoreSq = false;
    const btState = { noSingleBt: false, multiRuns: null, skipCodeFences: true };
    let btInnerCache = null;
    let outerHasVerbChecked = false;
    let outerSubCmdCtx = false;
    for (let i = 0; i < bn; i += 1) {
      const ch = btNorm[i];
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === "'" && !noMoreSq) {
        const isApos = i > 0 && /[A-Za-z0-9]/.test(btNorm[i - 1]) && i + 1 < bn && /[A-Za-z0-9]/.test(btNorm[i + 1]);
        if (!isApos) {
          const nextSq = btNorm.indexOf("'", i + 1);
          if (nextSq === -1) {
            noMoreSq = true;
          } else {
            i = nextSq;
          }
        }
        continue;
      }
      if (ch === '`') {
        const btMatch = findMatchingBacktickSpan(btNorm, i, bn, btState);
        if (!btMatch.matched) {
          i = btMatch.runEnd - 1;
          continue;
        }
        if (btMatch.isFence && isExplicitShellFenceInfo(btMatch.fenceInfo)) {
          return true;
        }
        const btInner = btNorm.slice(btMatch.innerStart, btMatch.innerEnd).trim();
        if (btInner) {
          if (!outerHasVerbChecked) {
            outerHasVerbChecked = true;
            const prefix = btNorm.slice(0, i).trim();
            if (prefix) {
              const pClauses = parseShellClausesLinear(
                prefix,
                options.allowMarkdownBlockquotes ? { allowMarkdownBlockquotes: true } : undefined
              );
              const lastP = pClauses[pClauses.length - 1];
              const leadP = lastP?.tokens?.[0];
              if (leadP) {
                const lp = stripShellBinPrefix(leadP.trimmedClean).toLowerCase();
                outerSubCmdCtx =
                  leadP.isEnvAssign ||
                  lastP.hasRedirection ||
                  SHELL_SPLIT_QUOTE_VERBS.has(lp) ||
                  SHELL_FLAG_OR_PATH_CLI_VERBS.has(lp) ||
                  SHELL_COMPOUND_ZERO_ARG_VERBS.has(lp);
              }
            }
          }
          let btMatched = btInnerCache ? btInnerCache.get(btInner) : undefined;
          if (btMatched === undefined) {
            btMatched = scanFlatShellClauses(btInner, {
              isSubshellOrSubCmd: outerSubCmdCtx,
              strictProseMode: false,
              skipQuoteNorm: true
            });
            if (!btInnerCache) {
              btInnerCache = new Map();
            }
            btInnerCache.set(btInner, btMatched);
          }
          if (btMatched) {
            return true;
          }
        }
        i = btMatch.closeEnd;
      }
    }
  }
  if (text.includes('$(')) {
    const normalized = normalizeInlineEscapedQuotes(text);
    const { closedFrames, topLevelClosed } = findClosedCommandSubstitutions(normalized);
    for (let f = 0; f < closedFrames.length; f += 1) {
      const frame = closedFrames[f];
      const ownStart = frame.start + (frame.arith ? 3 : 2);
      const ownEnd = frame.end - 1;
      if (isFrameOwnBenignFast(normalized, ownStart, ownEnd, frame.children)) {
        continue;
      }
      const ownText = buildFrameOwnText(normalized, ownStart, ownEnd, frame.children).trim();
      if (ownText && scanFlatShellClauses(ownText, { isSubshellOrSubCmd: true, strictProseMode: false, skipQuoteNorm: true })) {
        return true;
      }
    }
    if (topLevelClosed.length > 0) {
      const strippedTop = buildFrameOwnText(normalized, 0, normalized.length, topLevelClosed);
      return scanFlatShellClauses(strippedTop, { ...options, skipQuoteNorm: true });
    }
  }
  return scanFlatShellClauses(text, options);
}

function scanDelimitedShellSpans(
  rawText,
  {
    includeBackticks = false,
    includeBareScript = false,
    stopOnFirst = true,
    skipCodeFences = true,
    allowMarkdownBlockquotes = true,
    needRemainder = true,
    checkMode = false
  } = {}
) {
  const n = rawText.length;
  if (
    rawText.indexOf('"') === -1 &&
    rawText.indexOf("'") === -1 &&
    (!includeBackticks || rawText.indexOf('`') === -1)
  ) {
    return { matchedDeps: [], remainder: rawText };
  }
  const delimCacheKey =
    needRemainder &&
    activeReadinessCache &&
    rawText &&
    rawText.indexOf('`') === -1 &&
    rawText.indexOf('./') === -1 &&
    rawText.indexOf('../') === -1
      ? `${allowMarkdownBlockquotes ? '1' : '0'}${skipCodeFences ? '1' : '0'}${checkMode ? '1' : '0'}:${rawText}`
      : null;
  if (delimCacheKey !== null && activeReadinessCache.delimSpans.has(delimCacheKey)) {
    return activeReadinessCache.delimSpans.get(delimCacheKey);
  }
  let innerEvalCache = null;
  let maskedParts = null;
  let cursor = 0;
  let noMoreDouble = false;
  let noMoreSingle = false;
  const btState = { noSingleBt: false, multiRuns: null, skipCodeFences: Boolean(skipCodeFences) };
  let nextBsPos = -2;
  let nextBtPos = includeBackticks ? -2 : -1;
  const pad64 = '                                                                ';
  const matchedDeps = [];
  const seenMatched = new Set();
  const pushMatched = (dep) => {
    if (dep && !seenMatched.has(dep)) {
      seenMatched.add(dep);
      matchedDeps.push(dep);
    }
  };
  const evalAndMaskSpan = (
    spanStart,
    innerStart,
    innerEnd,
    closeIdx,
    isBacktick,
    fenceBqDepth = 0,
    isFence = false,
    fenceInfo = ''
  ) => {
    const rawInnerSlice = rawText.slice(innerStart, innerEnd);
    const inner = (fenceBqDepth > 0
      ? stripBlockquoteFenceContainer(rawInnerSlice, fenceBqDepth)
      : rawInnerSlice
    ).trim();
    if (isFence && isExplicitShellFenceInfo(fenceInfo)) {
      let picked = fenceInfo;
      if (inner) {
        const lines = inner.split(/\r\n|\r|\n/);
        let firstNonComment = '';
        let firstNonEmpty = '';
        for (let li = 0; li < lines.length; li += 1) {
          const t = lines[li].trim();
          if (!t) continue;
          if (!firstNonEmpty) firstNonEmpty = t;
          if (!t.startsWith('#')) {
            firstNonComment = t;
            break;
          }
        }
        picked = firstNonComment || firstNonEmpty || fenceInfo;
      }
      pushMatched(picked);
      if (stopOnFirst) return true;
    } else if (inner) {
      if (isBacktick && !includeBackticks) {
        pushMatched(inner);
        if (stopOnFirst) return true;
      } else {
        const innerEvalKey = `${isBacktick ? '1:' : '0:'}${isFence ? 'F:' : ''}${checkMode ? 'C:' : ''}${inner}`;
        let didMatchInner = innerEvalCache ? innerEvalCache.get(innerEvalKey) : undefined;
        if (didMatchInner === undefined) {
          const isSafeEndpoint =
            includeBackticks &&
            typeof isSingleExternalEndpointToken === 'function' &&
            isSingleExternalEndpointToken(inner);
          if (isSafeEndpoint) {
            didMatchInner = false;
          } else {
            const startsDot = inner.charCodeAt(0) === 46;
            const matchesScript = includeBareScript && startsDot && SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(inner);
            let innerMatchesCmd = false;
            if (!matchesScript) {
              if (!/[\s;|&<>()$`\\"']/.test(inner)) {
                const simpleWord = toAsciiLowerFast(stripShellBinPrefix(stripTrailingProsePunct(inner) || inner));
                innerMatchesCmd =
                  SHELL_ZERO_ARG_CLI_VERBS.has(simpleWord) ||
                  (checkMode && isBacktick && (simpleWord === 'pwd' || simpleWord === 'pytest')) ||
                  (startsDot && SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(inner));
              } else {
                innerMatchesCmd =
                  (checkMode &&
                    isBacktick &&
                    (/(?:^|[\r\n])[ \t]*(?:pwd|pytest)[ \t]*(?:$|[\r\n])/.test(inner) ||
                      /(?:^|[\r\n])[ \t]*[A-Za-z0-9_./][A-Za-z0-9_./-]*[ \t]+(?:--[A-Za-z0-9]|-[A-Za-z])/.test(
                        inner
                      ))) ||
                  scanShellCommandText(
                    inner,
                    isBacktick
                      ? { skipCodeFences: Boolean(skipCodeFences) }
                      : {
                          allowMarkdownBlockquotes: Boolean(allowMarkdownBlockquotes),
                          skipCodeFences: Boolean(skipCodeFences)
                        }
                  );
              }
            }
            didMatchInner = Boolean(matchesScript || innerMatchesCmd);
          }
          if (!innerEvalCache) {
            innerEvalCache = new Map();
          }
          innerEvalCache.set(innerEvalKey, didMatchInner);
        }
        if (didMatchInner) {
          pushMatched(inner);
          if (stopOnFirst) return true;
        }
      }
    }

    if (needRemainder) {
      if (!maskedParts) maskedParts = [];
      if (spanStart > cursor) maskedParts.push(rawText.slice(cursor, spanStart));
      if (isFence || rawInnerSlice.indexOf('\n') !== -1 || rawInnerSlice.indexOf('\r') !== -1) {
        appendMaskedPreserveNewlines(maskedParts, rawText, spanStart, closeIdx + 1);
      } else {
        const spanLen = closeIdx - spanStart + 1;
        maskedParts.push(spanLen <= 64 ? pad64.slice(0, spanLen) : ' '.repeat(spanLen));
      }
      cursor = closeIdx + 1;
    }
    return false;
  };
  const scanEmbeddedBackticksBefore = (fromPos, endQuote) => {
    if (!includeBackticks) {
      return -1;
    }
    if (nextBtPos !== -1 && nextBtPos <= fromPos) {
      nextBtPos = rawText.indexOf('`', fromPos + 1);
    }
    let scan = nextBtPos;
    while (scan !== -1 && scan < endQuote) {
      let bs = 0;
      while (scan - 1 - bs >= 0 && rawText.charCodeAt(scan - 1 - bs) === 92) {
        bs += 1;
      }
      if ((bs & 1) === 1) {
        scan = rawText.indexOf('`', scan + 1);
        continue;
      }
      const btMatch = findMatchingBacktickSpan(rawText, scan, n, btState);
      if (!btMatch.matched) {
        scan = rawText.indexOf('`', btMatch.runEnd);
        continue;
      }
      if (
        evalAndMaskSpan(
          scan,
          btMatch.innerStart,
          btMatch.innerEnd,
          btMatch.closeEnd,
          true,
          btMatch.fenceBqDepth || 0,
          Boolean(btMatch.isFence),
          btMatch.fenceInfo || ''
        )
      ) {
        return -2;
      }
      if (btMatch.closeEnd >= endQuote) {
        return btMatch.closeEnd;
      }
      scan = rawText.indexOf('`', btMatch.closeEnd + 1);
    }
    nextBtPos = scan;
    return -1;
  };

  for (let i = 0; i < n; i += 1) {
    const cc = rawText.charCodeAt(i);
    if (cc !== 34 && cc !== 39 && (!includeBackticks || cc !== 96)) {
      continue;
    }
    if (cc === 96) {
      let bs = 0;
      while (i - 1 - bs >= 0 && rawText.charCodeAt(i - 1 - bs) === 92) {
        bs += 1;
      }
      if ((bs & 1) === 1) {
        continue;
      }
      const btMatch = findMatchingBacktickSpan(rawText, i, n, btState);
      if (!btMatch.matched) {
        i = btMatch.runEnd - 1;
        continue;
      }
      if (
        evalAndMaskSpan(
          i,
          btMatch.innerStart,
          btMatch.innerEnd,
          btMatch.closeEnd,
          true,
          btMatch.fenceBqDepth || 0,
          Boolean(btMatch.isFence),
          btMatch.fenceInfo || ''
        )
      ) {
        return { matchedDeps, remainder: rawText };
      }
      i = btMatch.closeEnd;
      continue;
    }

    const ch = cc === 34 ? '"' : "'";
    if (i > 0 && isDelimitedQuotePrefixCode(rawText.charCodeAt(i - 1))) {
      const prevCc = rawText.charCodeAt(i - 1);
      if (ch === "'") {
        const isApostrophe =
          isAsciiAlphaNumCode(prevCc) &&
          ((i + 1 < n && isAsciiAlphaNumCode(rawText.charCodeAt(i + 1))) ||
            ((i + 1 >= n || isTrailingApostropheBoundaryAt(rawText, i + 1)) &&
              hasSingleQuoteCloseBeforeSpace(rawText, i, n) === -1));
        if (isApostrophe) {
          continue;
        }
        if (!noMoreSingle) {
          const endSq = findNextNonApostropheSingleQuote(rawText, i + 1, n);
          if (endSq === -1) {
            noMoreSingle = true;
          } else {
            const embRes = scanEmbeddedBackticksBefore(i, endSq);
            if (embRes === -2) {
              return { matchedDeps, remainder: rawText };
            }
            i = embRes >= 0 ? embRes : endSq;
          }
        }
        continue;
      }
      if (!noMoreDouble) {
        const nextDq = rawText.indexOf('"', i + 1);
        if (nextDq === -1) {
          noMoreDouble = true;
        } else {
          if (nextBsPos !== -1 && nextBsPos <= i) {
            nextBsPos = rawText.indexOf('\\', i + 1);
          }
          let endDq = -1;
          if (nextBsPos === -1 || nextBsPos > nextDq) {
            endDq = nextDq;
          } else {
            for (let k = nextBsPos; k < n; k += 1) {
              if (rawText[k] === '\\') {
                k += 1;
                continue;
              }
              if (rawText[k] === '"') {
                endDq = k;
                break;
              }
            }
          }
          if (endDq === -1) {
            noMoreDouble = true;
          } else {
            const embRes = scanEmbeddedBackticksBefore(i, endDq);
            if (embRes === -2) {
              return { matchedDeps, remainder: rawText };
            }
            i = embRes >= 0 ? embRes : endDq;
          }
        }
      }
      continue;
    }
    if ((ch === '"' && noMoreDouble) || (ch === "'" && noMoreSingle)) {
      continue;
    }

    let closeIdx = -1;
    const innerStart = i + 1;
    let innerEnd = -1;
    if (ch === '"') {
      const nextDq = rawText.indexOf('"', i + 1);
      if (nextDq === -1) {
        noMoreDouble = true;
        continue;
      }
      if (nextBsPos !== -1 && nextBsPos <= i) {
        nextBsPos = rawText.indexOf('\\', i + 1);
      }
      const nextBs = nextBsPos;
      if (nextBs === -1 || nextBs > nextDq) {
        closeIdx = nextDq;
      } else {
        for (let k = nextBs; k < n; k += 1) {
          if (rawText[k] === '\\') {
            k += 1;
            continue;
          }
          if (rawText[k] === '"') {
            closeIdx = k;
            break;
          }
        }
        if (closeIdx === -1) {
          noMoreDouble = true;
          continue;
        }
      }
      innerEnd = closeIdx;
    } else {
      closeIdx = findNextNonApostropheSingleQuote(rawText, i + 1, n);
      if (closeIdx === -1) {
        noMoreSingle = true;
        continue;
      }
      innerEnd = closeIdx;
    }

    if (evalAndMaskSpan(i, innerStart, innerEnd, closeIdx, false)) {
      return { matchedDeps, remainder: rawText };
    }
    i = closeIdx;
  }

  let finalResult;
  if (!needRemainder || cursor === 0) {
    finalResult = { matchedDeps, remainder: rawText };
  } else {
    if (cursor < n) {
      maskedParts.push(rawText.slice(cursor));
    }
    finalResult = { matchedDeps, remainder: maskedParts.join('') };
  }
  if (delimCacheKey !== null && (!stopOnFirst || matchedDeps.length === 0)) {
    activeReadinessCache.delimSpans.set(delimCacheKey, finalResult);
  }
  return finalResult;
}

function appendMaskedPreserveNewlines(outParts, text, start, end) {
  if (start >= end) {
    return;
  }
  let segStart = start;
  const firstCr = text.indexOf('\r', start);
  if (firstCr === -1 || firstCr >= end) {
    while (segStart < end) {
      const nl = text.indexOf('\n', segStart);
      if (nl === -1 || nl >= end) {
        const len = end - segStart;
        if (len > 0) {
          outParts.push(' '.repeat(len));
        }
        break;
      }
      const wsLen = nl - segStart;
      if (wsLen > 0) {
        outParts.push(' '.repeat(wsLen));
      }
      outParts.push('\n');
      segStart = nl + 1;
    }
    return;
  }
  let nextLf = text.indexOf('\n', start);
  let nextCr = firstCr;
  while (segStart < end) {
    if (nextLf !== -1 && nextLf < segStart) {
      nextLf = text.indexOf('\n', segStart);
    }
    if (nextCr !== -1 && nextCr < segStart) {
      nextCr = text.indexOf('\r', segStart);
    }
    const hasCrHere = nextCr !== -1 && nextCr < end;
    const hasLfHere = nextLf !== -1 && nextLf < end;
    if (!hasCrHere && !hasLfHere) {
      const len = end - segStart;
      if (len > 0) {
        outParts.push(' '.repeat(len));
      }
      break;
    }
    if (hasCrHere && (!hasLfHere || nextCr < nextLf)) {
      const wsLen = nextCr - segStart;
      if (wsLen > 0) {
        outParts.push(' '.repeat(wsLen));
      }
      if (nextCr + 1 < end && text.charCodeAt(nextCr + 1) === 10) {
        outParts.push('\r\n');
        segStart = nextCr + 2;
      } else {
        outParts.push('\r');
        segStart = nextCr + 1;
      }
    } else {
      const wsLen = nextLf - segStart;
      if (wsLen > 0) {
        outParts.push(' '.repeat(wsLen));
      }
      outParts.push('\n');
      segStart = nextLf + 1;
    }
  }
}

function advanceSpacesAndTabsBelow(text, pos, col, colLimit, lineEnd) {
  let p = pos;
  let c = col;
  while (p < lineEnd && c < colLimit) {
    const cc = text.charCodeAt(p);
    if (cc === 32) {
      c += 1;
      p += 1;
    } else if (cc === 9) {
      c += 4 - (c & 3);
      p += 1;
    } else {
      break;
    }
  }
  return { pos: p, col: c };
}

function advanceSpacesAndTabsWithin3(text, pos, col, baseCol, lineEnd) {
  let p = pos;
  let c = col;
  while (p < lineEnd && (c - baseCol) <= 3) {
    const cc = text.charCodeAt(p);
    if (cc === 32) {
      c += 1;
      p += 1;
    } else if (cc === 9) {
      c += 4 - (c & 3);
      p += 1;
    } else {
      break;
    }
  }
  return { pos: p, col: c };
}

function consumeSingleBlockquoteAtLine(text, pos, col, baseCol, lineEnd) {
  const sp = advanceSpacesAndTabsWithin3(text, pos, col, baseCol, lineEnd);
  if ((sp.col - baseCol) > 3 || sp.pos >= lineEnd || text.charCodeAt(sp.pos) !== 62) {
    return null;
  }
  let q = sp.pos + 1;
  let nextCol = sp.col + 1;
  let nextBase = nextCol;
  if (q < lineEnd) {
    const post = text.charCodeAt(q);
    if (post === 32) {
      nextCol += 1;
      nextBase = nextCol;
      q += 1;
    } else if (post === 9) {
      nextBase = nextCol + 1;
      nextCol += 4 - (nextCol & 3);
      q += 1;
    }
  }
  return { pos: q, col: nextCol, baseCol: nextBase };
}

function isBlankSliceTo(text, pos, lineEnd) {
  let p = pos;
  while (p < lineEnd && isSpaceOrTabCode(text.charCodeAt(p))) {
    p += 1;
  }
  return p === lineEnd;
}

function isCommonMarkThematicBreakAt(text, pos, lineEnd) {
  if (pos >= lineEnd) {
    return false;
  }
  const marker = text.charCodeAt(pos);
  if (marker !== 45 && marker !== 42 && marker !== 95) {
    return false;
  }
  let count = 0;
  for (let p = pos; p < lineEnd; p += 1) {
    const cc = text.charCodeAt(p);
    if (cc === marker) {
      count += 1;
    } else if (!isSpaceOrTabCode(cc)) {
      return false;
    }
  }
  return count >= 3;
}

function matchCommonMarkListMarkerAt(text, pos, lineEnd) {
  if (pos >= lineEnd) {
    return -1;
  }
  const cc = text.charCodeAt(pos);
  if (cc === 45 || cc === 43 || cc === 42) {
    if ((cc === 45 || cc === 42) && isCommonMarkThematicBreakAt(text, pos, lineEnd)) {
      return -1;
    }
    const mEnd = pos + 1;
    return mEnd === lineEnd || isSpaceOrTabCode(text.charCodeAt(mEnd)) ? mEnd : -1;
  }
  if (cc >= 48 && cc <= 57) {
    let dEnd = pos + 1;
    while (dEnd < lineEnd && dEnd - pos < 9) {
      const dc = text.charCodeAt(dEnd);
      if (dc >= 48 && dc <= 57) {
        dEnd += 1;
      } else {
        break;
      }
    }
    if (dEnd < lineEnd && (text.charCodeAt(dEnd) === 46 || text.charCodeAt(dEnd) === 41)) {
      const mEnd = dEnd + 1;
      return mEnd === lineEnd || isSpaceOrTabCode(text.charCodeAt(mEnd)) ? mEnd : -1;
    }
  }
  return -1;
}

function isAtxHeadingAt(text, pos, lineEnd) {
  if (pos >= lineEnd || text.charCodeAt(pos) !== 35) {
    return false;
  }
  let hEnd = pos + 1;
  while (hEnd < lineEnd && hEnd - pos < 6 && text.charCodeAt(hEnd) === 35) {
    hEnd += 1;
  }
  return hEnd === lineEnd || isSpaceOrTabCode(text.charCodeAt(hEnd));
}

function startsParagraphInterruptBlockAt(text, pos, col, baseCol, lineEnd) {
  const sp = advanceSpacesAndTabsWithin3(text, pos, col, baseCol, lineEnd);
  if ((sp.col - baseCol) > 3 || sp.pos >= lineEnd) {
    return false;
  }
  const p = sp.pos;
  const cc = text.charCodeAt(p);
  if (cc === 62 || isCommonMarkThematicBreakAt(text, p, lineEnd) || isAtxHeadingAt(text, p, lineEnd)) {
    return true;
  }
  if (cc === 96 || cc === 126) {
    let fEnd = p + 1;
    while (fEnd < lineEnd && text.charCodeAt(fEnd) === cc) {
      fEnd += 1;
    }
    if (fEnd - p >= 3) {
      if (cc === 96) {
        for (let q = fEnd; q < lineEnd; q += 1) {
          if (text.charCodeAt(q) === 96) {
            return false;
          }
        }
      }
      return true;
    }
  }
  const mEnd = matchCommonMarkListMarkerAt(text, p, lineEnd);
  if (mEnd !== -1 && !isBlankSliceTo(text, mEnd, lineEnd)) {
    if (cc >= 48 && cc <= 57) {
      return mEnd - p === 2 && cc === 49;
    }
    return true;
  }
  return false;
}

function extractAndMaskMarkdownCodeFences(rawText, { checkMode = false, stopOnFirst = false } = {}) {
  if (!rawText || typeof rawText !== 'string') {
    return { fenceDeps: [], maskedText: rawText || '' };
  }
  if (rawText.indexOf('```') === -1 && rawText.indexOf('~~~') === -1) {
    return { fenceDeps: [], maskedText: rawText };
  }

  const n = rawText.length;
  const fenceDeps = [];
  const seenFence = new Set();
  const pushFenceDep = (dep) => {
    const clean = typeof dep === 'string' ? dep.trim() : '';
    if (clean && !seenFence.has(clean)) {
      seenFence.add(clean);
      fenceDeps.push(clean);
    }
  };

  const hasCr = rawText.indexOf('\r') !== -1;
  let cachedLf = rawText.indexOf('\n');
  let cachedCr = hasCr ? rawText.indexOf('\r') : -1;
  const nextCommonMarkLine = (start) => {
    if (!hasCr) {
      const nl = rawText.indexOf('\n', start);
      return {
        lineEnd: nl === -1 ? n : nl,
        nextLineStart: nl === -1 ? n : nl + 1
      };
    }
    if (cachedLf !== -1 && cachedLf < start) {
      cachedLf = rawText.indexOf('\n', start);
    }
    if (cachedCr !== -1 && cachedCr < start) {
      cachedCr = rawText.indexOf('\r', start);
    }
    if (cachedCr !== -1 && (cachedLf === -1 || cachedCr < cachedLf)) {
      const nextAfterCr = cachedCr + 1 < n && rawText.charCodeAt(cachedCr + 1) === 10 ? cachedCr + 2 : cachedCr + 1;
      return {
        lineEnd: cachedCr,
        nextLineStart: nextAfterCr
      };
    }
    if (cachedLf !== -1) {
      return {
        lineEnd: cachedLf,
        nextLineStart: cachedLf + 1
      };
    }
    return { lineEnd: n, nextLineStart: n };
  };

  let maskedParts = null;
  let maskCursor = 0;
  let lineStart = 0;
  let openContainers = [];
  let paragraphOpen = false;

  while (lineStart < n) {
    const { lineEnd, nextLineStart } = nextCommonMarkLine(lineStart);

    // Step A: match currently open CommonMark §5.1 blockquote & §5.2 list containers
    let p = lineStart;
    let col = 0;
    let baseCol = 0;
    let matchedLen = 0;
    let allMatched = true;
    let handledBlankLine = false;

    for (let idx = 0; idx < openContainers.length; idx += 1) {
      const container = openContainers[idx];
      if (container.type === 'bq') {
        const bqStep = consumeSingleBlockquoteAtLine(rawText, p, col, baseCol, lineEnd);
        if (!bqStep) {
          allMatched = false;
          break;
        }
        p = bqStep.pos;
        col = bqStep.col;
        baseCol = bqStep.baseCol;
        matchedLen = idx + 1;
      } else {
        if (isBlankSliceTo(rawText, p, lineEnd)) {
          let keepLen = openContainers.length;
          for (let k = idx; k < openContainers.length; k += 1) {
            if (openContainers[k].type === 'bq' || openContainers[k].justOpenedEmpty) {
              keepLen = k;
              break;
            }
          }
          openContainers.length = keepLen;
          paragraphOpen = false;
          lineStart = nextLineStart;
          handledBlankLine = true;
          break;
        }
        const ind = advanceSpacesAndTabsBelow(rawText, p, col, baseCol + container.indentCols, lineEnd);
        if ((ind.col - baseCol) < container.indentCols) {
          allMatched = false;
          break;
        }
        p = ind.pos;
        col = ind.col;
        baseCol += container.indentCols;
        container.justOpenedEmpty = false;
        matchedLen = idx + 1;
      }
    }
    if (handledBlankLine) {
      continue;
    }

    // Step B: blank line remainder or container drop-out (with lazy paragraph continuation check)
    if (isBlankSliceTo(rawText, p, lineEnd)) {
      if (!allMatched) {
        openContainers.length = matchedLen;
      } else {
        for (let idx = 0; idx < openContainers.length; idx += 1) {
          if (openContainers[idx].type === 'list' && openContainers[idx].justOpenedEmpty) {
            openContainers.length = idx;
            break;
          }
        }
      }
      paragraphOpen = false;
      lineStart = nextLineStart;
      continue;
    }

    if (!allMatched) {
      if (paragraphOpen && !startsParagraphInterruptBlockAt(rawText, p, col, baseCol, lineEnd)) {
        for (let idx = 0; idx < openContainers.length; idx += 1) {
          if (openContainers[idx].type === 'list') {
            openContainers[idx].justOpenedEmpty = false;
          }
        }
        paragraphOpen = true;
        lineStart = nextLineStart;
        continue;
      }
      openContainers.length = matchedLen;
      paragraphOpen = false;
    }

    // Step C: consume zero or more newly opened nested blockquote / list containers on this line
    let openedEmptyOnThisLine = false;
    while (p < lineEnd) {
      const sp = advanceSpacesAndTabsWithin3(rawText, p, col, baseCol, lineEnd);
      if ((sp.col - baseCol) > 3 || sp.pos >= lineEnd) {
        break;
      }
      const mc = rawText.charCodeAt(sp.pos);
      if (mc === 62) {
        const bqStep = consumeSingleBlockquoteAtLine(rawText, sp.pos, sp.col, baseCol, lineEnd);
        p = bqStep.pos;
        col = bqStep.col;
        baseCol = bqStep.baseCol;
        openContainers.push({ type: 'bq' });
        paragraphOpen = false;
        continue;
      }
      const mEnd = matchCommonMarkListMarkerAt(rawText, sp.pos, lineEnd);
      if (mEnd !== -1) {
        const mWidth = mEnd - sp.pos;
        let lp = mEnd;
        let lCol = sp.col + mWidth;
        while (lp < lineEnd) {
          const lcc = rawText.charCodeAt(lp);
          if (lcc === 32) {
            lCol += 1;
            lp += 1;
          } else if (lcc === 9) {
            lCol += 4 - (lCol & 3);
            lp += 1;
          } else {
            break;
          }
        }
        paragraphOpen = false;
        if (lp === lineEnd) {
          const indentCols = (sp.col - baseCol) + mWidth + 1;
          openContainers.push({ type: 'list', indentCols, justOpenedEmpty: true });
          openedEmptyOnThisLine = true;
          baseCol += indentCols;
          p = lp;
          col = Math.max(lCol, baseCol);
          break;
        }
        const spacesAfterMarker = lCol - (sp.col + mWidth);
        if (spacesAfterMarker >= 1 && spacesAfterMarker <= 4) {
          const indentCols = lCol - baseCol;
          openContainers.push({ type: 'list', indentCols, justOpenedEmpty: false });
          baseCol = lCol;
          p = lp;
          col = lCol;
          continue;
        }
        const indentCols = (sp.col - baseCol) + mWidth + 1;
        openContainers.push({ type: 'list', indentCols, justOpenedEmpty: false });
        baseCol += indentCols;
        p = lp;
        col = lCol;
        break;
      }
      break;
    }

    // Step D: check for opening fenced code block inside active containers
    const fSp = advanceSpacesAndTabsWithin3(rawText, p, col, baseCol, lineEnd);
    p = fSp.pos;
    col = fSp.col;
    if (p >= lineEnd) {
      if (!openedEmptyOnThisLine) {
        for (let idx = 0; idx < openContainers.length; idx += 1) {
          if (openContainers[idx].type === 'list' && openContainers[idx].justOpenedEmpty) {
            openContainers.length = idx;
            break;
          }
        }
      }
      paragraphOpen = false;
      lineStart = nextLineStart;
      continue;
    }
    if ((col - baseCol) > 3) {
      lineStart = nextLineStart;
      continue;
    }
    if (isCommonMarkThematicBreakAt(rawText, p, lineEnd) || isAtxHeadingAt(rawText, p, lineEnd)) {
      paragraphOpen = false;
      lineStart = nextLineStart;
      continue;
    }

    const fc = rawText.charCodeAt(p);
    if (fc !== 96 && fc !== 126) {
      paragraphOpen = true;
      lineStart = nextLineStart;
      continue;
    }
    let fEnd = p + 1;
    while (fEnd < lineEnd && rawText.charCodeAt(fEnd) === fc) {
      fEnd += 1;
    }
    const fenceLen = fEnd - p;
    if (fenceLen < 3) {
      paragraphOpen = true;
      lineStart = nextLineStart;
      continue;
    }
    if (fc === 96) {
      let hasBtOnInfo = false;
      for (let q = fEnd; q < lineEnd; q += 1) {
        if (rawText.charCodeAt(q) === 96) {
          hasBtOnInfo = true;
          break;
        }
      }
      if (hasBtOnInfo) {
        paragraphOpen = true;
        lineStart = nextLineStart;
        continue;
      }
    }

    // Step E: scan inside opened fenced code block until closing fence or container drop-out
    paragraphOpen = false;
    const fenceContainers = openContainers.map((c) =>
      c.type === 'bq' ? { type: 'bq' } : { type: 'list', indentCols: c.indentCols, justOpenedEmpty: false }
    );
    const fenceInfo = rawText.slice(fEnd, lineEnd).trim();
    const isShellFence = isExplicitShellFenceInfo(fenceInfo);
    const fenceOpenSummary = rawText.slice(p, lineEnd).trim() || (fc === 96 ? '```' : '~~~');
    const bodyLines = [];
    let fenceCloseMaskEnd = lineEnd;
    let afterFenceLineStart = nextLineStart;
    let scanStart = nextLineStart;

    while (scanStart < n) {
      const { lineEnd: sLineEnd, nextLineStart: sNext } = nextCommonMarkLine(scanStart);

      let contentPos = scanStart;
      let lineCol = 0;
      let lineBaseCol = 0;
      let droppedOut = false;
      let isBlankInListFence = false;

      for (let k = 0; k < fenceContainers.length; k += 1) {
        const fCont = fenceContainers[k];
        if (fCont.type === 'bq') {
          const bqStep = consumeSingleBlockquoteAtLine(rawText, contentPos, lineCol, lineBaseCol, sLineEnd);
          if (!bqStep) {
            droppedOut = true;
            break;
          }
          contentPos = bqStep.pos;
          lineCol = bqStep.col;
          lineBaseCol = bqStep.baseCol;
        } else {
          if (isBlankSliceTo(rawText, contentPos, sLineEnd)) {
            let hasNestedBq = false;
            for (let m = k + 1; m < fenceContainers.length; m += 1) {
              if (fenceContainers[m].type === 'bq') {
                hasNestedBq = true;
                break;
              }
            }
            if (hasNestedBq) {
              droppedOut = true;
            } else {
              isBlankInListFence = true;
            }
            break;
          }
          const ind = advanceSpacesAndTabsBelow(rawText, contentPos, lineCol, lineBaseCol + fCont.indentCols, sLineEnd);
          if ((ind.col - lineBaseCol) < fCont.indentCols) {
            droppedOut = true;
            break;
          }
          contentPos = ind.pos;
          lineCol = ind.col;
          lineBaseCol += fCont.indentCols;
        }
      }

      if (droppedOut) {
        afterFenceLineStart = scanStart;
        break;
      }
      if (isBlankInListFence) {
        bodyLines.push('');
        fenceCloseMaskEnd = sLineEnd;
        afterFenceLineStart = sNext;
        scanStart = sNext;
        continue;
      }

      const cSp = advanceSpacesAndTabsWithin3(rawText, contentPos, lineCol, lineBaseCol, sLineEnd);
      let isCloseFence = false;
      if ((cSp.col - lineBaseCol) <= 3 && cSp.pos < sLineEnd && rawText.charCodeAt(cSp.pos) === fc) {
        let ce = cSp.pos + 1;
        while (ce < sLineEnd && rawText.charCodeAt(ce) === fc) {
          ce += 1;
        }
        if (ce - cSp.pos >= fenceLen && isBlankSliceTo(rawText, ce, sLineEnd)) {
          isCloseFence = true;
        }
      }
      if (isCloseFence) {
        fenceCloseMaskEnd = sLineEnd;
        afterFenceLineStart = sNext;
        openContainers = fenceContainers;
        break;
      }

      bodyLines.push(rawText.slice(contentPos, sLineEnd));
      fenceCloseMaskEnd = sLineEnd;
      afterFenceLineStart = sNext;
      scanStart = sNext;
    }

    if (isShellFence) {
      let firstNonComment = '';
      let firstNonEmpty = '';
      for (let bi = 0; bi < bodyLines.length; bi += 1) {
        const t = bodyLines[bi].trim();
        if (!t) continue;
        if (!firstNonEmpty) firstNonEmpty = t;
        if (!t.startsWith('#')) {
          firstNonComment = t;
          break;
        }
      }
      pushFenceDep(firstNonComment || firstNonEmpty || fenceOpenSummary);
      if (stopOnFirst) {
        return { fenceDeps, maskedText: rawText };
      }
    } else {
      const trimmedBody = bodyLines.join('\n').trim();
      if (trimmedBody && !(typeof isSingleExternalEndpointToken === 'function' && isSingleExternalEndpointToken(trimmedBody))) {
        const bodyMatched =
          SHELL_UNQUOTED_SCRIPT_CMD_REGEX.test(trimmedBody) ||
          scanShellCommandText(trimmedBody, { skipCodeFences: true }) ||
          scanDelimitedShellSpans(trimmedBody, {
            includeBackticks: true,
            includeBareScript: checkMode,
            checkMode: Boolean(checkMode),
            stopOnFirst: true,
            skipCodeFences: true,
            allowMarkdownBlockquotes: false,
            needRemainder: false
          }).matchedDeps.length > 0;
        if (bodyMatched) {
          pushFenceDep(trimmedBody);
          if (stopOnFirst) {
            return { fenceDeps, maskedText: rawText };
          }
        }
      }
    }

    if (!maskedParts) maskedParts = [];
    if (lineStart > maskCursor) {
      maskedParts.push(rawText.slice(maskCursor, lineStart));
    }
    appendMaskedPreserveNewlines(maskedParts, rawText, lineStart, fenceCloseMaskEnd);
    maskCursor = fenceCloseMaskEnd;
    lineStart = afterFenceLineStart;
  }

  if (!maskedParts) {
    return { fenceDeps, maskedText: rawText };
  }
  if (maskCursor < n) {
    maskedParts.push(rawText.slice(maskCursor));
  }
  return { fenceDeps, maskedText: maskedParts.join('') };
}

const PROSE_STRICT_CLI_VERB_SET = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'pytest',
  'cargo',
  'kubectl',
  'netstat',
  'lsof',
  'realpath',
  'readlink',
  'basename',
  'dirname',
  'xargs',
  'awk',
  'sed',
  'wc'
]);
const PROSE_AMBIGUOUS_CLI_VERB_SET = new Set([
  'node',
  'python',
  'python3',
  'bash',
  'sh',
  'zsh',
  'docker',
  'curl',
  'grep',
  'rg',
  'cat'
]);
const PROSE_CLI_SUBCOMMAND_SET = new Set([
  'test',
  'run',
  'exec',
  'check',
  'build',
  'lint',
  'ci',
  'audit',
  'install',
  'diff',
  'status',
  'log',
  'show',
  'rev-parse',
  'publish',
  'pack',
  'init',
  'start',
  'stop',
  'bench',
  'clippy',
  'doc',
  'fmt',
  'clean',
  'update',
  'get',
  'describe',
  'logs',
  'apply',
  'delete'
]);
const DOCKER_SUBCOMMAND_SET = new Set([
  'ps',
  'run',
  'exec',
  'build',
  'compose',
  'images',
  'logs',
  'inspect',
  'pull',
  'push',
  'info',
  'version'
]);

const SUBCOMMAND_STRICT_CLI_VERBS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'cargo', 'kubectl']);

function isRecognizedCliSubcommand(cmdLower, argLower) {
  if (!argLower) {
    return false;
  }
  if (cmdLower === 'go') {
    return SHELL_GO_SUBCOMMANDS.has(argLower);
  }
  if (cmdLower === 'git') {
    return SHELL_GIT_SUBCOMMANDS.has(argLower);
  }
  if (cmdLower === 'make') {
    return SHELL_MAKE_TARGETS.has(argLower);
  }
  if (cmdLower === 'docker') {
    return DOCKER_SUBCOMMAND_SET.has(argLower);
  }
  if (SUBCOMMAND_STRICT_CLI_VERBS.has(cmdLower)) {
    return PROSE_CLI_SUBCOMMAND_SET.has(argLower);
  }
  return false;
}

function isLikelyShellFileArg(val) {
  if (!val || typeof val !== 'string' || /\s/.test(val)) {
    return false;
  }
  const lower = val.toLowerCase();
  if (KNOWN_PATH_EXTENSIONLESS_FILES.has(val) || KNOWN_DOTFILES.has(lower) || lower.startsWith('.env.')) {
    return true;
  }
  if (val.includes('/')) {
    const segs = val.split('/').filter(Boolean);
    return segs.length > 0 && !isNonPathSlashExpression(val, segs);
  }
  if (/^[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,11}$/.test(val)) {
    return classifyFileCandidate(val) === 'file';
  }
  return false;
}

function maskBackticksLinear(text) {
  if (!text || !text.includes('`')) {
    return text;
  }
  const n = text.length;
  let out = '';
  let cursor = 0;
  const btState = { noSingleBt: false, multiRuns: null, skipCodeFences: true };

  for (let i = 0; i < n; i += 1) {
    const c = text[i];
    if (c === '\\' && i + 1 < n) {
      i += 1;
      continue;
    }
    if (c === '`') {
      const btMatch = findMatchingBacktickSpan(text, i, n, btState);
      if (!btMatch.matched) {
        i = btMatch.runEnd - 1;
        continue;
      }
      let padLen = btMatch.closeEnd - i + 1;
      if (padLen < 5) {
        let p = i;
        let wsCount = 0;
        while (p > 0 && wsCount <= 4) {
          const pcc = text.charCodeAt(p - 1);
          if (pcc !== 32 && pcc !== 9) break;
          p -= 1;
          wsCount += 1;
        }
        if (wsCount <= 4) {
          if (p === 0 || text.charCodeAt(p - 1) === 10 || text.charCodeAt(p - 1) === 13) {
            padLen = Math.max(padLen, 4);
          } else if (text.charCodeAt(p - 1) === 62) {
            padLen = Math.max(padLen, 5);
          }
        }
      }
      out += text.slice(cursor, i) + ' '.repeat(padLen);
      cursor = btMatch.closeEnd + 1;
      i = btMatch.closeEnd;
    }
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}

const SHELL_UNAMBIGUOUS_WRAPPER_SET = new Set(['nohup', 'sudo', 'setsid', 'stdbuf', 'builtin']);

function joinRawTokenRange(tokens, start, end) {
  let out = '';
  for (let idx = start; idx < end; idx += 1) {
    if (idx > start) {
      out += ' ';
    }
    out += tokens[idx].raw;
  }
  return out;
}

const SHELL_OUTER_WORD_STARTERS = new Set(
  [...SHELL_KNOWN_LOWER_STARTERS].filter((w) => w !== '!')
);

function hasPotentialOuterCommandStarter(text) {
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const cc = text.charCodeAt(i);
    if (
      cc === 60 ||
      cc === 62 ||
      cc === 61 ||
      cc === 34 ||
      cc === 39 ||
      cc === 92 ||
      cc === 96
    ) {
      return true;
    }
    if (cc === 46 && i + 1 < n) {
      const next = text.charCodeAt(i + 1);
      if (next === 47 || (next === 46 && i + 2 < n && text.charCodeAt(i + 2) === 47)) {
        return true;
      }
    }
    if ((cc >= 97 && cc <= 122) || (cc >= 65 && cc <= 90) || (cc >= 48 && cc <= 57)) {
      let j = i + 1;
      let hasUpper = cc >= 65 && cc <= 90;
      while (j < n) {
        const wc = text.charCodeAt(j);
        if ((wc >= 97 && wc <= 122) || (wc >= 48 && wc <= 57)) {
          j += 1;
        } else if (wc >= 65 && wc <= 90) {
          hasUpper = true;
          j += 1;
        } else {
          break;
        }
      }
      const len = j - i;
      if (len >= 2 && len <= 10) {
        const word = hasUpper ? text.slice(i, j).toLowerCase() : text.slice(i, j);
        if (SHELL_OUTER_WORD_STARTERS.has(word)) {
          return true;
        }
      }
      i = j - 1;
    }
  }
  return false;
}

function scanOuterClausesForCommands(text, { checkMode = false, stopOnFirst = false } = {}) {
  if (!text || typeof text !== 'string' || !hasPotentialOuterCommandStarter(text)) {
    return [];
  }
  const outerCacheKey = activeReadinessCache ? text : null;
  let clauses = outerCacheKey !== null ? activeReadinessCache.outerClauses.get(outerCacheKey) : undefined;
  if (!clauses) {
    const maskedBt = maskBackticksLinear(outerCacheKey ?? text);
    const normQuotes = normalizeInlineEscapedQuotes(maskedBt);
    const unescaped = unescapeInlineShellWords(normQuotes);
    clauses = parseShellClausesLinear(unescaped, { allowMarkdownBlockquotes: true });
    if (outerCacheKey !== null) {
      activeReadinessCache.outerClauses.set(outerCacheKey, clauses);
    }
  }
  const isCompound = clauses.length > 1;
  const found = [];
  const seenFound = stopOnFirst ? null : new Set();

  for (let c = 0; c < clauses.length; c += 1) {
    const clause = clauses[c];
    const tokens = clause.tokens;
    const redirReach = getClauseRedirReach(clause);
    let clauseMatched = false;
    let k = 0;
    while (k < tokens.length) {
      const startTok = tokens[k];
      const startStrippedLower = startTok.strippedLower;
      if (
        !startTok.precededByRedir &&
        !startTok.followedByRedir &&
        !startTok.isEnvAssign &&
        !SHELL_KNOWN_LOWER_STARTERS.has(startStrippedLower) &&
        (startTok.trimmedClean.charCodeAt(0) !== 46 ||
          (!startTok.trimmedClean.startsWith('./') && !startTok.trimmedClean.startsWith('../')))
      ) {
        k += 1;
        continue;
      }

      let idx = k;
      let hasEnvPrefix = false;
      let sawWrapperFlag = false;
      let prefixHasRedir = false;
      let lastWrapperLower = '';

      while (idx < tokens.length) {
        const t = tokens[idx];
        if (t.precededByRedir || (!t.hasUnquotedTrailingPunct && t.followedByRedir)) {
          prefixHasRedir = true;
        }
        if (idx + 1 < tokens.length && !t.wasQuoted && SHELL_CONTROL_PREFIX_WORDS.has(t.value.toLowerCase())) {
          idx += 1;
          continue;
        }
        if (t.isEnvAssign && !t.hasTrailingProsePunct && !t.hasPaddingSpaces && idx + 1 < tokens.length) {
          hasEnvPrefix = true;
          idx += 1;
          continue;
        }
        const strippedLower = t.strippedLower;
        if (
          SHELL_WRAPPER_WORD_SET.has(strippedLower) &&
          !t.hasTrailingProsePunct &&
          !t.hasPaddingSpaces &&
          !/\s/.test(t.trimmedClean) &&
          idx + 1 < tokens.length
        ) {
          const afterTok = tokens[idx + 1];
          const afterLower = afterTok.strippedLower;
          if (
            !t.wasQuoted ||
            afterTok.wasQuoted ||
            prefixHasRedir ||
            Boolean(redirReach?.[idx]) ||
            !SPLIT_QUOTE_PROSE_STOPWORDS.has(afterLower) ||
            SHELL_WRAPPER_WORD_SET.has(afterLower)
          ) {
            lastWrapperLower = strippedLower;
            if (SHELL_UNAMBIGUOUS_WRAPPER_SET.has(strippedLower)) {
              sawWrapperFlag = true;
            }
            idx += 1;
            let hasCommandLookupFlag = false;
            const shortValueFlags = SHELL_WRAPPER_SHORT_VALUE_FLAGS.get(strippedLower);
            const longValueFlags = SHELL_WRAPPER_LONG_VALUE_FLAGS.get(strippedLower);
            while (idx < tokens.length) {
              const argTok = tokens[idx];
              if (argTok.hasPaddingSpaces || /\s/.test(argTok.trimmedClean)) {
                break;
              }
              const arg = argTok.trimmedClean;
              if (arg === '--') {
                sawWrapperFlag = true;
                idx += 1;
                break;
              }
              if (arg.startsWith('--')) {
                sawWrapperFlag = true;
                idx += 1;
                if (!arg.includes('=') && longValueFlags?.has(arg) && idx < tokens.length) {
                  idx += 1;
                }
                continue;
              }
              if (arg.startsWith('-') && arg.length > 1 && /[A-Za-z0-9]/.test(arg[1])) {
                const flagChar = arg[1];
                if (strippedLower === 'command' && (arg.includes('v') || arg.includes('V'))) {
                  hasCommandLookupFlag = true;
                }
                sawWrapperFlag = true;
                idx += 1;
                if (arg.length === 2 && shortValueFlags?.has(flagChar) && idx < tokens.length) {
                  idx += 1;
                }
                continue;
              }
              break;
            }
            if (hasCommandLookupFlag && idx < tokens.length) {
              const targetTok = tokens[idx];
              if (
                Boolean(targetTok.trimmedClean) &&
                !targetTok.hasPaddingSpaces &&
                !/\s/.test(targetTok.trimmedClean)
              ) {
                const snippet = stripTrailingProsePunct(joinRawTokenRange(tokens, k, idx + 1));
                if (snippet) {
                  if (stopOnFirst) return [snippet];
                  clauseMatched = true;
                  if (!seenFound.has(snippet)) {
                    seenFound.add(snippet);
                    found.push(snippet);
                  }
                }
                k = Math.max(k + 1, idx + 1);
                idx = -1;
                break;
              }
            }
            if (
              strippedLower === 'timeout' &&
              idx < tokens.length &&
              !tokens[idx].hasPaddingSpaces &&
              /^\d+(?:\.\d+)?[smhd]?$/i.test(tokens[idx].trimmedClean)
            ) {
              sawWrapperFlag = true;
              idx += 1;
            }
            continue;
          }
        }
        break;
      }

      if (idx === -1) {
        continue;
      }
      if (idx >= tokens.length) {
        if (idx > k && ((lastWrapperLower !== '' && (sawWrapperFlag || prefixHasRedir)) || prefixHasRedir)) {
          const snippet = stripTrailingProsePunct(joinRawTokenRange(tokens, k, tokens.length));
          if (snippet) {
            if (stopOnFirst) return [snippet];
            clauseMatched = true;
            if (!seenFound.has(snippet)) {
              seenFound.add(snippet);
              found.push(snippet);
            }
          }
          k = tokens.length;
          continue;
        }
        k = Math.max(k + 1, idx);
        continue;
      }

      const headTok = tokens[idx];
      const remainingCount = tokens.length - 1 - idx;
      const cmdLower = headTok.strippedLower;
      const nextTok = remainingCount > 0 ? tokens[idx + 1] : null;
      const nextVal = nextTok ? nextTok.trimmedClean : '';
      const nextLower = nextVal.toLowerCase();
      const hasRedirection =
        prefixHasRedir || Boolean(headTok.precededByRedir) || Boolean(redirReach?.[idx]);
      const hasStrongShellPrefix = hasEnvPrefix || sawWrapperFlag || hasRedirection;

      if (headTok.hasPaddingSpaces || /\s/.test(headTok.trimmedClean)) {
        k = Math.max(k + 1, idx + (idx === k ? 1 : 0));
        continue;
      }
      if (headTok.hasTrailingProsePunct && (remainingCount > 0 || !hasStrongShellPrefix)) {
        k = Math.max(k + 1, idx + (idx === k ? 1 : 0));
        continue;
      }

      if ((headTok.wasQuoted || headTok.raw.includes('\\')) && remainingCount < 1 && !hasStrongShellPrefix) {
        k = Math.max(k + 1, idx + (idx === k ? 1 : 0));
        continue;
      }

      const isProseStopwordNext = Boolean(
        nextTok &&
          (headTok.wasQuoted || headTok.raw.includes('\\')) &&
          !nextTok.wasQuoted &&
          SPLIT_QUOTE_PROSE_STOPWORDS.has(nextLower) &&
          !isRecognizedCliSubcommand(cmdLower, nextLower)
      );
      const nextArgOk = Boolean(nextTok && !nextTok.hasPaddingSpaces && !isProseStopwordNext);

      let matched = false;

      if (headTok.isEnvAssign && hasRedirection) {
        matched = true;
      } else if (headTok.trimmedClean.charCodeAt(0) === 46 && SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(headTok.trimmedClean)) {
        matched = checkMode || remainingCount > 0 || hasStrongShellPrefix;
      } else if (cmdLower === 'go') {
        matched =
          (nextArgOk && (SHELL_GO_SUBCOMMANDS.has(nextLower) || /^-[A-Za-z0-9-]/.test(nextVal))) ||
          (hasStrongShellPrefix &&
            (remainingCount === 0 ||
              nextArgOk ||
              headTok.followedByRedir ||
              headTok.wasQuoted ||
              headTok.raw.includes('\\') ||
              hasEnvPrefix ||
              sawWrapperFlag));
      } else if (cmdLower === 'git') {
        matched =
          (nextArgOk && (SHELL_GIT_SUBCOMMANDS.has(nextLower) || /^-[A-Za-z0-9-]/.test(nextVal))) ||
          hasStrongShellPrefix;
      } else if (cmdLower === 'make') {
        matched =
          (nextArgOk && (/^(?:-[A-Za-z0-9-]+|[./~])/.test(nextVal) || SHELL_MAKE_TARGETS.has(nextLower))) ||
          hasStrongShellPrefix;
      } else if (cmdLower === 'cd') {
        matched = (nextArgOk && /^(?:[-./~]|\.\.)/.test(nextVal)) || hasStrongShellPrefix;
      } else if (SHELL_ZERO_ARG_CLI_VERBS.has(cmdLower)) {
        if (hasStrongShellPrefix) {
          matched = true;
        } else if (checkMode && clauses.length === 1 && tokens.length === 1 && !headTok.wasQuoted && !headTok.hasTrailingProsePunct) {
          matched = true;
        } else if (nextArgOk) {
          if (cmdLower === 'ls') {
            matched = /^(?:-[A-Za-z0-9-]+|[./~])/.test(nextVal) || isLikelyShellFileArg(nextVal);
          } else if (cmdLower === 'uname' || cmdLower === 'whoami') {
            matched = /^-[A-Za-z0-9-]+$/.test(nextVal);
          } else if (cmdLower === 'printenv') {
            matched = /^-[A-Za-z0-9-]+$/.test(nextVal) || /^[A-Z_][A-Z0-9_]*$/.test(nextVal);
          }
        }
      } else if (SHELL_COMPOUND_ZERO_ARG_VERBS.has(cmdLower)) {
        matched = hasStrongShellPrefix || (isCompound && tokens.length === 1 && !headTok.wasQuoted && !headTok.hasTrailingProsePunct);
      } else if (PROSE_STRICT_CLI_VERB_SET.has(cmdLower)) {
        matched =
          hasStrongShellPrefix ||
          (nextArgOk &&
            (/^(?:-[A-Za-z0-9-]+|[./~])/.test(nextVal) ||
              PROSE_CLI_SUBCOMMAND_SET.has(nextLower) ||
              isLikelyShellFileArg(nextVal) ||
              ((cmdLower === 'awk' ||
                cmdLower === 'sed' ||
                cmdLower === 'xargs' ||
                cmdLower === 'basename' ||
                cmdLower === 'dirname' ||
                cmdLower === 'realpath' ||
                cmdLower === 'readlink' ||
                cmdLower === 'npx') &&
                !SPLIT_QUOTE_PROSE_STOPWORDS.has(nextLower) &&
                (nextTok.wasQuoted || /^[-/\w.]+$/.test(nextVal))) ||
              (checkMode &&
                !(headTok.hadSkippedComparison && nextTok.isRuntimeVersionPair) &&
                !headTok.wasQuoted &&
                !nextTok.wasQuoted &&
                !SPLIT_QUOTE_PROSE_STOPWORDS.has(nextLower) &&
                /^[-/\w.]+$/.test(nextVal))));
      } else if (PROSE_AMBIGUOUS_CLI_VERB_SET.has(cmdLower)) {
        matched =
          hasStrongShellPrefix ||
          (nextArgOk &&
            (/^(?:-[A-Za-z0-9-]+|[./~]|https?:\/\/)/i.test(nextVal) ||
              isLikelyShellFileArg(nextVal) ||
              (cmdLower === 'docker' && DOCKER_SUBCOMMAND_SET.has(nextLower)) ||
              ((cmdLower === 'grep' || cmdLower === 'rg') &&
                idx + 2 < tokens.length &&
                !tokens[idx + 2].hasPaddingSpaces &&
                (/^(?:-[A-Za-z0-9-]+|[./~])/.test(tokens[idx + 2].trimmedClean) ||
                  isLikelyShellFileArg(tokens[idx + 2].trimmedClean)))));
      } else if (SHELL_FLAG_OR_PATH_CLI_VERBS.has(cmdLower)) {
        matched = hasStrongShellPrefix || (nextArgOk && /^(?:-[A-Za-z0-9-]+|[./~])/.test(nextVal));
      } else if (SHELL_WRAPPER_WORD_SET.has(cmdLower)) {
        matched = hasStrongShellPrefix;
      }
      if (!matched && idx > k && lastWrapperLower !== '' && hasRedirection) {
        matched = true;
      }
      if (!matched && headTok.wasQuoted && !headTok.hasTrailingProsePunct && !headTok.hasUnquotedTrailingPunct) {
        const isShellChain = Boolean(clause.pipedIn || clause.pipedOut || clause.logicalChain);
        if (
          (nextArgOk || hasStrongShellPrefix) &&
          (SHELL_STRICT_CLI_VERBS.has(cmdLower) || SHELL_ZERO_ARG_CLI_VERBS.has(cmdLower))
        ) {
          matched = true;
        } else if (SHELL_COMPOUND_ZERO_ARG_VERBS.has(cmdLower) && remainingCount === 0 && isShellChain) {
          matched = true;
        } else if ((cmdLower === 'cd' || cmdLower === 'make') && nextArgOk && (isShellChain || lastWrapperLower !== '')) {
          matched = true;
        }
      }

      if (matched) {
        const includeNextInSnippet = Boolean(nextArgOk && !headTok.followedByRedir && !nextTok?.precededByRedir);
        const snippetEnd = includeNextInSnippet ? Math.min(tokens.length, idx + 2) : idx + 1;
        const snippet = stripTrailingProsePunct(joinRawTokenRange(tokens, k, snippetEnd));
        if (snippet) {
          if (stopOnFirst) {
            return [snippet];
          }
          clauseMatched = true;
          if (!seenFound.has(snippet)) {
            seenFound.add(snippet);
            found.push(snippet);
          }
        }
        k = Math.max(k + 1, snippetEnd);
        continue;
      }

      k = Math.max(k + 1, idx + (idx === k ? 1 : 0));
    }

    if (!clauseMatched && clause.standaloneRedirs && clause.standaloneRedirs.length > 0) {
      for (let r = 0; r < clause.standaloneRedirs.length; r += 1) {
        const snippet = stripTrailingProsePunct(clause.standaloneRedirs[r]);
        if (snippet) {
          if (stopOnFirst) {
            return [snippet];
          }
          if (!seenFound.has(snippet)) {
            seenFound.add(snippet);
            found.push(snippet);
          }
        }
      }
    }
  }

  return found;
}

function extractProseCommandAndRepoDeps(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return [];
  }
  const deps = [];
  const seenDeps = new Set();
  const addDep = (dep) => {
    const clean = typeof dep === 'string' ? dep.trim() : '';
    if (clean && !seenDeps.has(clean)) {
      seenDeps.add(clean);
      deps.push(clean);
    }
  };

  const { fenceDeps, maskedText } = extractAndMaskMarkdownCodeFences(rawText, {
    checkMode: false,
    stopOnFirst: false
  });
  for (let i = 0; i < fenceDeps.length; i += 1) {
    addDep(fenceDeps[i]);
  }

  let outerText = maskedText;
  if (maskedText.includes('$(')) {
    const normDollar = normalizeInlineEscapedQuotes(maskedText);
    const { closedFrames, topLevelClosed } = findClosedCommandSubstitutions(normDollar);
    for (let f = 0; f < closedFrames.length; f += 1) {
      const frame = closedFrames[f];
      const ownStart = frame.start + (frame.arith ? 3 : 2);
      const ownEnd = frame.end - 1;
      if (isFrameOwnBenignFast(normDollar, ownStart, ownEnd, frame.children)) {
        continue;
      }
      const ownText = buildFrameOwnText(normDollar, ownStart, ownEnd, frame.children).trim();
      if (ownText && scanFlatShellClauses(ownText, { isSubshellOrSubCmd: true, strictProseMode: false, skipQuoteNorm: true })) {
        addDep(normDollar.slice(frame.start, frame.end));
        break;
      }
    }
    if (topLevelClosed.length > 0) {
      outerText = buildFrameOwnText(normDollar, 0, normDollar.length, topLevelClosed);
    }
  }

  const { matchedDeps, remainder } = scanDelimitedShellSpans(maskedText, {
    includeBackticks: true,
    includeBareScript: false,
    stopOnFirst: false
  });
  for (let i = 0; i < matchedDeps.length; i += 1) {
    addDep(matchedDeps[i]);
  }

  const normalizedRemainder = unescapeInlineShellWords(remainder);
  const unquotedMatch = UNQUOTED_PROSE_COMMAND_OR_REPO_REGEX.exec(normalizedRemainder);
  if (unquotedMatch) {
    addDep(unquotedMatch[0]);
  } else {
    const repoPhrase = REPO_WIDE_OR_RUN_PHRASE_REGEX.exec(normalizedRemainder);
    if (repoPhrase) {
      addDep(repoPhrase[0]);
    }
  }

  const outerDeps = scanOuterClausesForCommands(outerText, { checkMode: false, stopOnFirst: false });
  for (let i = 0; i < outerDeps.length; i += 1) {
    addDep(outerDeps[i]);
  }

  return deps;
}

function hasCheckCommandOrRepoDependency(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return false;
  }

  const { fenceDeps, maskedText } = extractAndMaskMarkdownCodeFences(rawText, {
    checkMode: true,
    stopOnFirst: true
  });
  if (fenceDeps.length > 0) {
    return true;
  }

  let outerText = maskedText;
  if (maskedText.includes('$(')) {
    const normDollar = normalizeInlineEscapedQuotes(maskedText);
    const { closedFrames, topLevelClosed } = findClosedCommandSubstitutions(normDollar);
    for (let f = 0; f < closedFrames.length; f += 1) {
      const frame = closedFrames[f];
      const ownStart = frame.start + (frame.arith ? 3 : 2);
      const ownEnd = frame.end - 1;
      if (isFrameOwnBenignFast(normDollar, ownStart, ownEnd, frame.children)) {
        continue;
      }
      const ownText = buildFrameOwnText(normDollar, ownStart, ownEnd, frame.children).trim();
      if (ownText && scanFlatShellClauses(ownText, { isSubshellOrSubCmd: true, strictProseMode: false, skipQuoteNorm: true })) {
        return true;
      }
    }
    if (topLevelClosed.length > 0) {
      outerText = buildFrameOwnText(normDollar, 0, normDollar.length, topLevelClosed);
    }
  }

  const { matchedDeps, remainder } = scanDelimitedShellSpans(maskedText, {
    includeBackticks: true,
    includeBareScript: true,
    stopOnFirst: true,
    checkMode: true
  });
  if (matchedDeps.length > 0) {
    return true;
  }

  const unescapedRemainder = unescapeInlineShellWords(remainder);
  if (unescapedRemainder.includes('$(')) {
    const { topLevelClosed } = findClosedCommandSubstitutions(unescapedRemainder);
    for (let f = 0; f < topLevelClosed.length; f += 1) {
      const frame = topLevelClosed[f];
      if (!frame.arith && unescapedRemainder.slice(frame.start + 2, frame.end - 1).trim().length > 0) {
        return true;
      }
    }
  }

  if (SHELL_UNQUOTED_SCRIPT_CMD_REGEX.test(unescapedRemainder)) {
    return true;
  }
  if (UNQUOTED_CHECK_COMMAND_OR_REPO_REGEX.test(unescapedRemainder)) {
    return true;
  }
  if (scanOuterClausesForCommands(outerText, { checkMode: true, stopOnFirst: true }).length > 0) {
    return true;
  }
  return false;
}
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

function isSingleExternalEndpointToken(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    (value.indexOf('.') === -1 && value.indexOf(':') === -1) ||
    /\s/.test(value)
  ) {
    return false;
  }
  const isValidUrlToken =
    isUrlExternalSource(value) && !/^[a-z][a-z0-9+.-]*:\/\/$/i.test(value);
  if (isValidUrlToken) {
    return true;
  }
  return Boolean(parseBareDomainEndpoint(value));
}

function cleanProseEndpointToken(rawToken, sourceText, offset) {
  if (!rawToken) {
    return '';
  }
  if (isExplicitlyDelimitedMatch(sourceText, offset, rawToken.length)) {
    return rawToken;
  }
  let openParens = 0;
  let closeParens = 0;
  for (let i = 0; i < rawToken.length; i += 1) {
    const ch = rawToken[i];
    if (ch === '(') {
      openParens += 1;
    } else if (ch === ')') {
      closeParens += 1;
    }
  }
  if (
    offset === 0 &&
    typeof sourceText === 'string' &&
    rawToken.length === sourceText.length &&
    /[/?#=]/.test(rawToken) &&
    !rawToken.endsWith('.') &&
    closeParens <= openParens
  ) {
    return rawToken;
  }

  let end = rawToken.length;
  const hasLeadingOpenParen =
    offset > 0 && typeof sourceText === 'string' && sourceText[offset - 1] === '(';

  while (end > 0) {
    const ch = rawToken[end - 1];
    if (ch === ')' && closeParens > openParens) {
      closeParens -= 1;
      end -= 1;
      if (hasLeadingOpenParen && closeParens === openParens) {
        break;
      }
      continue;
    }
    if (ch === '.' || ch === ',' || ch === ';' || ch === ':' || ch === '!' || ch === '?') {
      end -= 1;
      continue;
    }
    break;
  }
  return rawToken.slice(0, end);
}

function unwrapStructuredSource(rawValue) {
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue || '').trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  const multiBacktickMatch = trimmed.match(/^(`+)([^`]+)\1$/);
  if (multiBacktickMatch) {
    const inner = multiBacktickMatch[2].trim();
    if (inner) {
      return inner;
    }
  }
  const wrapperPairs = [
    ['`', '`'],
    ['"', '"'],
    ["'", "'"],
    ['<', '>']
  ];
  for (const [open, close] of wrapperPairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner && !inner.includes(close)) {
        return inner;
      }
    }
  }
  return trimmed;
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

function isRecognizedBareDomainAuthority(token, allowSingleDigitPort = false) {
  const trimmed = String(token || '').trim();
  if (!trimmed) {
    return false;
  }
  const portRe = allowSingleDigitPort ? /^(.*):(\d{1,5})$/ : /^(.*):(\d{2,5})$/;
  const match = portRe.exec(trimmed);
  if (match) {
    const portNum = Number.parseInt(match[2], 10);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return false;
    }
    return isRecognizedBareDomain(match[1]);
  }
  return isRecognizedBareDomain(trimmed);
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
function classifyFileCandidate(rawToken, startRaw, endRaw, isStructuredSource = false, fullText = '') {
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
      if (
        KNOWN_STANDALONE_EXTENSIONLESS_FILES.has(source) ||
        hasKnownFileExtensionOrDotfile(source) ||
        (isStructuredSource && KNOWN_PATH_EXTENSIONLESS_FILES.has(source) && (source !== 'configure' || !/\s/.test(fullText)))
      ) {
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
  if (!rawToken.startsWith('/') && !hasExplicitDotSlash && isRecognizedBareDomainAuthority(segments[0], true)) {
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

function hasPotentialBroadSyntax(str) {
  for (let i = 0; i < str.length; i += 1) {
    const cc = str.charCodeAt(i);
    if (cc === 42 || cc === 47 || cc === 63 || cc === 91 || cc === 123) {
      return true;
    }
    if (cc === 40 && i > 0) {
      const prev = str.charCodeAt(i - 1);
      if (prev === 64 || prev === 43 || prev === 33) {
        return true;
      }
    }
  }
  return false;
}

const POSIX_CHAR_CLASS_NAMES = new Set([
  'alnum',
  'alpha',
  'ascii',
  'blank',
  'cntrl',
  'digit',
  'graph',
  'lower',
  'print',
  'punct',
  'space',
  'upper',
  'word',
  'xdigit'
]);

function findSegmentCharClasses(str, allowLeadingOuterBrackets = false) {
  const len = str.length;
  const closeAt = new Int32Array(len).fill(-1);
  let hasCharClass = false;
  let hasMultiMatchCharClass = false;
  let segStart = 0;

  while (segStart < len) {
    let segEnd = str.indexOf('/', segStart);
    if (segEnd === -1) {
      segEnd = len;
    }
    let scanStart = segStart;
    if (allowLeadingOuterBrackets && segStart === 0 && segEnd >= 2) {
      let p = 0;
      while (p < segEnd && str[p] === '(') {
        p += 1;
      }
      if (p < segEnd && str[p] === '[') {
        let k = p;
        while (k + 1 < segEnd && str[k + 1] === '[') {
          k += 1;
        }
        const leadBracketCount = k - p + 1;
        if (leadBracketCount >= 2) {
          if (k + 1 < segEnd) {
            const afterRun = str[k + 1];
            if (afterRun === ':' || afterRun === '.' || afterRun === '=' || afterRun === ']') {
              scanStart = k - 1;
            } else {
              scanStart = k;
            }
          }
        } else {
          let innerOpen = -1;
          let firstClose = -1;
          for (let q = p + 1; q < segEnd; q += 1) {
            const qc = str[q];
            if (qc === '[' && innerOpen === -1) {
              innerOpen = q;
            } else if (qc === ']') {
              const initLit =
                q === p + 1 || (q === p + 2 && (str[p + 1] === '!' || str[p + 1] === '^'));
              if (!initLit) {
                firstClose = q;
                break;
              }
            }
          }
          if (innerOpen !== -1 && firstClose !== -1 && str.indexOf(']', firstClose + 1) !== -1) {
            scanStart = p + 1;
          }
        }
      }
    }

    let openIdx = -1;
    for (let i = scanStart; i < segEnd; i += 1) {
      const ch = str[i];
      if (ch === '[') {
        if (openIdx === -1) {
          openIdx = i;
        } else if (i + 3 < segEnd) {
          const delim = str[i + 1];
          if (delim === ':' || delim === '.' || delim === '=') {
            const limit = Math.min(segEnd - 1, i + 20);
            for (let p = i + 2; p < limit; p += 1) {
              if (str[p] === delim && str[p + 1] === ']' && p > i + 2) {
                if (delim !== ':' || POSIX_CHAR_CLASS_NAMES.has(str.slice(i + 2, p))) {
                  i = p + 1;
                }
                break;
              }
              if (str[p] === ']' || str[p] === '/') {
                break;
              }
            }
          }
        }
      } else if (ch === ']' && openIdx !== -1) {
        const isInitialLiteralClose =
          i === openIdx + 1 ||
          (i === openIdx + 2 && (str[openIdx + 1] === '!' || str[openIdx + 1] === '^'));
        if (isInitialLiteralClose) {
          continue;
        }
        closeAt[openIdx] = i;
        hasCharClass = true;
        if (i - openIdx > 2) {
          hasMultiMatchCharClass = true;
        }
        openIdx = -1;
      }
    }

    segStart = segEnd + 1;
  }

  return { closeAt, hasCharClass, hasMultiMatchCharClass };
}

const ROOT_GLOB_STANDALONE_NAMES = [
  'Makefile',
  'GNUmakefile',
  'Dockerfile',
  'Containerfile',
  'Vagrantfile',
  'Gemfile',
  'Rakefile',
  'Procfile',
  'Brewfile',
  'Justfile',
  'Taskfile',
  'Jenkinsfile',
  'Pipfile',
  'Buildfile',
  'LICENSE',
  'README',
  'CHANGELOG',
  'CODEOWNERS',
  'AUTHORS',
  'NOTICE',
  'COPYING',
  'SECURITY',
  'CONTRIBUTING'
];
const ROOT_GLOB_DOTFILE_NAMES = [
  '.env',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  '.npmrc',
  '.nvmrc',
  '.yarnrc',
  '.editorconfig',
  '.dockerignore',
  '.npmignore',
  '.eslintignore',
  '.prettierignore',
  '.eslintrc',
  '.prettierrc',
  '.babelrc',
  '.browserslistrc',
  '.envrc',
  '.flake8',
  '.mailmap',
  '.htaccess',
  '.hgignore',
  '.stignore'
];
const STEM_CAN_START = 1;
const STEM_HAS_CHAR = 2;
const STEM_LEADING_DOT = 4;

function compilePrefixTrie(words, caseInsensitive) {
  const edgeMaps = [new Map()];
  const terminals = [0];
  for (let w = 0; w < words.length; w += 1) {
    const rawWord = String(words[w] || '');
    if (!rawWord) continue;
    const word = caseInsensitive ? rawWord.toLowerCase() : rawWord;
    let node = 0;
    for (let k = 0; k < word.length; k += 1) {
      const ch = word.charCodeAt(k);
      let next = edgeMaps[node].get(ch);
      if (next === undefined) {
        next = edgeMaps.length;
        edgeMaps[node].set(ch, next);
        edgeMaps.push(new Map());
        terminals.push(0);
      }
      node = next;
    }
    terminals[node] = 1;
  }
  const nodeCount = edgeMaps.length;
  const wordCount = Math.max(1, Math.ceil(nodeCount / 32));
  let totalEdges = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    totalEdges += edgeMaps[i].size;
  }
  const edgeHead = new Int32Array(nodeCount + 1);
  const edgeChar = new Uint16Array(totalEdges);
  const edgeNextWord = new Int32Array(totalEdges);
  const edgeNextMask = new Int32Array(totalEdges);
  let cursor = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    edgeHead[i] = cursor;
    for (const [ch, next] of edgeMaps[i].entries()) {
      edgeChar[cursor] = ch;
      edgeNextWord[cursor] = next >> 5;
      edgeNextMask[cursor] = 1 << (next & 31);
      cursor += 1;
    }
  }
  edgeHead[nodeCount] = cursor;
  return {
    nodeCount,
    wordCount,
    caseInsensitive,
    terminals: Uint8Array.from(terminals),
    edgeHead,
    edgeChar,
    edgeNextWord,
    edgeNextMask
  };
}

let cachedRootGlobTries = null;
function getRootGlobTries() {
  if (cachedRootGlobTries) {
    return cachedRootGlobTries;
  }
  const extWords = [];
  for (const ext of KNOWN_FILE_EXTENSIONS) {
    if (ext && !IGNORED_DOMAIN_TLDS.has(ext)) {
      extWords.push(ext);
    }
  }
  cachedRootGlobTries = {
    standalone: compilePrefixTrie(Array.from(new Set([...KNOWN_STANDALONE_EXTENSIONLESS_FILES, ...ROOT_GLOB_STANDALONE_NAMES])), false),
    dotfile: compilePrefixTrie(Array.from(new Set([...KNOWN_DOTFILES, ...ROOT_GLOB_DOTFILE_NAMES])), true),
    ext: compilePrefixTrie(extWords, true)
  };
  return cachedRootGlobTries;
}

function isStemStartCode(code) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 45
  );
}

function isStemBodyCode(code) {
  return isStemStartCode(code) || code === 46;
}

const CHAR_ATOM_CACHE = new Array(128);
function getCharAtom(charStr) {
  const code = charStr.charCodeAt(0);
  if (code < 128 && CHAR_ATOM_CACHE[code]) {
    return CHAR_ATOM_CACHE[code];
  }
  const lowerCode = code >= 65 && code <= 90 ? code + 32 : code;
  const atom = {
    kind: 'char',
    code,
    lowerCode,
    canStartStem: isStemStartCode(code),
    canBodyStem: isStemBodyCode(code),
    matchesDot: code === 46
  };
  if (code < 128) {
    CHAR_ATOM_CACHE[code] = atom;
  }
  return atom;
}

function buildCiMask(mask) {
  const ciMask = new Uint32Array(mask);
  for (let c = 65; c <= 90; c += 1) {
    if ((mask[c >> 5] & (1 << (c & 31))) !== 0) {
      const lc = c + 32;
      ciMask[lc >> 5] |= 1 << (lc & 31);
    }
  }
  return ciMask;
}

const ANY_QUESTION_ATOM = (() => {
  const mask = new Uint32Array(4);
  for (let c = 33; c <= 126; c += 1) {
    if (c !== 47) {
      mask[c >> 5] |= 1 << (c & 31);
    }
  }
  return {
    kind: 'bracket',
    mask,
    ciMask: buildCiMask(mask),
    canStartStem: true,
    canBodyStem: true,
    matchesDot: true
  };
})();

function setMaskBit(mask, code) {
  if (code >= 0 && code < 128) {
    mask[code >> 5] |= 1 << (code & 31);
  }
}

function setMaskRange(mask, lo, hi) {
  const a = Math.max(0, Math.min(lo, hi));
  const b = Math.min(127, Math.max(lo, hi));
  for (let c = a; c <= b; c += 1) {
    mask[c >> 5] |= 1 << (c & 31);
  }
}

function parseGlobBracketAtom(value, openIdx, closeIdx) {
  let idx = openIdx + 1;
  let negated = false;
  if (idx < closeIdx && (value[idx] === '!' || value[idx] === '^')) {
    negated = true;
    idx += 1;
  }
  const rawMask = new Uint32Array(4);
  while (idx < closeIdx) {
    if (value[idx] === '[' && idx + 2 < closeIdx && value[idx + 1] === ':') {
      const closeColon = value.indexOf(':]', idx + 2);
      if (closeColon !== -1 && closeColon < closeIdx) {
        const clsName = value.slice(idx + 2, closeColon);
        if (POSIX_CHAR_CLASS_NAMES.has(clsName)) {
          if (clsName === 'digit' || clsName === 'xdigit') {
            setMaskRange(rawMask, 48, 57);
            if (clsName === 'xdigit') {
              setMaskRange(rawMask, 65, 70);
              setMaskRange(rawMask, 97, 102);
            }
          } else if (clsName === 'lower' || clsName === 'upper' || clsName === 'alpha' || clsName === 'alnum' || clsName === 'word') {
            if (clsName !== 'upper') setMaskRange(rawMask, 97, 122);
            if (clsName !== 'lower') setMaskRange(rawMask, 65, 90);
            if (clsName === 'alnum' || clsName === 'word') setMaskRange(rawMask, 48, 57);
            if (clsName === 'word') setMaskBit(rawMask, 95);
          } else if (clsName === 'ascii') {
            setMaskRange(rawMask, 0, 127);
          } else if (clsName === 'blank') {
            setMaskBit(rawMask, 9);
            setMaskBit(rawMask, 32);
          } else if (clsName === 'space') {
            setMaskRange(rawMask, 9, 13);
            setMaskBit(rawMask, 32);
          } else if (clsName === 'cntrl') {
            setMaskRange(rawMask, 0, 31);
            setMaskBit(rawMask, 127);
          } else if (clsName === 'graph') {
            setMaskRange(rawMask, 33, 126);
          } else if (clsName === 'print') {
            setMaskRange(rawMask, 32, 126);
          } else if (clsName === 'punct') {
            setMaskRange(rawMask, 33, 46);
            setMaskRange(rawMask, 58, 64);
            setMaskRange(rawMask, 91, 96);
            setMaskRange(rawMask, 123, 126);
          }
          idx = closeColon + 2;
          continue;
        }
      }
    }
    if (idx + 2 < closeIdx && value[idx + 1] === '-') {
      setMaskRange(rawMask, value.charCodeAt(idx), value.charCodeAt(idx + 2));
      idx += 3;
      continue;
    }
    setMaskBit(rawMask, value.charCodeAt(idx));
    idx += 1;
  }

  let mask = rawMask;
  if (negated) {
    mask = new Uint32Array(4);
    for (let c = 1; c <= 127; c += 1) {
      if (c !== 47 && (rawMask[c >> 5] & (1 << (c & 31))) === 0) {
        setMaskBit(mask, c);
      }
    }
  }
  // Never match path separator '/' across POSIX classes (e.g. [:ascii:], [:graph:], [:print:])
  mask[47 >> 5] &= ~(1 << (47 & 31));

  let canStartStem = false;
  let canBodyStem = false;
  for (let c = 45; c <= 122; c += 1) {
    if ((mask[c >> 5] & (1 << (c & 31))) !== 0) {
      if (isStemStartCode(c)) {
        canStartStem = true;
        canBodyStem = true;
        break;
      }
      if (c === 46) {
        canBodyStem = true;
      }
    }
  }
  const matchesDot = (mask[46 >> 5] & (1 << (46 & 31))) !== 0;
  return {
    kind: 'bracket',
    mask,
    ciMask: buildCiMask(mask),
    canStartStem,
    canBodyStem: canBodyStem || matchesDot,
    matchesDot
  };
}

function buildBraceSequenceNode(inner) {
  const dotDot = inner.indexOf('..');
  if (dotDot <= 0) {
    return getCharAtom('x');
  }
  const left = inner.slice(0, dotDot);
  const right = inner.slice(dotDot + 2);
  if (/^[A-Za-z]$/.test(left) && /^[A-Za-z]$/.test(right)) {
    const mask = new Uint32Array(4);
    setMaskRange(mask, left.charCodeAt(0), right.charCodeAt(0));
    return { kind: 'bracket', mask, ciMask: buildCiMask(mask), canStartStem: true, canBodyStem: true, matchesDot: false };
  }
  const startNum = Number.parseInt(left, 10);
  const endNum = Number.parseInt(right, 10);
  if (Number.isFinite(startNum) && Number.isFinite(endNum)) {
    const step = startNum <= endNum ? 1 : -1;
    const count = Math.abs(endNum - startNum) + 1;
    if (count <= 64) {
      const padLen = left.startsWith('0') && left.length > 1 ? left.length : 0;
      const branches = [];
      for (let idx = 0; idx < count; idx += 1) {
        const val = String(startNum + idx * step);
        const padded = padLen > 0 ? val.padStart(padLen, '0') : val;
        const seq = [];
        for (let k = 0; k < padded.length; k += 1) {
          seq.push(getCharAtom(padded[k]));
        }
        branches.push(
          seq.length === 1 ? seq[0] : { kind: 'seq', items: seq, nullable: false, onlyLeafAtoms: true }
        );
      }
      return { kind: 'alt', branches, nullable: false, hasEmptyBranch: false };
    }
  }
  const digits = new Uint32Array(4);
  setMaskRange(digits, 48, 57);
  return { kind: 'bracket', mask: digits, ciMask: digits, canStartStem: true, canBodyStem: true, matchesDot: false };
}

const EMPTY_SEQ_NODE = Object.freeze({
  kind: 'seq',
  items: Object.freeze([]),
  nullable: true,
  onlyLeafAtoms: true
});

function isGlobAstNullable(node) {
  if (!node) {
    return false;
  }
  if (node === EMPTY_SEQ_NODE) {
    return true;
  }
  if (node.kind === 'seq' || node.kind === 'alt') {
    return Boolean(node.nullable);
  }
  if (node.kind === 'ext') {
    return node.op === '?' || node.op === '*' || Boolean(node.nullable);
  }
  return false;
}

function finishGlobSeqNode(seqItems) {
  if (seqItems.length === 0) {
    return EMPTY_SEQ_NODE;
  }
  if (seqItems.length === 1) {
    return seqItems[0];
  }
  const items = [];
  let nullable = true;
  let onlyLeafAtoms = true;
  for (let i = 0; i < seqItems.length; i += 1) {
    const item = seqItems[i];
    if (item === EMPTY_SEQ_NODE || (item.kind === 'seq' && item.items.length === 0)) {
      continue;
    }
    items.push(item);
    if (!isGlobAstNullable(item)) {
      nullable = false;
    }
    if (item.kind !== 'char' && item.kind !== 'bracket') {
      onlyLeafAtoms = false;
    }
  }
  if (items.length === 0) {
    return EMPTY_SEQ_NODE;
  }
  if (items.length === 1) {
    return items[0];
  }
  return { kind: 'seq', items, nullable, onlyLeafAtoms };
}

function canAbsorbBranchChild(topKind, builtOp, child) {
  if (!child || !Array.isArray(child.branches)) {
    return false;
  }
  if (topKind === 'brace' || builtOp === '@') {
    return child.kind === 'alt' || (child.kind === 'ext' && child.op === '@');
  }
  if (builtOp === '?') {
    return child.kind === 'alt' || (child.kind === 'ext' && (child.op === '@' || child.op === '?'));
  }
  if (builtOp === '+') {
    return child.kind === 'alt' || (child.kind === 'ext' && (child.op === '@' || child.op === '+'));
  }
  if (builtOp === '*') {
    return (
      child.kind === 'alt' ||
      (child.kind === 'ext' &&
        (child.op === '@' || child.op === '?' || child.op === '+' || child.op === '*'))
    );
  }
  return false;
}

function getLiteralSeqKey(node) {
  if (node.kind !== 'seq' || node.items.length === 0 || node.items.length > 32) return null;
  let s = '';
  for (let m = 0; m < node.items.length; m += 1) {
    if (node.items[m].kind !== 'char') return null;
    s += String.fromCharCode(node.items[m].code);
  }
  return s;
}

function parseRootGlobAst(value, bracketClose, braceClose, braceIsSeq, parenClose, parenIsExtGlob) {
  const n = value.length;
  const frames = [{ kind: 'root', stopIdx: n, sep: null, op: null, branches: null, seqItems: [] }];
  const bracketCache = new Map();
  let i = 0;

  while (i < n || frames.length > 1) {
    const top = frames[frames.length - 1];
    if (frames.length > 1 && i >= top.stopIdx) {
      top.branches.push(finishGlobSeqNode(top.seqItems));
      frames.pop();
      const parent = frames[frames.length - 1];
      let builtOp = top.op;
      let anyNullable = false;
      for (let b = 0; b < top.branches.length; b += 1) {
        if (isGlobAstNullable(top.branches[b])) {
          anyNullable = true;
          break;
        }
      }
      if (top.kind === 'ext' && builtOp === '+' && anyNullable) {
        builtOp = '*';
      }

      let builtBranches = top.branches;
      let hasEmptyBranch = false;
      let seenChars = null;
      let seenLiterals = null;
      let nullable = top.kind === 'ext' ? builtOp === '?' || builtOp === '*' || anyNullable : anyNullable;

      if (top.kind !== 'ext' || builtOp !== '!') {
        let candidates = top.branches;
        let hasSmallWrapper = false;
        for (let b = 0; b < candidates.length; b += 1) {
          const c = candidates[b];
          if (canAbsorbBranchChild(top.kind, builtOp, c) && c.branches.length <= 8) {
            hasSmallWrapper = true;
            break;
          }
        }
        if (hasSmallWrapper) {
          const expanded = [];
          let inheritedEmpty = false;
          const work = [];
          for (let b = candidates.length - 1; b >= 0; b -= 1) {
            work.push(candidates[b]);
          }
          while (work.length > 0) {
            const cur = work.pop();
            if (canAbsorbBranchChild(top.kind, builtOp, cur) && cur.branches.length <= 8) {
              if (cur.kind === 'ext' && (cur.op === '?' || cur.op === '*')) {
                inheritedEmpty = true;
              }
              for (let cb = cur.branches.length - 1; cb >= 0; cb -= 1) {
                work.push(cur.branches[cb]);
              }
            } else {
              expanded.push(cur);
            }
          }
          if (inheritedEmpty) {
            expanded.push(EMPTY_SEQ_NODE);
          }
          candidates = expanded;
        }

        let bestIdx = -1;
        let bestLen = -1;
        for (let b = 0; b < candidates.length; b += 1) {
          const cand = candidates[b];
          if (canAbsorbBranchChild(top.kind, builtOp, cand) && cand.branches.length > bestLen) {
            bestIdx = b;
            bestLen = cand.branches.length;
          }
        }
        if (bestIdx !== -1) {
          const bestChild = candidates[bestIdx];
          builtBranches = bestChild.branches;
          hasEmptyBranch = Boolean(bestChild.hasEmptyBranch);
          seenChars = bestChild.seenChars || null;
          seenLiterals = bestChild.seenLiterals || null;
        } else {
          builtBranches = [];
        }

        const pushEmpty = () => {
          if (!hasEmptyBranch) {
            hasEmptyBranch = true;
            builtBranches.push(EMPTY_SEQ_NODE);
          }
        };
        const pushBranch = (br) => {
          if (br === EMPTY_SEQ_NODE || (br.kind === 'seq' && br.items.length === 0)) {
            pushEmpty();
            return;
          }
          if (br.kind === 'char') {
            if (!seenChars) {
              seenChars = new Set();
            } else if (seenChars.has(br.code)) {
              return;
            }
            seenChars.add(br.code);
          } else if (br.kind === 'seq') {
            const litKey = getLiteralSeqKey(br);
            if (litKey !== null) {
              if (!seenLiterals) {
                seenLiterals = new Set();
                for (let e = 0; e < builtBranches.length; e += 1) {
                  const ek = getLiteralSeqKey(builtBranches[e]);
                  if (ek !== null) seenLiterals.add(ek);
                }
              }
              if (seenLiterals.has(litKey)) {
                return;
              }
              seenLiterals.add(litKey);
            }
          }
          builtBranches.push(br);
        };

        if (bestIdx !== -1) {
          const bestChild = candidates[bestIdx];
          if (bestChild.kind === 'ext' && (bestChild.op === '?' || bestChild.op === '*')) {
            pushEmpty();
          }
        }

        for (let b = 0; b < candidates.length; b += 1) {
          if (b === bestIdx) {
            continue;
          }
          const br = candidates[b];
          if (canAbsorbBranchChild(top.kind, builtOp, br)) {
            if (br.kind === 'ext' && (br.op === '?' || br.op === '*')) {
              pushEmpty();
            }
            const sub = br.branches;
            for (let cb = 0; cb < sub.length; cb += 1) {
              pushBranch(sub[cb]);
            }
          } else {
            pushBranch(br);
          }
        }
      } else {
        nullable = false;
      }

      const built =
        top.kind === 'brace' || (top.kind === 'ext' && builtOp === '@' && builtBranches.length === 1)
          ? builtBranches.length === 1
            ? builtBranches[0]
            : { kind: 'alt', branches: builtBranches, hasEmptyBranch, nullable, seenChars, seenLiterals }
          : {
              kind: 'ext',
              op: builtOp,
              branches: builtBranches,
              hasEmptyBranch,
              nullable,
              seenChars,
              seenLiterals,
              mIn1: -1,
              mOut1: -1,
              mIn2: -1,
              mOut2: -1,
              memoMap: null
            };
      parent.seqItems.push(built);
      if (i === top.stopIdx) {
        i += 1;
      }
      continue;
    }

    if (i >= n) {
      break;
    }

    if (top.sep && value[i] === top.sep) {
      top.branches.push(finishGlobSeqNode(top.seqItems));
      top.seqItems = [];
      i += 1;
      continue;
    }

    if (bracketClose[i] !== -1) {
      const closeB = bracketClose[i];
      if (closeB - i <= 32) {
        const key = value.slice(i, closeB + 1);
        let atom = bracketCache.get(key);
        if (!atom) {
          atom = parseGlobBracketAtom(value, i, closeB);
          bracketCache.set(key, atom);
        }
        top.seqItems.push(atom);
      } else {
        top.seqItems.push(parseGlobBracketAtom(value, i, closeB));
      }
      i = closeB + 1;
      continue;
    }

    if (braceClose[i] !== -1) {
      if (braceIsSeq[i] === 1) {
        top.seqItems.push(buildBraceSequenceNode(value.slice(i + 1, braceClose[i])));
        i = braceClose[i] + 1;
        continue;
      }
      frames.push({ kind: 'brace', stopIdx: braceClose[i], sep: ',', op: null, branches: [], seqItems: [] });
      i += 1;
      continue;
    }

    if (i + 1 < n && parenClose[i + 1] !== -1 && parenIsExtGlob[i + 1] === 1) {
      frames.push({
        kind: 'ext',
        stopIdx: parenClose[i + 1],
        sep: '|',
        op: value[i],
        branches: [],
        seqItems: []
      });
      i += 2;
      continue;
    }

    if (value[i] === '?') {
      top.seqItems.push(ANY_QUESTION_ATOM);
      i += 1;
      continue;
    }

    top.seqItems.push(getCharAtom(value[i]));
    i += 1;
  }

  return finishGlobSeqNode(frames[0].seqItems);
}

function atomMatchesCode(atom, ch, caseInsensitive) {
  if (atom.kind === 'char') {
    return caseInsensitive ? atom.lowerCode === ch : atom.code === ch;
  }
  const mask = caseInsensitive ? atom.ciMask : atom.mask;
  return ch < 128 && (mask[ch >> 5] & (1 << (ch & 31))) !== 0;
}

function stepTrieSlab(trie, slab, srcOff, dstOff, atom) {
  const words = trie.wordCount;
  const edgeHead = trie.edgeHead;
  const edgeChar = trie.edgeChar;
  const edgeNextWord = trie.edgeNextWord;
  const edgeNextMask = trie.edgeNextMask;
  const ci = trie.caseInsensitive;
  const isChar = atom.kind === 'char';
  const charCode = isChar ? (ci ? atom.lowerCode : atom.code) : 0;
  const mask = isChar ? null : (ci ? atom.ciMask : atom.mask);

  for (let w = 0; w < words; w += 1) {
    let bits = slab[srcOff + w];
    while (bits !== 0) {
      const lsb = bits & -bits;
      const u = (w << 5) + (31 - Math.clz32(lsb));
      bits ^= lsb;
      const start = edgeHead[u];
      const end = edgeHead[u + 1];
      if (isChar) {
        for (let e = start; e < end; e += 1) {
          if (edgeChar[e] === charCode) {
            slab[dstOff + edgeNextWord[e]] |= edgeNextMask[e];
            break;
          }
        }
      } else {
        for (let e = start; e < end; e += 1) {
          const ch = edgeChar[e];
          if (ch < 128 && (mask[ch >> 5] & (1 << (ch & 31))) !== 0) {
            slab[dstOff + edgeNextWord[e]] |= edgeNextMask[e];
          }
        }
      }
    }
  }
}

function hasTrieAcceptSlab(trie, slab, off) {
  const terminals = trie.terminals;
  const words = trie.wordCount;
  for (let w = 0; w < words; w += 1) {
    let b = slab[off + w];
    while (b !== 0) {
      const lsb = b & -b;
      const u = (w << 5) + (31 - Math.clz32(lsb));
      b ^= lsb;
      if (terminals[u] === 1) {
        return true;
      }
    }
  }
  return false;
}

function evalRootGlobAstIterative(rootNode, tries, patternLen = 64) {
  const sWords = tries.standalone.wordCount;
  const dWords = tries.dotfile.wordCount;
  const eWords = tries.ext.wordCount;
  const dOff = sWords;
  const eOff = sWords + dWords;
  const metaOff = sWords + dWords + eWords;
  const stride = metaOff + 1;

  let slabCapSlots = Math.max(64, Math.min(256, patternLen));
  let slab = new Uint32Array(slabCapSlots * stride);
  const freeSlots = [];
  let nextSlot = 0;

  const allocSlot = () => {
    if (freeSlots.length > 0) {
      return freeSlots.pop();
    }
    if (nextSlot >= slabCapSlots) {
      const newCap = slabCapSlots * 2;
      const grown = new Uint32Array(newCap * stride);
      grown.set(slab);
      slab = grown;
      slabCapSlots = newCap;
    }
    const slot = nextSlot;
    nextSlot += 1;
    return slot;
  };
  const freeSlot = (slot) => {
    if (slot >= 0) {
      freeSlots.push(slot);
    }
  };
  const clearSlot = (slot) => {
    const base = slot * stride;
    slab.fill(0, base, base + stride);
  };
  const copySlot = (dstSlot, srcSlot) => {
    const dstBase = dstSlot * stride;
    const srcBase = srcSlot * stride;
    for (let k = 0; k < stride; k += 1) {
      slab[dstBase + k] = slab[srcBase + k];
    }
  };
  const orSlotInto = (dstSlot, srcSlot) => {
    const dstBase = dstSlot * stride;
    const srcBase = srcSlot * stride;
    for (let k = 0; k < stride; k += 1) {
      slab[dstBase + k] |= slab[srcBase + k];
    }
  };
  const slotsEqual = (slotA, slotB) => {
    const baseA = slotA * stride;
    const baseB = slotB * stride;
    for (let k = 0; k < stride; k += 1) {
      if (slab[baseA + k] !== slab[baseB + k]) {
        return false;
      }
    }
    return true;
  };
  const andNotSlotInto = (srcSlot, fedSlot, dstSlot) => {
    const srcBase = srcSlot * stride;
    const fedBase = fedSlot * stride;
    const dstBase = dstSlot * stride;
    let nonZero = false;
    for (let k = 0; k < stride; k += 1) {
      const diff = slab[srcBase + k] & ~slab[fedBase + k];
      slab[dstBase + k] = diff;
      if (diff !== 0) {
        nonZero = true;
      }
    }
    return nonZero;
  };
  const packSlotKey = (slot) => {
    const base = slot * stride;
    let out = '';
    for (let k = 0; k < stride; k += 1) {
      const v = slab[base + k];
      out += String.fromCharCode(v & 0xffff, v >>> 16);
    }
    return out;
  };
  const stepLeafSlot = (srcSlot, dstSlot, atom) => {
    const srcBase = srcSlot * stride;
    const dstBase = dstSlot * stride;
    slab.fill(0, dstBase, dstBase + stride);
    stepTrieSlab(tries.standalone, slab, srcBase, dstBase, atom);
    stepTrieSlab(tries.dotfile, slab, srcBase + dOff, dstBase + dOff, atom);
    stepTrieSlab(tries.ext, slab, srcBase + eOff, dstBase + eOff, atom);

    const srcMeta = slab[srcBase + metaOff];
    const se = srcMeta & 0xff;
    let de = 0;
    if (se !== 0) {
      if ((se & 1) !== 0 && atomMatchesCode(atom, 46, false)) de |= 2;
      if ((se & 2) !== 0 && atomMatchesCode(atom, 101, true)) de |= 4;
      if ((se & 4) !== 0 && atomMatchesCode(atom, 110, true)) de |= 8;
      if ((se & 8) !== 0 && atomMatchesCode(atom, 118, true)) de |= 16;
      if ((se & 16) !== 0 && atomMatchesCode(atom, 46, false)) de |= 32;
      if ((se & 96) !== 0 && atom.canBodyStem) de |= 64;
    }

    const sf = srcMeta >>> 8;
    if ((sf & STEM_HAS_CHAR) !== 0 && atom.matchesDot) {
      slab[dstBase + eOff] |= 1;
    }
    let df = 0;
    if ((sf & STEM_CAN_START) !== 0 && atom.matchesDot) {
      df |= STEM_LEADING_DOT;
    }
    if ((sf & (STEM_CAN_START | STEM_LEADING_DOT)) !== 0 && atom.canStartStem) {
      df |= STEM_HAS_CHAR;
    }
    if ((sf & STEM_HAS_CHAR) !== 0 && atom.canBodyStem) {
      df |= STEM_HAS_CHAR;
    }
    slab[dstBase + metaOff] = de | (df << 8);
  };

  const initSlot = allocSlot();
  clearSlot(initSlot);
  const initBase = initSlot * stride;
  slab[initBase] = 1;
  slab[initBase + dOff] = 1;
  slab[initBase + metaOff] = 1 | (STEM_CAN_START << 8);

  let stepBudget = Math.min(81920, Math.max(65536, patternLen * 2));
  const frames = [];
  let pendingResultSlot = -1;
  let activeRepeatCount = 0;
  let memoSlotsUsed = 0;
  const MAX_MEMO_SLOTS = 4096;
  let exhausted = false;

  const pushNode = (node, stateInSlot, memoTargetNode = null, memoKeySlot = -1) => {
    const needsBase = node.kind === 'ext' && (node.op === '?' || node.op === '*' || node.op === '!');
    let baseSlot = -1;
    if (needsBase) {
      baseSlot = allocSlot();
      copySlot(baseSlot, stateInSlot);
    }
    const isRepeatNode = node.kind === 'ext' && (node.op === '+' || node.op === '*');
    if (isRepeatNode) {
      activeRepeatCount += 1;
      if (activeRepeatCount > 128) {
        exhausted = true;
      }
    }
    frames.push({
      kind: node.kind,
      node,
      index: 0,
      curSlot: stateInSlot,
      scratchSlot: -1,
      scratchSlot2: -1,
      baseSlot,
      accSlot: -1,
      fedSlot: -1,
      deltaSlot: -1,
      repeatLeft: isRepeatNode ? 64 : 0,
      isRepeatNode,
      memoTargetNode,
      memoKeySlot
    });
  };

  const popFrameWithResult = (f, resultSlot) => {
    if (f.memoTargetNode && f.memoKeySlot >= 0 && !exhausted) {
      const mNode = f.memoTargetNode;
      if (mNode.mIn1 < 0 && memoSlotsUsed + 2 <= MAX_MEMO_SLOTS) {
        mNode.mIn1 = f.memoKeySlot;
        f.memoKeySlot = -1;
        mNode.mOut1 = allocSlot();
        copySlot(mNode.mOut1, resultSlot);
        memoSlotsUsed += 2;
      } else if (mNode.mIn2 < 0 && memoSlotsUsed + 2 <= MAX_MEMO_SLOTS) {
        mNode.mIn2 = f.memoKeySlot;
        f.memoKeySlot = -1;
        mNode.mOut2 = allocSlot();
        copySlot(mNode.mOut2, resultSlot);
        memoSlotsUsed += 2;
      } else if ((!mNode.memoMap || mNode.memoMap.size < 24) && memoSlotsUsed + 1 <= MAX_MEMO_SLOTS) {
        if (!mNode.memoMap) {
          mNode.memoMap = new Map();
        }
        const key = packSlotKey(f.memoKeySlot);
        if (!mNode.memoMap.has(key)) {
          const outSlot = allocSlot();
          copySlot(outSlot, resultSlot);
          mNode.memoMap.set(key, outSlot);
          memoSlotsUsed += 1;
        }
      }
    }
    if (f.isRepeatNode) {
      activeRepeatCount -= 1;
    }
    if (f.curSlot >= 0 && f.curSlot !== resultSlot) freeSlot(f.curSlot);
    if (f.scratchSlot >= 0 && f.scratchSlot !== resultSlot) freeSlot(f.scratchSlot);
    if (f.scratchSlot2 >= 0 && f.scratchSlot2 !== resultSlot) freeSlot(f.scratchSlot2);
    if (f.baseSlot >= 0 && f.baseSlot !== resultSlot) freeSlot(f.baseSlot);
    if (f.accSlot >= 0 && f.accSlot !== resultSlot) freeSlot(f.accSlot);
    if (f.fedSlot >= 0 && f.fedSlot !== resultSlot) freeSlot(f.fedSlot);
    if (f.deltaSlot >= 0 && f.deltaSlot !== resultSlot) freeSlot(f.deltaSlot);
    if (f.memoKeySlot >= 0 && f.memoKeySlot !== resultSlot) freeSlot(f.memoKeySlot);
    frames.pop();
    pendingResultSlot = resultSlot;
  };

  const dispatchChildNode = (parentFrame, childNode) => {
    const srcSlot = parentFrame.curSlot;
    if (childNode.kind === 'ext' && activeRepeatCount > 0) {
      let cachedSlot = -1;
      if (childNode.mIn1 >= 0 && slotsEqual(childNode.mIn1, srcSlot)) {
        cachedSlot = childNode.mOut1;
      } else if (childNode.mIn2 >= 0 && slotsEqual(childNode.mIn2, srcSlot)) {
        cachedSlot = childNode.mOut2;
      } else if (childNode.memoMap !== null) {
        const mapped = childNode.memoMap.get(packSlotKey(srcSlot));
        if (mapped !== undefined) {
          cachedSlot = mapped;
        }
      }
      if (cachedSlot >= 0) {
        if (parentFrame.kind === 'seq') {
          copySlot(parentFrame.curSlot, cachedSlot);
        } else {
          orSlotInto(parentFrame.accSlot, cachedSlot);
        }
        parentFrame.index += 1;
        return false;
      }
    }
    const childIn = allocSlot();
    copySlot(childIn, srcSlot);
    let memoKeySlot = -1;
    let memoTargetNode = null;
    if (childNode.kind === 'ext' && activeRepeatCount > 0 && memoSlotsUsed < MAX_MEMO_SLOTS) {
      memoTargetNode = childNode;
      memoKeySlot = allocSlot();
      copySlot(memoKeySlot, srcSlot);
    }
    pushNode(childNode, childIn, memoTargetNode, memoKeySlot);
    return true;
  };

  pushNode(rootNode, initSlot);

  while (frames.length > 0) {
    if (exhausted || --stepBudget <= 0) {
      exhausted = true;
      break;
    }
    const f = frames[frames.length - 1];

    if (pendingResultSlot >= 0) {
      if (f.kind === 'seq') {
        freeSlot(f.curSlot);
        f.curSlot = pendingResultSlot;
        pendingResultSlot = -1;
        f.index += 1;
      } else {
        orSlotInto(f.accSlot, pendingResultSlot);
        freeSlot(pendingResultSlot);
        pendingResultSlot = -1;
        f.index += 1;
      }
    }

    if (f.kind === 'char' || f.kind === 'bracket') {
      const outSlot = allocSlot();
      stepLeafSlot(f.curSlot, outSlot, f.node);
      popFrameWithResult(f, outSlot);
      continue;
    }

    if (f.kind === 'seq') {
      const items = f.node.items;
      let stoppedForChild = false;
      while (f.index < items.length) {
        const item = items[f.index];
        if (item === EMPTY_SEQ_NODE || (item.kind === 'seq' && item.items.length === 0)) {
          f.index += 1;
          continue;
        }
        if (item.kind === 'char' || item.kind === 'bracket') {
          if (f.scratchSlot < 0) {
            f.scratchSlot = allocSlot();
          }
          stepLeafSlot(f.curSlot, f.scratchSlot, item);
          const tmp = f.curSlot;
          f.curSlot = f.scratchSlot;
          f.scratchSlot = tmp;
          f.index += 1;
          if (f.index < items.length && items[f.index] === item && slotsEqual(f.curSlot, f.scratchSlot)) {
            while (f.index < items.length && items[f.index] === item) {
              f.index += 1;
            }
          }
          continue;
        }
        if (item.kind === 'seq' && item.onlyLeafAtoms) {
          if (f.scratchSlot < 0) {
            f.scratchSlot = allocSlot();
          }
          const subItems = item.items;
          for (let j = 0; j < subItems.length; j += 1) {
            stepLeafSlot(f.curSlot, f.scratchSlot, subItems[j]);
            const tmp = f.curSlot;
            f.curSlot = f.scratchSlot;
            f.scratchSlot = tmp;
          }
          if (subItems.length > 1) {
            stepBudget -= subItems.length - 1;
            if (stepBudget <= 0) {
              exhausted = true;
              break;
            }
          }
          f.index += 1;
          continue;
        }
        if (dispatchChildNode(f, item)) {
          stoppedForChild = true;
          break;
        }
        if (--stepBudget <= 0) {
          exhausted = true;
          break;
        }
      }
      if (exhausted) {
        break;
      }
      if (!stoppedForChild) {
        popFrameWithResult(f, f.curSlot);
      }
      continue;
    }

    // 'alt' or 'ext'
    const branches = f.node.branches;
    if (f.accSlot < 0) {
      f.accSlot = allocSlot();
      clearSlot(f.accSlot);
      if (f.isRepeatNode) {
        f.fedSlot = allocSlot();
        copySlot(f.fedSlot, f.curSlot);
      }
    }
    if (f.index < branches.length) {
      const br = branches[f.index];
      if (br === EMPTY_SEQ_NODE || (br.kind === 'seq' && br.items.length === 0)) {
        orSlotInto(f.accSlot, f.curSlot);
        f.index += 1;
        continue;
      }
      if (br.kind === 'char' || br.kind === 'bracket') {
        if (f.scratchSlot < 0) {
          f.scratchSlot = allocSlot();
        }
        stepLeafSlot(f.curSlot, f.scratchSlot, br);
        orSlotInto(f.accSlot, f.scratchSlot);
        f.index += 1;
        continue;
      }
      if (br.kind === 'seq' && br.onlyLeafAtoms) {
        if (f.scratchSlot < 0) {
          f.scratchSlot = allocSlot();
        }
        const subItems = br.items;
        if (subItems.length === 1) {
          stepLeafSlot(f.curSlot, f.scratchSlot, subItems[0]);
          orSlotInto(f.accSlot, f.scratchSlot);
        } else {
          if (f.scratchSlot2 < 0) {
            f.scratchSlot2 = allocSlot();
          }
          stepLeafSlot(f.curSlot, f.scratchSlot, subItems[0]);
          let sA = f.scratchSlot;
          let sB = f.scratchSlot2;
          for (let j = 1; j < subItems.length; j += 1) {
            stepLeafSlot(sA, sB, subItems[j]);
            const tmp = sA;
            sA = sB;
            sB = tmp;
          }
          orSlotInto(f.accSlot, sA);
          stepBudget -= subItems.length - 1;
          if (stepBudget <= 0) {
            exhausted = true;
            break;
          }
        }
        f.index += 1;
        continue;
      }
      dispatchChildNode(f, br);
      continue;
    }

    const op = f.kind === 'ext' ? f.node.op : null;
    if (op === '+' || op === '*') {
      if (f.deltaSlot < 0) {
        f.deltaSlot = allocSlot();
      }
      const hasDelta = andNotSlotInto(f.accSlot, f.fedSlot, f.deltaSlot);
      if (hasDelta) {
        if (f.repeatLeft <= 0) {
          exhausted = true;
          break;
        }
        f.repeatLeft -= 1;
        orSlotInto(f.fedSlot, f.deltaSlot);
        copySlot(f.curSlot, f.deltaSlot);
        f.index = 0;
        continue;
      }
    }

    if (op === '?' || op === '*') {
      orSlotInto(f.accSlot, f.baseSlot);
    } else if (op === '!') {
      orSlotInto(f.accSlot, f.baseSlot);
      slab[f.accSlot * stride + metaOff] |= STEM_HAS_CHAR << 8;
    }

    popFrameWithResult(f, f.accSlot);
  }

  return {
    slab,
    stride,
    metaOff,
    dOff,
    eOff,
    resultSlot: pendingResultSlot >= 0 ? pendingResultSlot : initSlot,
    exhausted
  };
}

function doesRootNonStarGlobMatchFile(value, globInfo) {
  if (!value || !globInfo) {
    return false;
  }
  const tries = getRootGlobTries();
  const ast = parseRootGlobAst(
    value,
    globInfo.bracketClose,
    globInfo.braceClose,
    globInfo.braceIsSeq,
    globInfo.parenClose,
    globInfo.parenIsExtGlob
  );
  const evalResult = evalRootGlobAstIterative(ast, tries, value.length);
  if (evalResult.exhausted) {
    return true;
  }
  const { slab, stride, metaOff, dOff, eOff, resultSlot } = evalResult;
  const base = resultSlot * stride;
  if ((slab[base + metaOff] & 64) !== 0) {
    return true;
  }
  if (hasTrieAcceptSlab(tries.standalone, slab, base)) {
    return true;
  }
  if (hasTrieAcceptSlab(tries.dotfile, slab, base + dOff)) {
    return true;
  }
  if (hasTrieAcceptSlab(tries.ext, slab, base + eOff)) {
    return true;
  }
  return false;
}

function analyzeNonStarGlob(value) {
  if (!value || CITATION_TAG_SLASH_LIST_REGEX.test(value)) {
    return {
      hasNonStarGlob: false,
      hasCharClass: false,
      hasMultiMatchCharClass: false,
      hasBraceList: false,
      hasExtGlob: false,
      hasQuestionGlob: false,
      skeleton: value,
      sample: value
    };
  }

  const n = value.length;
  const {
    closeAt: bracketClose,
    hasCharClass,
    hasMultiMatchCharClass
  } = findSegmentCharClasses(value, false);
  const braceClose = new Int32Array(n).fill(-1);
  const braceIsSeq = new Uint8Array(n);
  const parenClose = new Int32Array(n).fill(-1);
  const parenIsExtGlob = new Uint8Array(n);

  let hasBraceList = false;
  let hasExtGlob = false;

  // Pre-pair nested {...} brace lists, sequence braces, and extglob (...) in O(n), skipping paired [...] and clearing crossing stacks.
  const braceStack = [];
  const parenStack = [];
  for (let i = 0; i < n; i++) {
    if (bracketClose[i] !== -1) {
      i = bracketClose[i];
      continue;
    }
    const ch = value[i];
    if (ch === '{') {
      braceStack.push({
        open: i,
        commaCount: 0
      });
    } else if (ch === ',') {
      if (braceStack.length > 0) {
        const topBrace = braceStack[braceStack.length - 1];
        const topParen = parenStack.length > 0 ? parenStack[parenStack.length - 1] : null;
        if (!topParen || topBrace.open > topParen.open) {
          topBrace.commaCount += 1;
        }
      }
    } else if (ch === '}') {
      if (braceStack.length > 0) {
        const topBrace = braceStack.pop();
        let crossed = false;
        while (parenStack.length > 0 && parenStack[parenStack.length - 1].open > topBrace.open) {
          parenStack.pop();
          crossed = true;
        }
        const isSeqBrace =
          topBrace.commaCount === 0 &&
          i - topBrace.open <= 64 &&
          BRACE_SEQ_CONTENT_REGEX.test(value.slice(topBrace.open + 1, i));
        if (!crossed && (topBrace.commaCount >= 1 || isSeqBrace)) {
          braceClose[topBrace.open] = i;
          if (isSeqBrace) {
            braceIsSeq[topBrace.open] = 1;
          }
          hasBraceList = true;
        }
      }
    } else if (ch === '(') {
      const prev = i > 0 ? value[i - 1] : '';
      const isExt = prev === '@' || prev === '+' || prev === '?' || prev === '!' || prev === '*';
      parenStack.push({ open: i, isExt });
    } else if (ch === ')') {
      if (parenStack.length > 0) {
        const topParen = parenStack.pop();
        let crossed = false;
        while (braceStack.length > 0 && braceStack[braceStack.length - 1].open > topParen.open) {
          braceStack.pop();
          crossed = true;
        }
        if (!crossed && topParen.isExt && i > topParen.open + 1) {
          parenClose[topParen.open] = i;
          parenIsExtGlob[topParen.open] = 1;
          hasExtGlob = true;
        }
      }
    }
  }

  // Collapse outermost matched non-star glob spans to 'x' in O(n).
  let skeleton = '';
  let i = 0;
  while (i < n) {
    if (bracketClose[i] !== -1) {
      skeleton += 'x';
      i = bracketClose[i] + 1;
      continue;
    }
    if (braceClose[i] !== -1) {
      skeleton += 'x';
      i = braceClose[i] + 1;
      continue;
    }
    if (i + 1 < n && parenClose[i + 1] !== -1 && parenIsExtGlob[i + 1] === 1) {
      skeleton += 'x';
      i = parenClose[i + 1] + 1;
      continue;
    }
    skeleton += value[i];
    i += 1;
  }

  const hasQuestionGlob = skeleton.includes('?') && !QUERY_PARAM_ASSIGN_REGEX.test(value);
  if (hasQuestionGlob) {
    skeleton = skeleton.replace(/\?+/g, 'x');
  }

  return {
    hasNonStarGlob: hasCharClass || hasBraceList || hasExtGlob || hasQuestionGlob,
    hasCharClass,
    hasMultiMatchCharClass,
    hasBraceList,
    hasExtGlob,
    hasQuestionGlob,
    skeleton,
    bracketClose,
    braceClose,
    braceIsSeq,
    parenClose,
    parenIsExtGlob
  };
}

function hasParenOrBracketChar(str) {
  for (let i = 0; i < str.length; i += 1) {
    const cc = str.charCodeAt(i);
    if (cc === 40 || cc === 41 || cc === 91 || cc === 93) {
      return true;
    }
  }
  return false;
}

function hasNonStarGlobMetaChar(str) {
  for (let i = 0; i < str.length; i += 1) {
    const cc = str.charCodeAt(i);
    if (cc === 91 || cc === 123 || cc === 63) {
      return true;
    }
    if (cc === 40 && i > 0) {
      const prev = str.charCodeAt(i - 1);
      if (prev === 64 || prev === 43 || prev === 33 || prev === 63 || prev === 42) {
        return true;
      }
    }
  }
  return false;
}

function hasBroadRunGroupChar(str) {
  for (let i = 0; i < str.length; i += 1) {
    const cc = str.charCodeAt(i);
    if (cc === 40 || cc === 91 || cc === 123) {
      return true;
    }
  }
  return false;
}

function extractBroadFromSubSpan(run, subStart, subEnd) {
  const s = run.slice(subStart, subEnd);
  const m = s.length;
  if (m === 0 || !hasPotentialBroadSyntax(s)) {
    return null;
  }

  const hasStar = s.includes('*');
  let lo = 0;
  let hi = m;
  let strippedBangQuestionColon = false;

  if (!hasParenOrBracketChar(s)) {
    while (lo < hi) {
      const last = s[hi - 1];
      if (last === '!' || last === '?' || last === ':') {
        strippedBangQuestionColon = true;
        hi -= 1;
        continue;
      }
      if (last === '.' && hi - lo > 1 && (hasStar || !strippedBangQuestionColon)) {
        hi -= 1;
        continue;
      }
      break;
    }
  } else {
    const { closeAt: charClassClose } = findSegmentCharClasses(s, true);
    const pairOf = new Int32Array(m).fill(-1);
    const parenStack = [];
    const bracketStack = [];
    for (let i = 0; i < m; i += 1) {
      if (charClassClose[i] !== -1) {
        const closeIdx = charClassClose[i];
        pairOf[i] = closeIdx;
        pairOf[closeIdx] = i;
        i = closeIdx;
        continue;
      }
      const ch = s[i];
      if (ch === '(') {
        parenStack.push(i);
      } else if (ch === ')' && parenStack.length > 0) {
        const open = parenStack.pop();
        pairOf[open] = i;
        pairOf[i] = open;
      } else if (ch === '[') {
        bracketStack.push(i);
      } else if (ch === ']' && bracketStack.length > 0) {
        const open = bracketStack.pop();
        pairOf[open] = i;
        pairOf[i] = open;
      }
    }

    while (lo < hi) {
      const last = s[hi - 1];
      if (last === '!' || last === '?' || last === ':') {
        strippedBangQuestionColon = true;
        hi -= 1;
        continue;
      }
      if (last === '.' && hi - lo > 1 && (hasStar || !strippedBangQuestionColon)) {
        hi -= 1;
        continue;
      }
      const first = s[lo];
      if ((first === '(' || first === '[') && pairOf[lo] === hi - 1) {
        lo += 1;
        hi -= 1;
        continue;
      }
      if ((first === '(' || first === '[') && (pairOf[lo] === -1 || pairOf[lo] >= hi)) {
        lo += 1;
        continue;
      }
      if ((last === ')' || last === ']') && (pairOf[hi - 1] === -1 || pairOf[hi - 1] < lo)) {
        hi -= 1;
        continue;
      }
      break;
    }
  }

  if (lo >= hi) {
    return null;
  }

  const candidate = s.slice(lo, hi);
  const hasRelativePrefix = candidate.startsWith('./') || candidate.startsWith('../');
  const trimmed = candidate.replace(/^\.\//, '');
  if (!trimmed) {
    return null;
  }
  const firstSeg = trimmed.split('/')[0];
  if (!hasRelativePrefix && !candidate.startsWith('/') && isRecognizedBareDomainAuthority(firstSeg, true)) {
    return null;
  }

  let looksBroad = false;
  if (trimmed.includes('*')) {
    looksBroad = hasRelativePrefix || trimmed.includes('/') || trimmed.includes('.');
  }
  if (!looksBroad && trimmed.endsWith('/')) {
    let resolvedSkeleton = candidate;
    if (hasNonStarGlobMetaChar(candidate)) {
      const { hasNonStarGlob, skeleton } = analyzeNonStarGlob(candidate);
      if (hasNonStarGlob) {
        resolvedSkeleton = skeleton;
      }
    }
    looksBroad =
      DIRECTORY_CANDIDATE_REGEX.test(resolvedSkeleton) &&
      resolvedSkeleton.length > 1 &&
      /[A-Za-z0-9_-]/.test(resolvedSkeleton);
  } else if (!looksBroad && hasNonStarGlobMetaChar(candidate)) {
    const candidateBase = candidate.replace(/:\d+(?:-\d+)?$/, '');
    if (hasNonStarGlobMetaChar(candidateBase)) {
      const globInfo = analyzeNonStarGlob(candidateBase);
      const {
        hasNonStarGlob,
        hasCharClass,
        hasMultiMatchCharClass,
        hasBraceList,
        hasExtGlob,
        hasQuestionGlob,
        skeleton
      } = globInfo;
      if (hasNonStarGlob && !skeleton.includes('*') && NON_STAR_PATH_SKELETON_REGEX.test(skeleton)) {
        if (hasRelativePrefix || trimmed.includes('/')) {
          looksBroad =
            hasCharClass ||
            hasExtGlob ||
            hasBraceList ||
            classifyFileCandidate(skeleton) === 'file';
        } else if (
          hasMultiMatchCharClass ||
          hasExtGlob ||
          hasBraceList ||
          hasQuestionGlob
        ) {
          looksBroad =
            classifyFileCandidate(skeleton) === 'file' ||
            doesRootNonStarGlobMatchFile(candidateBase, globInfo);
        }
      }
    }
  }

  if (!looksBroad) {
    return null;
  }

  return {
    trimmed,
    maskStart: subStart + lo,
    maskEnd: subStart + hi
  };
}

function extractAndMaskBroadWorkspaceDeps(masked, seenBroad, workspaceBroadDeps) {
  if (!hasPotentialBroadSyntax(masked)) {
    return masked;
  }
  return masked.replace(BROAD_RUN_SCAN_REGEX, (run) => {
    if (!hasPotentialBroadSyntax(run)) {
      return run;
    }

    const runLen = run.length;
    const hits = [];
    if (!hasBroadRunGroupChar(run)) {
      let subStart = 0;
      while (subStart < runLen) {
        const commaIdx = run.indexOf(',', subStart);
        const subEnd = commaIdx === -1 ? runLen : commaIdx;
        if (subEnd > subStart) {
          const hit = extractBroadFromSubSpan(run, subStart, subEnd);
          if (hit) hits.push(hit);
        }
        subStart = subEnd + 1;
      }
    } else {
      const { closeAt: charClassCloseAt } = findSegmentCharClasses(run, true);
      const braceCloseAt = new Int32Array(runLen).fill(-1);
      const isClosingBrace = new Uint8Array(runLen);
      const extParenCloseAt = new Int32Array(runLen).fill(-1);
      const isClosingExtParen = new Uint8Array(runLen);
      const braceStack = [];
      const parenStack = [];

      for (let j = 0; j < runLen; j += 1) {
        if (charClassCloseAt[j] !== -1) {
          j = charClassCloseAt[j];
          continue;
        }
        const ch = run[j];
        if (ch === '{') {
          braceStack.push(j);
        } else if (ch === '}' && braceStack.length > 0) {
          const openBrace = braceStack.pop();
          let crossed = false;
          while (parenStack.length > 0 && parenStack[parenStack.length - 1].open > openBrace) {
            parenStack.pop();
            crossed = true;
          }
          if (!crossed) {
            braceCloseAt[openBrace] = j;
            isClosingBrace[j] = 1;
          }
        } else if (ch === '(') {
          const prev = j > 0 ? run[j - 1] : '';
          const isExt =
            prev === '@' || prev === '+' || prev === '?' || prev === '!' || prev === '*';
          parenStack.push({ open: j, isExt });
        } else if (ch === ')' && parenStack.length > 0) {
          const topParen = parenStack.pop();
          let crossed = false;
          while (braceStack.length > 0 && braceStack[braceStack.length - 1] > topParen.open) {
            braceStack.pop();
            crossed = true;
          }
          if (!crossed && topParen.isExt && j > topParen.open + 1) {
            extParenCloseAt[topParen.open] = j;
            isClosingExtParen[j] = 1;
          }
        }
      }

      let activeBraceDepth = 0;
      let activeExtParenDepth = 0;
      let subStart = 0;
      for (let j = 0; j < runLen; j += 1) {
        if (charClassCloseAt[j] !== -1) {
          j = charClassCloseAt[j];
        }
        const ch = run[j];
        if (ch === '{' && braceCloseAt[j] !== -1) {
          activeBraceDepth += 1;
        } else if (ch === '}' && isClosingBrace[j] === 1 && activeBraceDepth > 0) {
          activeBraceDepth -= 1;
        } else if (ch === '(' && extParenCloseAt[j] !== -1) {
          activeExtParenDepth += 1;
        } else if (ch === ')' && isClosingExtParen[j] === 1 && activeExtParenDepth > 0) {
          activeExtParenDepth -= 1;
        } else if (ch === ',' && activeBraceDepth === 0 && activeExtParenDepth === 0) {
          if (j > subStart) {
            const hit = extractBroadFromSubSpan(run, subStart, j);
            if (hit) hits.push(hit);
          }
          subStart = j + 1;
        } else if (
          ch === ']' &&
          j + 1 < runLen &&
          run[j + 1] === '(' &&
          activeBraceDepth === 0 &&
          activeExtParenDepth === 0
        ) {
          const splitPos = j + 1;
          if (splitPos > subStart) {
            const hit = extractBroadFromSubSpan(run, subStart, splitPos);
            if (hit) hits.push(hit);
          }
          subStart = splitPos;
        }
      }
      if (runLen > subStart) {
        const hit = extractBroadFromSubSpan(run, subStart, runLen);
        if (hit) hits.push(hit);
      }
    }

    if (hits.length === 0) {
      return run;
    }

    let out = '';
    let cursor = 0;
    for (const { trimmed, maskStart, maskEnd } of hits) {
      if (!seenBroad.has(trimmed)) {
        seenBroad.add(trimmed);
        workspaceBroadDeps.push(trimmed);
      }
      out += run.slice(cursor, maskStart) + ' '.repeat(maskEnd - maskStart);
      cursor = maskEnd;
    }
    out += run.slice(cursor);
    return out;
  });
}

/**
 * Extract workspace file references, broad directory/glob exploration patterns,
 * and external URLs/standards/domains from prompt/topic/candidate/proof text inputs.
 *
 * @param {string|string[]} inputs
 * @param {{ structuredSources?: string|string[] }} [options]
 * @returns {{
 *   workspaceFileDeps: Array<{ source: string, startLine?: number, endLine?: number, unbounded?: boolean }>,
 *   workspaceBroadDeps: string[],
 *   externalDeps: string[]
 * }}
 */
export function extractVerificationDependencies(inputs, options = {}) {
  const strings = [];
  collectStrings(inputs, strings);

  const workspaceFileDeps = [];
  const fileDepState = new Map();
  let hasSupersededBounded = false;
  const addFileDep = (source, range) => {
    let state = fileDepState.get(source);
    if (state?.unbounded) {
      return;
    }
    if (!range) {
      if (state) {
        state.unbounded = true;
        state.ranges = null;
        hasSupersededBounded = true;
      } else {
        fileDepState.set(source, { unbounded: true, ranges: null });
      }
      workspaceFileDeps.push({ source, unbounded: true });
      return;
    }
    if (!state) {
      state = { unbounded: false, ranges: new Set() };
      fileDepState.set(source, state);
    }
    const key = `${range.startLine}:${range.endLine}`;
    if (!state.ranges.has(key)) {
      state.ranges.add(key);
      workspaceFileDeps.push({
        source,
        startLine: range.startLine,
        endLine: range.endLine
      });
    }
  };
  const workspaceBroadDeps = [];
  const seenBroad = new Set();
  const externalDeps = [];
  const seenExternal = new Set();

  const structuredList = [];
  const structuredTextSet = new Set();
  collectStrings(options?.structuredSources, structuredList);
  for (const rawStructured of structuredList) {
    const unwrapped = unwrapStructuredSource(rawStructured);
    if (!unwrapped) {
      continue;
    }
    if (isSingleExternalEndpointToken(unwrapped)) {
      const extKey = canonicalizeExternalDepKey(unwrapped);
      if (!seenExternal.has(extKey)) {
        seenExternal.add(extKey);
        externalDeps.push(unwrapped);
      }
    } else {
      structuredTextSet.add(unwrapped);
      strings.push(unwrapped);
    }
  }

  const uniqueStrings = strings.length > 1 ? Array.from(new Set(strings)) : strings;
  for (const text of uniqueStrings) {
    const isStructuredSource = structuredTextSet.has(text);
    // 0. Extract explicitly delimited single-token external URLs/endpoints first so
    //    embedded parentheses, brackets, `..`, and trailing punctuation stay verbatim.
    let masked =
      text.indexOf('.') !== -1 || text.indexOf(':') !== -1
        ? text.replace(EXPLICIT_DELIMITED_TOKEN_REGEX, (fullMatch, offset, sourceStr) => {
            const endOffset = offset + fullMatch.length;
            const prevChar = offset > 0 ? sourceStr[offset - 1] : '';
            const nextChar = endOffset < sourceStr.length ? sourceStr[endOffset] : '';
            if (
              (prevChar && /[A-Za-z0-9_/-]/.test(prevChar)) ||
              (nextChar && /[A-Za-z0-9_/-]/.test(nextChar))
            ) {
              return fullMatch;
            }
            const inner = fullMatch.slice(1, -1);
            if (!isSingleExternalEndpointToken(inner)) {
              return fullMatch;
            }
            const key = canonicalizeExternalDepKey(inner);
            if (!seenExternal.has(key)) {
              seenExternal.add(key);
              externalDeps.push(inner);
            }
            return ' '.repeat(fullMatch.length);
          })
        : text;

    // 1a. Extract external URI scheme URLs first and mask them so URL paths
    //     or embedded standard tokens are not misclassified or duplicated.
    if (masked.indexOf('://') !== -1) {
      masked = masked.replace(URL_REGEX, (rawUrl, ...args) => {
        const offset = args[args.length - 2];
        const sourceStr = args[args.length - 1];
        const cleaned = cleanProseEndpointToken(rawUrl, sourceStr, offset);
        if (!cleaned || /^[a-z][a-z0-9+.-]*:\/\/$/i.test(cleaned)) {
          return rawUrl;
        }
        const urlKey = `url:${cleaned}`;
        if (!seenExternal.has(urlKey)) {
          seenExternal.add(urlKey);
          externalDeps.push(cleaned);
        }
        return ' '.repeat(cleaned.length) + rawUrl.slice(cleaned.length);
      });
    }

    // 1b. Extract bare external endpoints with path/query/hash suffixes (and optional port)
    //     BEFORE ellipsis masking and glob matching so embedded `..` (e.g. `openapi.org/api?token=a..b`)
    //     and port-qualified wildcards (e.g. `openapi.org:443/api*`) stay intact.
    if (masked.indexOf('.') !== -1) {
      masked = masked.replace(BARE_DOMAIN_WITH_SUFFIX_REGEX, (rawDomain, ...args) => {
        const offset = args[args.length - 2];
        const sourceStr = args[args.length - 1];
        const cleaned = cleanProseEndpointToken(rawDomain, sourceStr, offset);
        const normalized = cleaned.trim();
        if (!normalized || isSemanticVersionToken(normalized) || !parseBareDomainEndpoint(normalized)) {
          return rawDomain;
        }
        const domainKey = canonicalizeExternalDepKey(normalized);
        if (!seenExternal.has(domainKey)) {
          seenExternal.add(domainKey);
          externalDeps.push(normalized);
        }
        return ' '.repeat(cleaned.length) + rawDomain.slice(cleaned.length);
      });
    }

    // 2. Mask ellipses (`...`, `..`) before glob/file/standard extraction, preserving exact sequence braces `{a..b}`.
    if (masked.indexOf('..') !== -1) {
      masked = masked.replace(
        /\{(?:-?\d+\.\.-?\d+(?:\.\.-?\d+)?|[A-Za-z]\.\.[A-Za-z](?:\.\.-?\d+)?)\}|\.{2,}/g,
        (m) => (m.startsWith('{') ? m : ' '.repeat(m.length))
      );
    }

    // 3. Extract broad workspace globs and directory references (`src/**`, `**/*.js`, `src/engine/`, `src/*[0-9].js`),
    //    leaving unprefixed bare domains with trailing slashes or wildcards intact for external detection.
    masked = extractAndMaskBroadWorkspaceDeps(masked, seenBroad, workspaceBroadDeps);

    // 4. Extract concrete workspace files BEFORE named external standards so file paths like
    //    `src/openapi.js` or `docs/rfc9110.md` are recorded as files and masked from standard matching.
    if (isStructuredSource || hasPotentialFileCandidateChar(masked)) {
      masked = masked.replace(FILE_CANDIDATE_REGEX, (full, lead, rawToken, startRaw, endRaw) => {
        const decision = classifyFileCandidate(rawToken, startRaw, endRaw, isStructuredSource, text);
        if (decision === 'leave') {
          return full;
        }
        if (decision === 'file') {
          const source = normalizeWorkspacePath(rawToken);
          if (startRaw !== undefined) {
            const startLine = Number.parseInt(startRaw, 10);
            const endLine = endRaw !== undefined ? Number.parseInt(endRaw, 10) : startLine;
            addFileDep(source, {
              startLine: Math.min(startLine, endLine),
              endLine: Math.max(startLine, endLine)
            });
          } else {
            addFileDep(source, null);
          }
        }
        return `${lead}${' '.repeat(full.length - lead.length)}`;
      });
    }

    // 5a. Extract complete bare external domains/endpoints BEFORE named standards so
    //     standard-prefixed hosts like `openapi.org/api*` or `ietf.org/api*` are not split.
    if (masked.indexOf('.') !== -1) {
      masked = masked.replace(BARE_DOMAIN_ENDPOINT_REGEX, (rawDomain, ...args) => {
        const offset = args[args.length - 2];
        const sourceStr = args[args.length - 1];
        const cleaned = cleanProseEndpointToken(rawDomain, sourceStr, offset);
        const normalized = cleaned.trim();
        if (!normalized || isSemanticVersionToken(normalized)) {
          return rawDomain;
        }
        const domainKey = canonicalizeExternalDepKey(normalized);
        if (!seenExternal.has(domainKey)) {
          seenExternal.add(domainKey);
          externalDeps.push(normalized);
        }
        return ' '.repeat(cleaned.length) + rawDomain.slice(cleaned.length);
      });
    }

    // 5b. Extract named external standards/identifiers across remaining non-domain text
    //     before version tokens are ignored so `OpenAPI 3.1.0` stays intact.
    masked = masked.replace(NAMED_EXTERNAL_STANDARD_REGEX, (rawStd, ...args) => {
      const offset = args[args.length - 2];
      const sourceStr = args[args.length - 1];
      const normalized = cleanProseEndpointToken(rawStd, sourceStr, offset).replace(/\s+/g, ' ').trim();
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

  for (const rawInputStr of uniqueStrings) {
    if (!rawInputStr || typeof rawInputStr !== 'string') {
      continue;
    }
    const proseCommandDeps = extractProseCommandAndRepoDeps(rawInputStr);
    for (const dep of proseCommandDeps) {
      if (dep && !seenBroad.has(dep)) {
        seenBroad.add(dep);
        workspaceBroadDeps.push(dep);
      }
    }
  }

  const finalFileDeps = hasSupersededBounded
    ? workspaceFileDeps.filter((item) => item.unbounded || !fileDepState.get(item.source)?.unbounded)
    : workspaceFileDeps;

  return {
    workspaceFileDeps: finalFileDeps,
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

function appendProofTexts(list, texts, structuredSources = []) {
  if (!Array.isArray(list)) return;
  for (const proof of list) {
    if (proof?.scope) texts.push(String(proof.scope));
    if (proof?.statement) texts.push(String(proof.statement));
    if (proof?.judgeAdmittedStatement) texts.push(String(proof.judgeAdmittedStatement));
    if (proof?.source) structuredSources.push(String(proof.source));
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
  if ((phase === 'DELIBERATION' || (phase === 'JUDGE_AUDIT_SYNTHESIS' && Number(round) > 1)) && Array.isArray(previousCandidate?.clauses)) {
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
  const structuredSources = [];
  if (typeof topic === 'string' && topic.trim()) {
    texts.push(topic);
  }
  if (Array.isArray(clarifications)) {
    for (const c of clarifications) {
      if (typeof c === 'string' && c.trim()) {
        texts.push(c);
      } else if (c && typeof c === 'object') {
        if (c.question) texts.push(String(c.question));
        if (c.source) structuredSources.push(String(c.source));
        if (c.label) texts.push(String(c.label));
        if (c.text) texts.push(String(c.text));
        if (c.answer) {
          const rawAnswer = String(c.answer).trimEnd();
          const syntheticDiscoveryAnswerTrimEnd =
            typeof c.label === 'string' && typeof c.text === 'string'
              ? `[${c.label.trim()}] (Source: ${String(c.source || '').trim()}): ${c.text.trimEnd()}`
              : null;
          const syntheticDiscoveryAnswerTrim =
            typeof c.label === 'string' && typeof c.text === 'string'
              ? `[${c.label.trim()}] (Source: ${String(c.source || '').trim()}): ${c.text.trim()}`
              : null;
          if (
            !syntheticDiscoveryAnswerTrimEnd ||
            (rawAnswer !== syntheticDiscoveryAnswerTrimEnd && rawAnswer !== syntheticDiscoveryAnswerTrim)
          ) {
            texts.push(String(c.answer));
          }
        }
      }
    }
  }
  if ((phase === 'DELIBERATION' || (phase === 'JUDGE_AUDIT_SYNTHESIS' && Number(round) > 1)) && previousCandidate && typeof previousCandidate === 'object') {
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
  appendProofTexts(proofs, texts, structuredSources);
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
    appendProofTexts(resolvedBacking, texts, structuredSources);
  }
  if (phase === 'VOTING') {
    appendProofTexts(admittedProofs, texts, structuredSources);
  }
  return { texts, structuredSources };
}

function augmentProofDependencies(proofList, deps) {
  if (!Array.isArray(proofList)) return;
  const seenBroad = new Set(deps.workspaceBroadDeps);
  for (const proof of proofList) {
    if (!proof || typeof proof !== 'object') continue;
    const originalSource = typeof proof.source === 'string' ? proof.source.trim() : '';
    const unwrappedSource = unwrapStructuredSource(originalSource);
    const rawStatement = typeof proof.statement === 'string' ? proof.statement.trim() : '';
    const rawAdmittedStatement =
      typeof proof.judgeAdmittedStatement === 'string' ? proof.judgeAdmittedStatement.trim() : '';
    const sourceDeps = originalSource
      ? extractVerificationDependencies([], { structuredSources: [originalSource] })
      : null;
    const isSingleTokenSource = Boolean(unwrappedSource && !/\s/.test(unwrappedSource));
    const sourceHasConcreteFile = Boolean(
      isSingleTokenSource &&
      sourceDeps &&
      sourceDeps.workspaceFileDeps.length === 1 &&
      sourceDeps.workspaceBroadDeps.length === 0 &&
      sourceDeps.externalDeps.length === 0
    );
    const sourceIsSingleExternalEndpoint = Boolean(
      isSingleTokenSource &&
      sourceDeps &&
      sourceDeps.externalDeps.length === 1 &&
      sourceDeps.workspaceFileDeps.length === 0 &&
      sourceDeps.workspaceBroadDeps.length === 0 &&
      isSingleExternalEndpointToken(unwrappedSource)
    );

    if (proof.kind === 'benchmark') {
      if (
        unwrappedSource &&
        !sourceHasConcreteFile &&
        !deps.externalDeps.some((d) => externalSourcesMatch(d, unwrappedSource)) &&
        !seenBroad.has(unwrappedSource) &&
        !seenBroad.has(originalSource)
      ) {
        deps.externalDeps.push(unwrappedSource);
      }
      continue;
    }

    if (proof.kind === 'check') {
      // Check command/repo patterns against originalSource BEFORE delimiter unwrapping so
      // quoted/backticked commands (e.g. `` `ls` ``, `"uname -a"`, `'cat README'`) preserve their command veto.
      const trimmedOriginalSource = originalSource ? originalSource.trim() : '';
      const isQuoteOrBacktickWrapped = Boolean(
        trimmedOriginalSource.length >= 2 &&
          ((trimmedOriginalSource.startsWith('"') && trimmedOriginalSource.endsWith('"')) ||
            (trimmedOriginalSource.startsWith("'") && trimmedOriginalSource.endsWith("'")) ||
            (trimmedOriginalSource.startsWith('`') && trimmedOriginalSource.endsWith('`')))
      );
      const sourceTextToInspect = unwrappedSource || trimmedOriginalSource;
      const sourceIsPureNamedStandard = (() => {
        if (!sourceTextToInspect || hasCheckCommandOrRepoDependency(sourceTextToInspect)) {
          return false;
        }
        const singleDeps = extractVerificationDependencies([sourceTextToInspect]);
        return (
          singleDeps.workspaceFileDeps.length === 0 &&
          singleDeps.workspaceBroadDeps.length === 0 &&
          singleDeps.externalDeps.length === 1 &&
          singleDeps.externalDeps[0].toLowerCase() === sourceTextToInspect.trim().toLowerCase()
        );
      })();
      const hasCliOperatorOrFlagInSource = Boolean(
        sourceTextToInspect &&
          /(?:&&|\|\||[;|><`]|\s-{1,2}[A-Za-z0-9]|\$\(|\\[A-Za-z0-9"']|\.\.?\/(?:[^\s]+\.(?:sh|bash|zsh|fish|ps1|bat|cmd|command)|(?:[^\s]*\/)?(?:gradlew|mvnw|configure))\b)/i.test(
            sourceTextToInspect
          )
      );
      const isSourceCliInvocation = Boolean(
        sourceTextToInspect &&
          /^(?:pwd|env|ps|df|du|id|which|echo|printf|find|head|tail|stat|diff|sort|cut|file|command)\b(?:\s+|$)/i.test(
            sourceTextToInspect.trim()
          )
      );
      const isExecutableScriptSource = Boolean(
        trimmedOriginalSource && SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(sourceTextToInspect.trim())
      );
      const sourceIsCommandOrRepo =
        Boolean(originalSource) &&
        (isExecutableScriptSource ||
          (!sourceHasConcreteFile &&
            !sourceIsSingleExternalEndpoint &&
            (hasCheckCommandOrRepoDependency(originalSource) ||
              (Boolean(unwrappedSource) && hasCheckCommandOrRepoDependency(unwrappedSource)) ||
              isSourceCliInvocation ||
              ((isQuoteOrBacktickWrapped || hasCliOperatorOrFlagInSource) &&
                !sourceIsPureNamedStandard))));
      const statementMatch = [rawStatement, rawAdmittedStatement].find(
        (s) => s && hasCheckCommandOrRepoDependency(s)
      );
      const statementIsCommandOrRepo = Boolean(statementMatch);
      if (sourceIsCommandOrRepo || statementIsCommandOrRepo) {
        const label = sourceIsCommandOrRepo ? originalSource : statementMatch.slice(0, 80);
        if (label && !seenBroad.has(label)) {
          seenBroad.add(label);
          deps.workspaceBroadDeps.push(label);
        }
      }
      if (
        unwrappedSource &&
        !sourceHasConcreteFile &&
        !sourceIsCommandOrRepo &&
        (!sourceDeps || sourceDeps.externalDeps.length === 0) &&
        !deps.externalDeps.some((d) => externalSourcesMatch(d, unwrappedSource)) &&
        !seenBroad.has(unwrappedSource) &&
        !seenBroad.has(originalSource) &&
        CHECK_EXTERNAL_SOURCE_REGEX.test(unwrappedSource)
      ) {
        deps.externalDeps.push(unwrappedSource);
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
  if (!trimmed || /\s/.test(trimmed) || isUrlExternalSource(trimmed)) {
    return null;
  }
  const delimMatch = /[/?#]/.exec(trimmed);
  const authority = delimMatch ? trimmed.slice(0, delimMatch.index) : trimmed;
  const suffix = delimMatch ? trimmed.slice(delimMatch.index) : '';
  const portMatch = delimMatch ? /^(.*):(\d{1,5})$/.exec(authority) : /^(.*):(\d{2,5})$/.exec(authority);
  let host = authority;
  if (portMatch) {
    const portNum = Number.parseInt(portMatch[2], 10);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return null;
    }
    host = portMatch[1];
  }
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
  const prevCache = activeReadinessCache;
  activeReadinessCache = prevCache || {
    shellCmd: new Map(),
    outerClauses: new Map(),
    cmdSubs: new Map(),
    delimSpans: new Map()
  };
  try {
    return evaluateToolFreeEvidenceReadinessCore(params);
  } finally {
    activeReadinessCache = prevCache;
  }
}

function evaluateToolFreeEvidenceReadinessCore(params = {}) {
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
  const { texts, structuredSources } = collectPhasePromptTexts({
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
  const deps = extractVerificationDependencies(texts, { structuredSources });

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
  const boundedMessage = boundSingleLineFaultMessage(error?.message);
  const primaryFaultBase = boundedMessage || resolvedErrorClass;
  const primaryFaultReason = `${primaryFaultBase}${formatErrorDiagnosticSuffix(error, primaryFaultBase)}`;

  // Step 1: non-retryable
  if (!isRetryable) {
    const nonRetryableBase = boundedMessage || `Non-retryable ${resolvedErrorClass}`;
    return {
      canRetry: false,
      terminationKind: 'non_retryable',
      reason: `${nonRetryableBase}${formatErrorDiagnosticSuffix(error, nonRetryableBase)}`,
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
