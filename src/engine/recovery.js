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
  'type'
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

function stripShellBinPrefix(word) {
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
  const n = text.length;
  if (!text || !text.includes('$(')) {
    return { closedFrames: [], topLevelClosed: [] };
  }
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

  return { closedFrames, topLevelClosed };
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

const PROSE_POST_COMPARISON_WORDS = new Set([
  'and', 'or', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'should', 'must',
  'will', 'can', 'may', 'does', 'do', 'while', 'when', 'where', 'if', 'unless',
  'until', 'before', 'after', 'for', 'in', 'with', 'because', 'since'
]);

const COMPARISON_UNIT_WORDS = new Set([
  'ms', 's', 'sec', 'secs', 'us', 'ns', 'm', 'min', 'mins', 'h', 'hr', 'hrs', 'd',
  'b', 'kb', 'mb', 'gb', 'tb', 'kib', 'mib', 'gib', 'hz', 'khz', 'mhz', 'ghz',
  'fps', 'rps', 'qps', 'tps'
]);

function isShellStarterVerbLower(lower) {
  return (
    SHELL_SPLIT_QUOTE_VERBS.has(lower) ||
    SHELL_FLAG_OR_PATH_CLI_VERBS.has(lower) ||
    SHELL_COMPOUND_ZERO_ARG_VERBS.has(lower) ||
    SHELL_WRAPPER_WORD_SET.has(lower)
  );
}

function isFollowedByComparisonOpAt(text, pos, n) {
  let q = pos;
  while (q < n && /[ \t]/.test(text[q])) {
    q += 1;
  }
  if (q >= n) {
    return false;
  }
  const two = text.slice(q, q + 2);
  if (two === '>=' || two === '<=' || two === '->' || two === '=>' || two === '<-') {
    return true;
  }
  if ((text[q] === '<' || text[q] === '>') && q + 1 < n) {
    let d = q + 1;
    while (d < n && /[ \t]/.test(text[d])) {
      d += 1;
    }
    return d < n && /^(?:[+-]?\d|v\d)/i.test(text.slice(d, Math.min(n, d + 4)));
  }
  return false;
}

function isLikelyShellTokenAt(text, pos, n) {
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
    if (VERSIONED_RUNTIME_NOUNS.has(lowerTok) && rawTok === cleanTok && isFollowedByComparisonOpAt(text, end, n)) {
      return false;
    }
    if (lowerTok === 'git' && rawTok === cleanTok && isFollowedByComparisonOpAt(text, end, n)) {
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
  segHardStarterCount,
  hasPriorComparisonContext
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
  let afterTargetPos = nextPos;
  while (afterTargetPos < n && /[ \t]/.test(text[afterTargetPos])) {
    afterTargetPos += 1;
  }
  const targetLast = targetRaw[targetRaw.length - 1];
  const targetEndsSentence =
    (targetLast === '.' || targetLast === '!' || targetLast === '?') && targetClean !== targetRaw;
  if (!targetEndsSentence && afterTargetPos < n && isLikelyShellTokenAt(text, afterTargetPos, n)) {
    return false;
  }
  const isRuntimeStarter = SHELL_KNOWN_LOWER_STARTERS.has(prevLower) || SHELL_WRAPPER_WORD_SET.has(prevLower);
  if (isRuntimeStarter) {
    if (
      !VERSIONED_RUNTIME_NOUNS.has(prevLower) ||
      !/^(?:[+-]?\d+(?:\.\d+)*(?:-(?:alpha|beta|rc)(?:\.\d+)?)?|v\d+(?:\.\d+)*(?:-(?:alpha|beta|rc)(?:\.\d+)?)?)$/i.test(
        targetClean
      )
    ) {
      return false;
    }
    let hasAffirmativeProseContext = hasPriorComparisonContext;
    if (!hasAffirmativeProseContext && targetRaw.endsWith(',') && afterTargetPos < n) {
      hasAffirmativeProseContext = !isLikelyShellTokenAt(text, afterTargetPos, n);
    }
    if (!hasAffirmativeProseContext && afterTargetPos < n) {
      let wEnd = afterTargetPos;
      const wLimit = Math.min(n, afterTargetPos + 32);
      while (wEnd < wLimit && !/[\s;|&<>(),.;:!?]/.test(text[wEnd])) {
        wEnd += 1;
      }
      if (wEnd > afterTargetPos) {
        const nextW = text.slice(afterTargetPos, wEnd);
        if (!/["'\\=]/.test(nextW) && PROSE_POST_COMPARISON_WORDS.has(nextW.toLowerCase())) {
          let afterConnPos = wEnd;
          while (afterConnPos < n && /[ \t]/.test(text[afterConnPos])) {
            afterConnPos += 1;
          }
          if (
            afterConnPos < n &&
            !/[\r\n;|&)]/.test(text[afterConnPos]) &&
            !isLikelyShellTokenAt(text, afterConnPos, n)
          ) {
            hasAffirmativeProseContext = true;
          }
        }
      }
    }
    if (!hasAffirmativeProseContext) {
      return false;
    }
  } else if (
    !/^(?:[+-]?\d+(?:\.\d+)*(?:%|ms|s|sec|secs|us|ns|m|min|mins|h|hr|hrs|d|b|kb|mb|gb|tb|kib|mib|gib|k|x|px|rem|em|vh|vw|hz|khz|mhz|ghz|fps|rps|qps|tps)?|v\d+(?:\.\d+)*)$/i.test(
      targetClean
    )
  ) {
    return false;
  }
  return true;
}

function parseShellClausesLinear(text) {
  const n = text.length;
  const clauses = [];
  let current = {
    tokens: [],
    hasRedirection: false,
    isFunctionWrap: false,
    pipedIn: false,
    pipedOut: false,
    logicalChain: false
  };
  let pendingRedir = false;
  let pendingSkippedAngleTag = false;
  let skippedOpenTags = null;
  let lastCloseTagPosMap = undefined;
  let segTokenCount = 0;
  let segHardStarterCount = 0;
  let pendingQuotedVerbIdx = -1;
  let pendingUnquotedVerbIdx = -1;
  let awaitingComparisonRhs = false;
  let awaitingVersionRhs = false;
  let rhsCompletedComparison = false;
  let rhsCompletedVersionComparison = false;
  let afterComparisonConj = false;
  let tokenFollowsComparisonConj = false;
  let commaAfterAnyComparisonRhs = false;
  let commaAfterVersionRhs = false;
  let commaConjReady = false;
  const resetSegmentState = () => {
    segTokenCount = 0;
    segHardStarterCount = 0;
    pendingQuotedVerbIdx = -1;
    pendingUnquotedVerbIdx = -1;
    awaitingComparisonRhs = false;
    awaitingVersionRhs = false;
    rhsCompletedComparison = false;
    rhsCompletedVersionComparison = false;
    afterComparisonConj = false;
    tokenFollowsComparisonConj = false;
  };
  const clearCommaComparisonState = () => {
    commaAfterAnyComparisonRhs = false;
    commaAfterVersionRhs = false;
    commaConjReady = false;
  };
  const markSegmentRedir = (targetEndsSentence) => {
    clearCommaComparisonState();
    if (targetEndsSentence) {
      resetSegmentState();
    } else {
      awaitingComparisonRhs = false;
      awaitingVersionRhs = false;
      rhsCompletedComparison = false;
      rhsCompletedVersionComparison = false;
      afterComparisonConj = false;
      tokenFollowsComparisonConj = false;
      if (current.tokens.length > 0 && !current.tokens[current.tokens.length - 1].hasUnquotedTrailingPunct) {
        segHardStarterCount += 1;
        pendingQuotedVerbIdx = -1;
        pendingUnquotedVerbIdx = -1;
      }
    }
  };
  const noteSkippedComparison = (lhsTok) => {
    awaitingComparisonRhs = true;
    awaitingVersionRhs = Boolean(lhsTok && VERSIONED_RUNTIME_NOUNS.has(lhsTok.trimmedClean.toLowerCase()));
    rhsCompletedComparison = false;
    rhsCompletedVersionComparison = false;
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
          while (end < n && /[A-Za-z0-9-]/.test(text[end])) {
            end += 1;
          }
          if (end > pos + 2 && end < n && text[end] === '>' && /[A-Za-z]/.test(text[pos + 2])) {
            lastCloseTagPosMap.set(text.slice(pos + 2, end).toLowerCase(), pos);
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

  const pushClause = () => {
    if (current.tokens.length > 0 || current.hasRedirection) {
      clauses.push(current);
    }
    current = {
      tokens: [],
      hasRedirection: false,
      isFunctionWrap: false,
      pipedIn: false,
      pipedOut: false,
      logicalChain: false
    };
    pendingRedir = false;
    pendingSkippedAngleTag = false;
    skippedOpenTags = null;
    resetSegmentState();
    clearCommaComparisonState();
  };

  while (i < n) {
    while (i < n && /[ \t\r\v\f]/.test(text[i])) {
      i += 1;
    }
    if (i >= n) {
      break;
    }
    const ch = text[i];

    // Clause separators: &&, ||, ;, |, \n
    if (ch === '\n' || ch === ';') {
      pushClause();
      i += 1;
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
        i += i + 2 < n && text[i + 2] === '>' ? 3 : 2;
        while (i < n && /[ \t]/.test(text[i])) i += 1;
        const targetStart = i;
        while (i < n && !/[\s;|&<>()]/.test(text[i])) {
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
      pushClause();
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
        fdLen = k - i;
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
          }
          noteSkippedComparison(lhsTok);
          i = opPos + (opPos + 2 < n && text[opPos + 2] === '>' ? 3 : 2);
          continue;
        }
        if (opChar === '>' && opPos > 0 && (text[opPos - 1] === '=' || text[opPos - 1] === '-')) {
          let lhsTok = current.tokens.length > 0 ? current.tokens[current.tokens.length - 1] : null;
          if (lhsTok) {
            lhsTok.hadSkippedComparison = true;
            if ((lhsTok.raw === '-' || lhsTok.raw === '=') && !lhsTok.wasQuoted && current.tokens.length >= 2) {
              lhsTok = current.tokens[current.tokens.length - 2];
              lhsTok.hadSkippedComparison = true;
            }
          }
          noteSkippedComparison(lhsTok);
          i = opPos + 1;
          continue;
        }
        if (opChar === '<' && opPos + 1 < n && text[opPos + 1] === '-') {
          const lhsTok = current.tokens.length > 0 ? current.tokens[current.tokens.length - 1] : null;
          if (lhsTok) {
            lhsTok.hadSkippedComparison = true;
          }
          noteSkippedComparison(lhsTok);
          i = opPos + 2;
          continue;
        }
        if (
          opChar === '<' &&
          opPos + 1 < n &&
          /[A-Za-z/!?]/.test(text[opPos + 1]) &&
          (opPos === 0 || /[\s([,;:"']/.test(text[opPos - 1]))
        ) {
          let tagEnd = -1;
          const limit = Math.min(n, opPos + 64);
          for (let q = opPos + 1; q < limit; q += 1) {
            const tc = text[q];
            if (tc === '>') {
              tagEnd = q;
              break;
            }
            if (/[\s;|&<()"']/.test(tc)) {
              break;
            }
          }
          if (tagEnd !== -1) {
            const tagInner = text.slice(opPos + 1, tagEnd);
            const afterIdx = tagEnd + 1;
            let targetProbe = afterIdx;
            while (targetProbe < n && /[ \t]/.test(text[targetProbe])) {
              targetProbe += 1;
            }
            const hasActiveStarter =
              segHardStarterCount > 0 ||
              pendingQuotedVerbIdx !== -1 ||
              (pendingUnquotedVerbIdx !== -1 && !current.tokens[pendingUnquotedVerbIdx].hadSkippedComparison);
            const isAutoOrSpecial =
              tagInner.length > 0 &&
              (tagInner[0] === '!' ||
                tagInner[0] === '?' ||
                (tagInner.length > 1 && tagInner[tagInner.length - 1] === '/') ||
                /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(tagInner) ||
                /^mailto:/i.test(tagInner));
            let hasNoOutputTarget =
              afterIdx >= n ||
              /[;\r\n)}\]]/.test(text[afterIdx]) ||
              (targetProbe > afterIdx && (targetProbe >= n || /[;)\]}|&<>\r\n]/.test(text[targetProbe])));
            if (!hasNoOutputTarget && afterIdx < n && /[.,:!?]/.test(text[afterIdx])) {
              if (afterIdx + 1 >= n || /[\s)\]}]/.test(text[afterIdx + 1])) {
                if (text[afterIdx] === '.' || text[afterIdx] === '!' || text[afterIdx] === '?') {
                  hasNoOutputTarget = true;
                } else if (!hasActiveStarter) {
                  let afterPunct = afterIdx + 1;
                  while (afterPunct < n && /[ \t]/.test(text[afterPunct])) {
                    afterPunct += 1;
                  }
                  if (afterPunct >= n || !isLikelyShellTokenAt(text, afterPunct, n)) {
                    hasNoOutputTarget = true;
                  }
                }
              }
            }
            const isMatchedCloseTag =
              tagInner.length > 1 &&
              tagInner[0] === '/' &&
              /^\/[A-Za-z][A-Za-z0-9-]*$/.test(tagInner) &&
              Boolean(skippedOpenTags?.has(tagInner.slice(1).toLowerCase()));
            let isPairedHtmlOpenTag = false;
            let isProsePlaceholderTag = false;
            if (!isAutoOrSpecial && !hasNoOutputTarget && !isMatchedCloseTag && !hasActiveStarter) {
              if (/^[A-Za-z][A-Za-z0-9-]*$/.test(tagInner) && !KNOWN_PATH_EXTENSIONLESS_FILES.has(tagInner)) {
                const tagLower = tagInner.toLowerCase();
                if (getLastCloseTagPos(tagLower) > tagEnd) {
                  let pairedTargetLooksShell = false;
                  if (targetProbe > afterIdx && targetProbe < n) {
                    pairedTargetLooksShell = isLikelyShellTokenAt(text, targetProbe, n);
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
                        if (afterW < n && isLikelyShellTokenAt(text, afterW, n)) {
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
                        isProsePlaceholderTag = afterQ >= n || !isLikelyShellTokenAt(text, afterQ, n);
                      }
                    } else if (text[afterPost] === '<') {
                      isProsePlaceholderTag = afterPost + 1 < n && /[a-z/]/.test(text[afterPost + 1]);
                    } else {
                      isProsePlaceholderTag = !isLikelyShellTokenAt(text, afterPost, n);
                    }
                  }
                }
              }
            }
            if (isAutoOrSpecial || hasNoOutputTarget || isMatchedCloseTag || isPairedHtmlOpenTag || isProsePlaceholderTag) {
              if (isPairedHtmlOpenTag) {
                if (!skippedOpenTags) {
                  skippedOpenTags = new Set();
                }
                skippedOpenTags.add(tagInner.toLowerCase());
              }
              pendingSkippedAngleTag = true;
              i = tagEnd + 1;
              continue;
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
          markRedir(fdEndsSentence);
          i = nextPos;
          continue;
        }
      }
      const targetStart = nextPos;
      while (nextPos < n && !/[\s;|&<>()]/.test(text[nextPos])) {
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
      const hasPriorComparisonContext =
        tokenFollowsComparisonConj ||
        (commaAfterVersionRhs && segTokenCount === 1) ||
        (commaConjReady && segTokenCount === 2);
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
          segHardStarterCount,
          hasPriorComparisonContext
        )
      ) {
        const lhsTok = current.tokens[current.tokens.length - 1];
        lhsTok.hadSkippedComparison = true;
        noteSkippedComparison(lhsTok);
        i = opPos + 1;
        continue;
      }
      const targetLast = targetRaw[targetRaw.length - 1];
      const targetEndsSentence =
        !targetLastEscaped &&
        (targetLast === '.' || targetLast === '!' || targetLast === '?') &&
        targetClean !== targetRaw;
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

    while (i < n && !/[\s;|&<>()]/.test(text[i])) {
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
        let closeDq = -1;
        for (let k = i + 1; k < n; k += 1) {
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
        for (let k = i + 1; k < closeDq; k += 1) {
          if (text[k] === '\\' && k + 1 < closeDq && (text[k + 1] === '"' || text[k + 1] === '\\' || text[k + 1] === '$')) {
            value += text[k + 1];
            k += 1;
          } else {
            value += text[k];
          }
        }
        unprotectedSuffixStart = value.length;
        lastCharWasEscaped = false;
        i = closeDq + 1;
        continue;
      }
      if (c === "'") {
        const precededByAlphaNum = i > tokenStart && /[A-Za-z0-9]/.test(text[i - 1]);
        const followedByAlphaNum = i + 1 < n && /[A-Za-z0-9]/.test(text[i + 1]);
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
        if (precededByAlphaNum && !followedByAlphaNum && i + 1 < n && /[\s,.;:!?)]/.test(text[i + 1])) {
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
      value += c;
      lastCharWasEscaped = false;
      i += 1;
    }

    if (i === tokenStart) {
      i += 1;
      continue;
    }
    const raw = text.slice(tokenStart, i);
    const unprotectedTail = value.slice(unprotectedSuffixStart);
    const unprotectedTailClean = stripTrailingProsePunct(unprotectedTail);
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
      /^[A-Za-z_][A-Za-z0-9_]*=[^\s]*$/.test(resolvedClean);
    const tokObj = {
      raw,
      value,
      trimmedClean: resolvedClean,
      wasQuoted,
      hasPaddingSpaces,
      hasTrailingProsePunct,
      hasUnquotedTrailingPunct,
      hadSkippedComparison: false,
      isEnvAssign: hasRawEq || isQuotedEnvAssign,
      precededByRedir: pendingRedir,
      precededByAngleTag: pendingSkippedAngleTag,
      followedByRedir: false
    };
    const tokIdx = current.tokens.length;
    const isArrowPrefixToken = !wasQuoted && (raw === '-' || raw === '=') && i < n && text[i] === '>';
    if (pendingQuotedVerbIdx !== -1) {
      if (!tokObj.wasQuoted && PROSE_LIST_FOLLOWERS.has(tokObj.trimmedClean.toLowerCase())) {
        pendingQuotedVerbIdx = -1;
      } else {
        segHardStarterCount += 1;
        pendingQuotedVerbIdx = -1;
      }
    }
    if (pendingUnquotedVerbIdx !== -1 && !isArrowPrefixToken) {
      if (!current.tokens[pendingUnquotedVerbIdx].hadSkippedComparison) {
        segHardStarterCount += 1;
      }
      pendingUnquotedVerbIdx = -1;
    }
    current.tokens.push(tokObj);
    const wasAwaitingComparisonRhs = awaitingComparisonRhs;
    const wasAwaitingVersionRhs = awaitingVersionRhs;
    const prevRhsCompleted = rhsCompletedComparison;
    const prevRhsVersionCompleted = rhsCompletedVersionComparison;
    awaitingComparisonRhs = false;
    awaitingVersionRhs = false;
    if (tokObj.hasUnquotedTrailingPunct) {
      const strippedPunct = unprotectedTail.slice(unprotectedTailClean.length);
      const unitAfterRhs =
        prevRhsCompleted &&
        !tokObj.wasQuoted &&
        (unprotectedTailClean === '' || COMPARISON_UNIT_WORDS.has(unprotectedTailClean.toLowerCase()));
      resetSegmentState();
      if (strippedPunct === ',' && (wasAwaitingComparisonRhs || unitAfterRhs)) {
        commaAfterAnyComparisonRhs = true;
        commaAfterVersionRhs = wasAwaitingVersionRhs || (unitAfterRhs && prevRhsVersionCompleted);
        commaConjReady = false;
      } else {
        clearCommaComparisonState();
      }
    } else if (!isArrowPrefixToken) {
      const tokLower = stripShellBinPrefix(tokObj.trimmedClean).toLowerCase();
      if (wasAwaitingComparisonRhs) {
        rhsCompletedComparison = true;
        rhsCompletedVersionComparison = wasAwaitingVersionRhs;
        afterComparisonConj = false;
        tokenFollowsComparisonConj = false;
        clearCommaComparisonState();
      } else if (prevRhsCompleted) {
        if (!tokObj.wasQuoted && COMPARISON_UNIT_WORDS.has(tokLower)) {
          rhsCompletedComparison = true;
          rhsCompletedVersionComparison = prevRhsVersionCompleted;
        } else if (!tokObj.wasQuoted && (tokLower === 'and' || tokLower === 'or')) {
          rhsCompletedComparison = false;
          rhsCompletedVersionComparison = false;
          afterComparisonConj = true;
          tokenFollowsComparisonConj = false;
        } else {
          rhsCompletedComparison = false;
          rhsCompletedVersionComparison = false;
          afterComparisonConj = false;
          tokenFollowsComparisonConj = false;
        }
      } else if (afterComparisonConj) {
        afterComparisonConj = false;
        tokenFollowsComparisonConj = !tokObj.wasQuoted;
      } else {
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
        commaAfterVersionRhs = false;
        if (commaConjReady && tokObj.wasQuoted) {
          commaConjReady = false;
        }
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
        tokObj.raw.includes('\\') ||
        SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(tokObj.trimmedClean)
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
  return clauseLooksLikeShellCommandFrom(clause, 0, isCompound, options).matched;
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
  const clauses = parseShellClausesLinear(normalized);
  const isCompound = clauses.length > 1;
  for (let c = 0; c < clauses.length; c += 1) {
    if (clauseLooksLikeShellCommand(clauses[c], isCompound, options)) {
      return true;
    }
  }
  return false;
}

function scanShellCommandText(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  if (REPO_WIDE_OR_RUN_PHRASE_REGEX.test(text)) {
    return true;
  }
  if (text.includes('`')) {
    const btNorm = normalizeInlineEscapedQuotes(text).replace(/\\`/g, '`');
    const bn = btNorm.length;
    let noMoreSq = false;
    let noMoreBt = false;
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
      if (ch === '`' && !noMoreBt) {
        const closeBt = btNorm.indexOf('`', i + 1);
        if (closeBt === -1) {
          noMoreBt = true;
          continue;
        }
        const btInner = btNorm.slice(i + 1, closeBt).trim();
        if (btInner) {
          if (!outerHasVerbChecked) {
            outerHasVerbChecked = true;
            const prefix = btNorm.slice(0, i).trim();
            if (prefix) {
              const pClauses = parseShellClausesLinear(prefix);
              const lastP = pClauses[pClauses.length - 1];
              const leadP = lastP?.tokens?.[0];
              if (leadP) {
                const lp = stripShellBinPrefix(leadP.trimmedClean).toLowerCase();
                outerSubCmdCtx =
                  leadP.isEnvAssign ||
                  lastP.hasRedirection ||
                  SHELL_SPLIT_QUOTE_VERBS.has(lp) ||
                  SHELL_COMPOUND_ZERO_ARG_VERBS.has(lp) ||
                  lp === 'echo' ||
                  lp === 'printf';
              }
            }
          }
          if (scanFlatShellClauses(btInner, { isSubshellOrSubCmd: outerSubCmdCtx, strictProseMode: false, skipQuoteNorm: true })) {
            return true;
          }
        }
        i = closeBt;
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

function scanDelimitedShellSpans(rawText, { includeBackticks = false, includeBareScript = false, stopOnFirst = true } = {}) {
  const n = rawText.length;
  let masked = '';
  let cursor = 0;
  let noMoreDouble = false;
  let noMoreSingle = false;
  let noMoreBacktick = false;
  const matchedDeps = [];
  const seenMatched = new Set();
  const pushMatched = (dep) => {
    if (dep && !seenMatched.has(dep)) {
      seenMatched.add(dep);
      matchedDeps.push(dep);
    }
  };

  for (let i = 0; i < n; i += 1) {
    const ch = rawText[i];
    if (ch !== '"' && ch !== "'" && (!includeBackticks || ch !== '`')) {
      continue;
    }
    if (i > 0 && /[A-Za-z0-9_./\\-]/.test(rawText[i - 1])) {
      if (ch === '`') {
        continue;
      }
      if (ch === "'") {
        if (!noMoreSingle) {
          let endSq = -1;
          for (let k = i + 1; k < n; k += 1) {
            if (rawText[k] === "'") {
              const isInternalApostrophe =
                /[A-Za-z0-9]/.test(rawText[k - 1]) && k + 1 < n && /[A-Za-z0-9]/.test(rawText[k + 1]);
              if (!isInternalApostrophe) {
                endSq = k;
                break;
              }
            }
          }
          if (endSq === -1) {
            noMoreSingle = true;
          } else {
            i = endSq;
          }
        }
        continue;
      }
      if (ch === '"' && !noMoreDouble) {
        let endDq = -1;
        for (let k = i + 1; k < n; k += 1) {
          if (rawText[k] === '\\') {
            k += 1;
            continue;
          }
          if (rawText[k] === '"') {
            endDq = k;
            break;
          }
        }
        if (endDq === -1) {
          noMoreDouble = true;
        } else {
          i = endDq;
        }
      }
      continue;
    }
    if ((ch === '"' && noMoreDouble) || (ch === "'" && noMoreSingle) || (ch === '`' && noMoreBacktick)) {
      continue;
    }

    let closeIdx = -1;
    if (ch === '"') {
      for (let k = i + 1; k < n; k += 1) {
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
    } else if (ch === "'") {
      for (let k = i + 1; k < n; k += 1) {
        if (rawText[k] === "'") {
          const isInternalApostrophe =
            /[A-Za-z0-9]/.test(rawText[k - 1]) && k + 1 < n && /[A-Za-z0-9]/.test(rawText[k + 1]);
          if (!isInternalApostrophe) {
            closeIdx = k;
            break;
          }
        }
      }
      if (closeIdx === -1) {
        noMoreSingle = true;
        continue;
      }
    } else {
      closeIdx = rawText.indexOf('`', i + 1);
      if (closeIdx === -1) {
        noMoreBacktick = true;
        continue;
      }
    }

    const inner = rawText.slice(i + 1, closeIdx).trim();
    if (inner) {
      if (ch === '`' && !includeBackticks) {
        pushMatched(inner);
        if (stopOnFirst) return { matchedDeps, remainder: rawText };
      } else {
        const isSafeEndpoint = includeBackticks && typeof isSingleExternalEndpointToken === 'function' && isSingleExternalEndpointToken(inner);
        if (!isSafeEndpoint) {
          const matchesScript = includeBareScript && SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(inner);
          let innerMatchesCmd = false;
          if (!matchesScript) {
            if (!/[\s;|&<>()$`\\"']/.test(inner)) {
              const simpleWord = stripShellBinPrefix(stripTrailingProsePunct(inner) || inner).toLowerCase();
              innerMatchesCmd =
                SHELL_ZERO_ARG_CLI_VERBS.has(simpleWord) || SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(inner);
            } else {
              innerMatchesCmd = scanShellCommandText(inner);
            }
          }
          if (matchesScript || innerMatchesCmd) {
            pushMatched(inner);
            if (stopOnFirst) return { matchedDeps, remainder: rawText };
          }
        }
      }
    }

    masked += rawText.slice(cursor, i) + ' '.repeat(closeIdx - i + 1);
    cursor = closeIdx + 1;
    i = closeIdx;
  }

  const remainder = cursor === 0 ? rawText : masked + rawText.slice(cursor);
  return { matchedDeps, remainder };
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
  let noMoreSq = false;
  let noMoreBt = false;

  for (let i = 0; i < n; i += 1) {
    const c = text[i];
    if (c === '\\' && i + 1 < n) {
      i += 1;
      continue;
    }
    if (c === "'" && !noMoreSq) {
      const precededByAlphaNum = i > 0 && /[A-Za-z0-9]/.test(text[i - 1]);
      const followedByAlphaNum = i + 1 < n && /[A-Za-z0-9]/.test(text[i + 1]);
      if (precededByAlphaNum && followedByAlphaNum && hasSingleQuoteCloseBeforeSpace(text, i, n) === -1) {
        continue;
      }
      const closeSq = text.indexOf("'", i + 1);
      if (closeSq === -1) {
        noMoreSq = true;
      } else {
        i = closeSq;
      }
      continue;
    }
    if (c === '`' && !noMoreBt) {
      const closeBt = text.indexOf('`', i + 1);
      if (closeBt === -1) {
        noMoreBt = true;
        continue;
      }
      out += text.slice(cursor, i) + ' '.repeat(closeBt - i + 1);
      cursor = closeBt + 1;
      i = closeBt;
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

function scanOuterClausesForCommands(text, { checkMode = false, stopOnFirst = false } = {}) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  const maskedBt = maskBackticksLinear(text);
  const normQuotes = normalizeInlineEscapedQuotes(maskedBt);
  const unescaped = unescapeInlineShellWords(normQuotes);
  const clauses = parseShellClausesLinear(unescaped);
  const isCompound = clauses.length > 1;
  const found = [];
  const seenFound = stopOnFirst ? null : new Set();

  for (let c = 0; c < clauses.length; c += 1) {
    const clause = clauses[c];
    const tokens = clause.tokens;
    const redirReach = getClauseRedirReach(clause);
    let k = 0;
    while (k < tokens.length) {
      const startTok = tokens[k];
      const startStrippedLower = stripShellBinPrefix(startTok.trimmedClean).toLowerCase();
      if (
        !startTok.precededByRedir &&
        !startTok.followedByRedir &&
        !startTok.isEnvAssign &&
        !SHELL_KNOWN_LOWER_STARTERS.has(startStrippedLower) &&
        !startTok.trimmedClean.startsWith('./') &&
        !startTok.trimmedClean.startsWith('../')
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
        const strippedLower = stripShellBinPrefix(t.trimmedClean).toLowerCase();
        if (
          SHELL_WRAPPER_WORD_SET.has(strippedLower) &&
          !t.hasTrailingProsePunct &&
          !t.hasPaddingSpaces &&
          !/\s/.test(t.trimmedClean) &&
          idx + 1 < tokens.length
        ) {
          const afterTok = tokens[idx + 1];
          const afterLower = stripShellBinPrefix(afterTok.trimmedClean).toLowerCase();
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
      const cmdLower = stripShellBinPrefix(headTok.trimmedClean).toLowerCase();
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
      } else if (SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(headTok.trimmedClean)) {
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

  let outerText = rawText;
  if (rawText.includes('$(')) {
    const normDollar = normalizeInlineEscapedQuotes(rawText);
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

  const { matchedDeps, remainder } = scanDelimitedShellSpans(rawText, {
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
  if (/`[^`]+`/.test(rawText)) {
    return true;
  }

  let outerText = rawText;
  if (rawText.includes('$(')) {
    const normDollar = normalizeInlineEscapedQuotes(rawText);
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

  const { matchedDeps, remainder } = scanDelimitedShellSpans(rawText, {
    includeBackticks: false,
    includeBareScript: true,
    stopOnFirst: true
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
  if (typeof value !== 'string' || !value || /\s/.test(value)) {
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
    const ch = str[i];
    if (ch === '*' || ch === '/' || ch === '?' || ch === '[' || ch === '{') {
      return true;
    }
    if (ch === '(' && i > 0) {
      const prev = str[i - 1];
      if (prev === '@' || prev === '+' || prev === '!') {
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
            : { kind: 'alt', branches: builtBranches, hasEmptyBranch, nullable, seenChars }
          : {
              kind: 'ext',
              op: builtOp,
              branches: builtBranches,
              hasEmptyBranch,
              nullable,
              seenChars,
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

function extractBroadFromSubSpan(run, subStart, subEnd) {
  const s = run.slice(subStart, subEnd);
  const m = s.length;
  if (m === 0 || !hasPotentialBroadSyntax(s)) {
    return null;
  }

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

  const hasStar = s.includes('*');
  let lo = 0;
  let hi = m;
  let strippedBangQuestionColon = false;

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
    const { hasNonStarGlob, skeleton } = analyzeNonStarGlob(candidate);
    const resolvedSkeleton = hasNonStarGlob ? skeleton : candidate;
    looksBroad =
      DIRECTORY_CANDIDATE_REGEX.test(resolvedSkeleton) &&
      resolvedSkeleton.length > 1 &&
      /[A-Za-z0-9_-]/.test(resolvedSkeleton);
  } else if (!looksBroad) {
    const candidateBase = candidate.replace(/:\d+(?:-\d+)?$/, '');
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
  return masked.replace(BROAD_RUN_SCAN_REGEX, (run) => {
    if (!hasPotentialBroadSyntax(run)) {
      return run;
    }

    const runLen = run.length;
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

    const hits = [];
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
      strings.push(unwrapped);
    }
  }

  for (const text of strings) {
    // 0. Extract explicitly delimited single-token external URLs/endpoints first so
    //    embedded parentheses, brackets, `..`, and trailing punctuation stay verbatim.
    let masked = text.replace(EXPLICIT_DELIMITED_TOKEN_REGEX, (fullMatch, offset, sourceStr) => {
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
    });

    // 1a. Extract external URI scheme URLs first and mask them so URL paths
    //     or embedded standard tokens are not misclassified or duplicated.
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

    // 1b. Extract bare external endpoints with path/query/hash suffixes (and optional port)
    //     BEFORE ellipsis masking and glob matching so embedded `..` (e.g. `openapi.org/api?token=a..b`)
    //     and port-qualified wildcards (e.g. `openapi.org:443/api*`) stay intact.
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

    // 2. Mask ellipses (`...`, `..`) before glob/file/standard extraction, preserving exact sequence braces `{a..b}`.
    masked = masked.replace(
      /\{(?:-?\d+\.\.-?\d+(?:\.\.-?\d+)?|[A-Za-z]\.\.[A-Za-z](?:\.\.-?\d+)?)\}|\.{2,}/g,
      (m) => (m.startsWith('{') ? m : ' '.repeat(m.length))
    );

    // 3. Extract broad workspace globs and directory references (`src/**`, `**/*.js`, `src/engine/`, `src/*[0-9].js`),
    //    leaving unprefixed bare domains with trailing slashes or wildcards intact for external detection.
    masked = extractAndMaskBroadWorkspaceDeps(masked, seenBroad, workspaceBroadDeps);

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

    // 5a. Extract complete bare external domains/endpoints BEFORE named standards so
    //     standard-prefixed hosts like `openapi.org/api*` or `ietf.org/api*` are not split.
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

  for (const rawInputStr of strings) {
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
          const rawAnswer = String(c.answer).trim();
          const syntheticDiscoveryAnswer =
            typeof c.label === 'string' && typeof c.text === 'string'
              ? `[${c.label.trim()}] (Source: ${String(c.source || '').trim()}): ${c.text.trim()}`
              : null;
          if (!syntheticDiscoveryAnswer || rawAnswer !== syntheticDiscoveryAnswer) {
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
