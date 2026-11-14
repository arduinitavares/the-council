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
  'switch'
]);
const SHELL_GO_SUBCOMMANDS = new Set(['test', 'run', 'build', 'vet', 'mod', 'generate']);
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
  for (let i = 0; i < n; i += 1) {
    const ch = text[i];
    if (ch === "'" && !inDouble) {
      const isApostrophe =
        !inSingle && i > 0 && /[A-Za-z0-9]/.test(text[i - 1]) && i + 1 < n && /[A-Za-z0-9]/.test(text[i + 1]);
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

function parseShellClausesLinear(text) {
  const n = text.length;
  const clauses = [];
  let current = { tokens: [], hasRedirection: false, isFunctionWrap: false };
  let pendingRedir = false;
  let i = 0;
  let noMoreDouble = false;
  let noMoreSingle = false;

  const pushClause = () => {
    if (current.tokens.length > 0 || current.hasRedirection) {
      clauses.push(current);
    }
    current = { tokens: [], hasRedirection: false, isFunctionWrap: false };
    pendingRedir = false;
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
      pushClause();
      i += i + 1 < n && text[i + 1] === '|' ? 2 : 1;
      continue;
    }
    if (ch === '&') {
      if (i + 1 < n && text[i + 1] === '&') {
        pushClause();
        i += 2;
        continue;
      }
      if (i + 1 < n && text[i + 1] === '>') {
        current.hasRedirection = true;
        pendingRedir = true;
        i += i + 2 < n && text[i + 2] === '>' ? 3 : 2;
        while (i < n && /[ \t]/.test(text[i])) i += 1;
        const targetStart = i;
        while (i < n && !/[\s;|&<>()]/.test(text[i])) {
          if (text[i] === '\\' && i + 1 < n) {
            i += 2;
          } else {
            i += 1;
          }
        }
        if (i === targetStart && i < n) i += 1;
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
      current.hasRedirection = true;
      pendingRedir = true;
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
      const isFdDup = text[nextPos - 1] === '&';
      while (nextPos < n && /[ \t]/.test(text[nextPos])) {
        nextPos += 1;
      }
      if (isFdDup) {
        if (nextPos < n && text[nextPos] === '-') {
          nextPos += 1;
        } else {
          while (nextPos < n && text[nextPos] >= '0' && text[nextPos] <= '9') {
            nextPos += 1;
          }
        }
        i = nextPos;
        continue;
      }
      while (nextPos < n && !/[\s;|&<>()]/.test(text[nextPos])) {
        if (text[nextPos] === '\\' && nextPos + 1 < n) {
          nextPos += 2;
        } else if (text[nextPos] === '"') {
          nextPos += 1;
          while (nextPos < n && text[nextPos] !== '"') {
            nextPos += text[nextPos] === '\\' ? 2 : 1;
          }
          if (nextPos < n) nextPos += 1;
        } else if (text[nextPos] === "'") {
          const endSq = text.indexOf("'", nextPos + 1);
          nextPos = endSq === -1 ? nextPos + 1 : endSq + 1;
        } else {
          nextPos += 1;
        }
      }
      i = nextPos > i ? nextPos : i + 1;
      continue;
    }

    const tokenStart = i;
    let value = '';
    let wasQuoted = false;
    let hasRawEq = false;

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
            i += 1;
            continue;
          }
        }
        if (noMoreSingle) {
          value += c;
          i += 1;
          continue;
        }
        const closeSq = text.indexOf("'", i + 1);
        if (closeSq === -1) {
          noMoreSingle = true;
          value += c;
          i += 1;
          continue;
        }
        if (precededByAlphaNum && !followedByAlphaNum && i + 1 < n && /[\s,.;:!?)]/.test(text[i + 1])) {
          value += c;
          i += 1;
          continue;
        }
        wasQuoted = true;
        value += text.slice(i + 1, closeSq);
        i = closeSq + 1;
        continue;
      }
      if (c === '\\' && i + 1 < n) {
        const nextC = text[i + 1];
        if (!/\s/.test(nextC)) {
          value += nextC;
          i += 2;
          continue;
        }
      }
      value += c;
      i += 1;
    }

    if (i === tokenStart) {
      i += 1;
      continue;
    }
    const raw = text.slice(tokenStart, i);
    const trimmedClean = value.replace(/[.,;:!?]+$/, '');
    current.tokens.push({
      raw,
      value,
      trimmedClean: trimmedClean || value,
      wasQuoted,
      isEnvAssign: hasRawEq,
      precededByRedir: pendingRedir
    });
    pendingRedir = false;
  }

  pushClause();
  return clauses;
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
  let idx = startIdx;
  let hasEnvPrefix = false;
  let hasWrapperPrefix = false;
  const hasRedirection = startIdx === 0 ? clause.hasRedirection : Boolean(tokens[startIdx].precededByRedir);

  while (idx < tokens.length) {
    const tok = tokens[idx];
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
      const nextLower = stripShellBinPrefix(tokens[idx + 1].trimmedClean).toLowerCase();
      if (
        !tok.wasQuoted ||
        hasEnvPrefix ||
        hasRedirection ||
        isCompound ||
        isSubshellOrSubCmd ||
        nextLower.startsWith('-') ||
        SHELL_SPLIT_QUOTE_VERBS.has(nextLower) ||
        SHELL_FLAG_OR_PATH_CLI_VERBS.has(nextLower) ||
        SHELL_COMPOUND_ZERO_ARG_VERBS.has(nextLower)
      ) {
        hasWrapperPrefix = true;
        idx += 1;
        let hasCommandLookupFlag = false;
        const shortValueFlags = SHELL_WRAPPER_SHORT_VALUE_FLAGS.get(strippedLower);
        const longValueFlags = SHELL_WRAPPER_LONG_VALUE_FLAGS.get(strippedLower);
        while (idx < tokens.length) {
          const arg = tokens[idx].value;
          if (arg === '--') {
            idx += 1;
            break;
          }
          if (arg.startsWith('--')) {
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
          idx += 1;
        }
        continue;
      }
    }
    break;
  }

  if (idx >= tokens.length) {
    return { matched: false, nextIdx: idx };
  }

  const headTok = tokens[idx];
  const cmdRaw = stripShellBinPrefix(headTok.trimmedClean);
  const cmdLower = cmdRaw.toLowerCase();
  const remainingCount = tokens.length - 1 - idx;
  const nextVal = remainingCount > 0 ? tokens[idx + 1].trimmedClean : '';

  if (SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(headTok.trimmedClean) || SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(headTok.value)) {
    if (!strictProseMode || remainingCount > 0 || hasEnvPrefix || hasWrapperPrefix || hasRedirection) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
  }

  if (cmdLower === 'go' && remainingCount >= 1 && SHELL_GO_SUBCOMMANDS.has(nextVal.toLowerCase())) {
    return { matched: true, nextIdx: idx + 1, headIdx: idx };
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
    if (
      remainingCount >= 1 &&
      (headTok.raw.includes('"') || headTok.raw.includes("'") || headTok.raw.includes('\\')) &&
      SPLIT_QUOTE_PROSE_STOPWORDS.has(nextVal.toLowerCase())
    ) {
      return { matched: false, nextIdx: Math.max(startIdx + 1, idx) };
    }
    if (remainingCount >= 1 || hasRedirection || (isSubshellOrSubCmd && hasEnvPrefix)) {
      if (strictProseMode && cmdLower === 'git' && !hasEnvPrefix && !hasWrapperPrefix && !hasRedirection) {
        const matched = remainingCount >= 1 && (SHELL_GIT_SUBCOMMANDS.has(nextVal.toLowerCase()) || nextVal.startsWith('-'));
        return { matched, nextIdx: Math.max(startIdx + 1, idx + 1), headIdx: idx };
      }
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
    return { matched: false, nextIdx: Math.max(startIdx + 1, idx + 1) };
  }

  if (cmdLower === 'make') {
    if (remainingCount >= 1 && (/^(?:-[A-Za-z0-9-]+|[./~])/.test(nextVal) || SHELL_MAKE_TARGETS.has(nextVal.toLowerCase()))) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
    if (isCompound || hasEnvPrefix || hasWrapperPrefix || hasRedirection || isSubshellOrSubCmd) {
      const matched = remainingCount === 0 || !SPLIT_QUOTE_PROSE_STOPWORDS.has(nextVal.toLowerCase());
      return { matched, nextIdx: Math.max(startIdx + 1, idx + 1), headIdx: idx };
    }
    return { matched: false, nextIdx: Math.max(startIdx + 1, idx + 1) };
  }

  if (cmdLower === 'cd') {
    if (remainingCount >= 1 && (/^(?:[-./~]|\.\.)/.test(nextVal) || isCompound || hasEnvPrefix || hasWrapperPrefix || hasRedirection)) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
    return { matched: false, nextIdx: Math.max(startIdx + 1, idx + 1) };
  }

  if (SHELL_FLAG_OR_PATH_CLI_VERBS.has(cmdLower)) {
    if (remainingCount >= 1 && (/^(?:-[A-Za-z0-9-]+|[./~])/.test(nextVal) || hasEnvPrefix || hasWrapperPrefix || hasRedirection)) {
      return { matched: true, nextIdx: idx + 1, headIdx: idx };
    }
    return { matched: false, nextIdx: Math.max(startIdx + 1, idx + 1) };
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

function hasSplitOrConcatQuoteCommand(rawText, openIdx, closeIdx) {
  const n = rawText.length;
  // Walk backward/forward to capture contiguous concatenated tokens like `n"pm"` or `'np''m'`
  let tokStart = openIdx;
  while (tokStart > 0 && /[A-Za-z0-9_./\\-]/.test(rawText[tokStart - 1])) {
    tokStart -= 1;
  }
  let tokEnd = closeIdx + 1;
  while (tokEnd < n) {
    const nc = rawText[tokEnd];
    if (nc === '"' || nc === "'") {
      const q = nc;
      let nextClose = -1;
      if (q === '"') {
        for (let k = tokEnd + 1; k < n; k += 1) {
          if (rawText[k] === '\\') {
            k += 1;
            continue;
          }
          if (rawText[k] === '"') {
            nextClose = k;
            break;
          }
        }
      } else {
        nextClose = rawText.indexOf("'", tokEnd + 1);
      }
      if (nextClose !== -1) {
        tokEnd = nextClose + 1;
        continue;
      }
      break;
    }
    if (!/[A-Za-z0-9_./\\-]/.test(nc)) {
      break;
    }
    tokEnd += 1;
  }

  const combinedSpan = rawText.slice(tokStart, tokEnd);
  const parsedLead = parseShellClausesLinear(combinedSpan);
  const leadToken = parsedLead[0]?.tokens?.[0];
  if (!leadToken) {
    return { cmd: null, tokEnd };
  }
  const leadLower = stripShellBinPrefix(leadToken.trimmedClean).toLowerCase();
  if (!SHELL_SPLIT_QUOTE_VERBS.has(leadLower) && !SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(leadToken.trimmedClean)) {
    return { cmd: null, tokEnd };
  }

  // Inspect bounded immediate unquoted tail after tokEnd
  let ws = tokEnd;
  while (ws < n && /[ \t]/.test(rawText[ws])) {
    ws += 1;
  }
  if (ws === tokEnd && tokEnd < n && !/[<>|&;\n]/.test(rawText[tokEnd])) {
    return { cmd: null, tokEnd };
  }
  if (ws >= n) {
    return { cmd: null, tokEnd };
  }
  const nextCh = rawText[ws];
  if (',.;:!?)}\n'.includes(nextCh)) {
    return { cmd: null, tokEnd };
  }
  const tailSlice = rawText.slice(ws, Math.min(n, ws + 192));
  const tailCut = tailSlice.search(/[;\n]|&&|\|\|/);
  const tailCandidate = (tailCut === -1 ? tailSlice : tailSlice.slice(0, tailCut)).trim();
  if (!tailCandidate) {
    return { cmd: null, tokEnd };
  }
  const firstTailWordMatch = /^([^\s,;:.!?()[\]{}]+)/.exec(tailCandidate);
  const firstTailWord = firstTailWordMatch ? firstTailWordMatch[1].toLowerCase() : '';
  if (SPLIT_QUOTE_PROSE_STOPWORDS.has(firstTailWord)) {
    return { cmd: null, tokEnd };
  }

  const candidateClause = `${combinedSpan} ${tailCandidate}`;
  if (scanShellCommandText(candidateClause)) {
    const firstArg = firstTailWordMatch ? firstTailWordMatch[1] : tailCandidate;
    return { cmd: `${leadToken.trimmedClean} ${firstArg}`.trim(), tokEnd };
  }
  return { cmd: null, tokEnd };
}

function scanDelimitedShellSpans(rawText, { includeBackticks = false, includeBareScript = false, stopOnFirst = true } = {}) {
  const n = rawText.length;
  let masked = '';
  let cursor = 0;
  let noMoreDouble = false;
  let noMoreSingle = false;
  let noMoreBacktick = false;
  let lastSplitWordEnd = -1;
  const matchedDeps = [];

  for (let i = 0; i < n; i += 1) {
    const ch = rawText[i];
    if (ch !== '"' && ch !== "'" && (!includeBackticks || ch !== '`')) {
      continue;
    }
    if (i > 0 && /[A-Za-z0-9_./-]/.test(rawText[i - 1])) {
      // Allow n"pm" / n'pm' only when it forms a command with tail, evaluating each concatenated token once in O(n)
      if (ch === '`') {
        continue;
      }
      if (ch === "'") {
        if (i >= lastSplitWordEnd) {
          const endSq = hasSingleQuoteCloseBeforeSpace(rawText, i, n);
          if (endSq !== -1 && endSq - i <= 64) {
            const { cmd: splitCmd, tokEnd } = hasSplitOrConcatQuoteCommand(rawText, i, endSq);
            lastSplitWordEnd = tokEnd;
            if (splitCmd) {
              matchedDeps.push(splitCmd);
              if (stopOnFirst) return { matchedDeps, remainder: rawText };
            }
          }
        }
        continue;
      }
      if (ch === '"' && !noMoreDouble && i >= lastSplitWordEnd) {
        let endDq = -1;
        for (let k = i + 1; k < n && k - i <= 64; k += 1) {
          if (rawText[k] === '\\') {
            k += 1;
            continue;
          }
          if (rawText[k] === '"') {
            endDq = k;
            break;
          }
        }
        if (endDq !== -1) {
          const { cmd: splitCmd, tokEnd } = hasSplitOrConcatQuoteCommand(rawText, i, endDq);
          lastSplitWordEnd = tokEnd;
          if (splitCmd) {
            matchedDeps.push(splitCmd);
            if (stopOnFirst) return { matchedDeps, remainder: rawText };
          }
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
        matchedDeps.push(inner);
        if (stopOnFirst) return { matchedDeps, remainder: rawText };
      } else {
        const isSafeEndpoint = includeBackticks && typeof isSingleExternalEndpointToken === 'function' && isSingleExternalEndpointToken(inner);
        if (!isSafeEndpoint) {
          const matchesScript = includeBareScript && SHELL_EXEC_SCRIPT_TOKEN_REGEX.test(inner);
          if (matchesScript || scanShellCommandText(inner)) {
            matchedDeps.push(inner);
            if (stopOnFirst) return { matchedDeps, remainder: rawText };
          }
        }
      }
    }

    if (ch !== '`' && i >= lastSplitWordEnd) {
      const { cmd: splitCmd, tokEnd } = hasSplitOrConcatQuoteCommand(rawText, i, closeIdx);
      lastSplitWordEnd = tokEnd;
      if (splitCmd) {
        matchedDeps.push(splitCmd);
        if (stopOnFirst) return { matchedDeps, remainder: rawText };
      }
    }

    masked += rawText.slice(cursor, i) + ' '.repeat(closeIdx - i + 1);
    cursor = closeIdx + 1;
    i = closeIdx;
  }

  const remainder = cursor === 0 ? rawText : masked + rawText.slice(cursor);
  return { matchedDeps, remainder };
}

function scanUnquotedRedirectionAndWrapperCommands(remainder) {
  if (!remainder) {
    return null;
  }
  if (
    !remainder.includes('<') &&
    !remainder.includes('>') &&
    !remainder.includes('=') &&
    !/\b(?:env|command|builtin|time|nohup|nice|sudo|exec|setsid|stdbuf|timeout)\b/i.test(remainder)
  ) {
    return null;
  }
  const normalized = unescapeInlineShellWords(remainder);
  const clauses = parseShellClausesLinear(normalized);
  const isCompound = clauses.length > 1;

  for (let c = 0; c < clauses.length; c += 1) {
    const clause = clauses[c];
    const tokens = clause.tokens;
    let k = 0;
    while (k < tokens.length) {
      const tok = tokens[k];
      const strippedLower = stripShellBinPrefix(tok.trimmedClean).toLowerCase();
      if (tok.precededByRedir || tok.isEnvAssign || SHELL_WRAPPER_WORD_SET.has(strippedLower)) {
        const res = clauseLooksLikeShellCommandFrom(clause, k, isCompound, { strictProseMode: false });
        if (res.matched) {
          return tokens.slice(k, Math.min(tokens.length, (res.headIdx ?? k) + 3)).map((t) => t.raw).join(' ');
        }
        k = Math.max(k + 1, res.nextIdx);
        continue;
      }
      k += 1;
    }
  }
  return null;
}

function extractProseCommandAndRepoDeps(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return [];
  }
  const deps = [];
  const { matchedDeps, remainder } = scanDelimitedShellSpans(rawText, {
    includeBackticks: true,
    includeBareScript: false,
    stopOnFirst: false
  });
  for (let i = 0; i < matchedDeps.length; i += 1) {
    if (!deps.includes(matchedDeps[i])) {
      deps.push(matchedDeps[i]);
    }
  }

  const normalizedRemainder = unescapeInlineShellWords(remainder);
  if (normalizedRemainder.includes('$(')) {
    const { closedFrames } = findClosedCommandSubstitutions(normalizedRemainder);
    for (let f = 0; f < closedFrames.length; f += 1) {
      const frame = closedFrames[f];
      const ownStart = frame.start + (frame.arith ? 3 : 2);
      const ownEnd = frame.end - 1;
      if (isFrameOwnBenignFast(normalizedRemainder, ownStart, ownEnd, frame.children)) {
        continue;
      }
      const ownText = buildFrameOwnText(normalizedRemainder, ownStart, ownEnd, frame.children).trim();
      if (ownText && scanFlatShellClauses(ownText, { isSubshellOrSubCmd: true, strictProseMode: false, skipQuoteNorm: true })) {
        const snippet = normalizedRemainder.slice(frame.start, frame.end);
        if (!deps.includes(snippet)) {
          deps.push(snippet);
        }
        break;
      }
    }
  }

  const unquotedMatch = UNQUOTED_PROSE_COMMAND_OR_REPO_REGEX.exec(normalizedRemainder);
  if (unquotedMatch) {
    const dep = unquotedMatch[0].trim();
    if (dep && !deps.includes(dep)) {
      deps.push(dep);
    }
  }

  const redirOrWrapMatch = scanUnquotedRedirectionAndWrapperCommands(remainder);
  if (redirOrWrapMatch && !deps.includes(redirOrWrapMatch)) {
    deps.push(redirOrWrapMatch);
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
  if (scanUnquotedRedirectionAndWrapperCommands(remainder)) {
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
                i = p + 1;
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
        if (clsName === 'digit' || clsName === 'xdigit') {
          setMaskRange(rawMask, 48, 57);
          if (clsName === 'xdigit') {
            setMaskRange(rawMask, 65, 70);
            setMaskRange(rawMask, 97, 102);
          }
        } else if (clsName === 'lower' || clsName === 'alpha' || clsName === 'alnum' || clsName === 'word') {
          if (clsName !== 'upper') setMaskRange(rawMask, 97, 122);
          if (clsName !== 'lower') setMaskRange(rawMask, 65, 90);
          if (clsName === 'alnum' || clsName === 'word') setMaskRange(rawMask, 48, 57);
          if (clsName === 'word') setMaskBit(rawMask, 95);
        } else if (clsName === 'upper') {
          setMaskRange(rawMask, 65, 90);
        }
        idx = closeColon + 2;
        continue;
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
    for (let c = 33; c <= 126; c += 1) {
      if (c !== 47 && (rawMask[c >> 5] & (1 << (c & 31))) === 0) {
        setMaskBit(mask, c);
      }
    }
  }

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
        branches.push(seq.length === 1 ? seq[0] : { kind: 'seq', items: seq });
      }
      return { kind: 'alt', branches };
    }
  }
  const digits = new Uint32Array(4);
  setMaskRange(digits, 48, 57);
  return { kind: 'bracket', mask: digits, ciMask: digits, canStartStem: true, canBodyStem: true, matchesDot: false };
}

const EMPTY_SEQ_NODE = Object.freeze({ kind: 'seq', items: Object.freeze([]) });

function parseRootGlobAst(value, bracketClose, braceClose, braceIsSeq, parenClose, parenIsExtGlob) {
  const n = value.length;
  const frames = [{ kind: 'root', stopIdx: n, sep: null, op: null, branches: null, seqItems: [] }];
  const bracketCache = new Map();
  let i = 0;

  while (i < n || frames.length > 1) {
    const top = frames[frames.length - 1];
    if (frames.length > 1 && i >= top.stopIdx) {
      const finishedBranch =
        top.seqItems.length === 0
          ? EMPTY_SEQ_NODE
          : top.seqItems.length === 1
            ? top.seqItems[0]
            : { kind: 'seq', items: top.seqItems };
      top.branches.push(finishedBranch);
      frames.pop();
      const parent = frames[frames.length - 1];
      const built =
        top.kind === 'brace'
          ? { kind: 'alt', branches: top.branches }
          : { kind: 'ext', op: top.op, branches: top.branches };
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
      const branchNode =
        top.seqItems.length === 0
          ? EMPTY_SEQ_NODE
          : top.seqItems.length === 1
            ? top.seqItems[0]
            : { kind: 'seq', items: top.seqItems };
      top.branches.push(branchNode);
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

  const rootItems = frames[0].seqItems;
  return rootItems.length === 1 ? rootItems[0] : { kind: 'seq', items: rootItems };
}

function atomMatchesCode(atom, ch, caseInsensitive) {
  if (atom.kind === 'char') {
    return caseInsensitive ? atom.lowerCode === ch : atom.code === ch;
  }
  const mask = caseInsensitive ? atom.ciMask : atom.mask;
  return ch < 128 && (mask[ch >> 5] & (1 << (ch & 31))) !== 0;
}

function stepTrieBitset(trie, srcBits, dstBits, atom) {
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
    let bits = srcBits[w];
    while (bits !== 0) {
      const lsb = bits & -bits;
      const u = (w << 5) + (31 - Math.clz32(lsb));
      bits ^= lsb;
      const start = edgeHead[u];
      const end = edgeHead[u + 1];
      if (isChar) {
        for (let e = start; e < end; e += 1) {
          if (edgeChar[e] === charCode) {
            dstBits[edgeNextWord[e]] |= edgeNextMask[e];
            break;
          }
        }
      } else {
        for (let e = start; e < end; e += 1) {
          const ch = edgeChar[e];
          if (ch < 128 && (mask[ch >> 5] & (1 << (ch & 31))) !== 0) {
            dstBits[edgeNextWord[e]] |= edgeNextMask[e];
          }
        }
      }
    }
  }
}

function createEmptyNfaState(tries) {
  return {
    standalone: new Uint32Array(tries.standalone.wordCount),
    dotfile: new Uint32Array(tries.dotfile.wordCount),
    extTrie: new Uint32Array(tries.ext.wordCount),
    envMask: 0,
    stemFlags: 0
  };
}

function copyNfaStateInto(dst, src) {
  dst.standalone.set(src.standalone);
  dst.dotfile.set(src.dotfile);
  dst.extTrie.set(src.extTrie);
  dst.envMask = src.envMask;
  dst.stemFlags = src.stemFlags;
}

function clearNfaState(dst) {
  dst.standalone.fill(0);
  dst.dotfile.fill(0);
  dst.extTrie.fill(0);
  dst.envMask = 0;
  dst.stemFlags = 0;
}

function orNfaStateInto(dst, src) {
  for (let i = 0; i < dst.standalone.length; i += 1) dst.standalone[i] |= src.standalone[i];
  for (let i = 0; i < dst.dotfile.length; i += 1) dst.dotfile[i] |= src.dotfile[i];
  for (let i = 0; i < dst.extTrie.length; i += 1) dst.extTrie[i] |= src.extTrie[i];
  dst.envMask |= src.envMask;
  dst.stemFlags |= src.stemFlags;
}

function nfaStatesEqual(a, b) {
  if (a.envMask !== b.envMask || a.stemFlags !== b.stemFlags) {
    return false;
  }
  for (let i = 0; i < a.standalone.length; i += 1) if (a.standalone[i] !== b.standalone[i]) return false;
  for (let i = 0; i < a.dotfile.length; i += 1) if (a.dotfile[i] !== b.dotfile[i]) return false;
  for (let i = 0; i < a.extTrie.length; i += 1) if (a.extTrie[i] !== b.extTrie[i]) return false;
  return true;
}

function stepNfaLeafInPlace(tries, src, dst, atom) {
  clearNfaState(dst);
  stepTrieBitset(tries.standalone, src.standalone, dst.standalone, atom);
  stepTrieBitset(tries.dotfile, src.dotfile, dst.dotfile, atom);
  stepTrieBitset(tries.ext, src.extTrie, dst.extTrie, atom);

  const se = src.envMask;
  if (se !== 0) {
    let de = 0;
    if ((se & 1) !== 0 && atomMatchesCode(atom, 46, false)) de |= 2;
    if ((se & 2) !== 0 && atomMatchesCode(atom, 101, true)) de |= 4;
    if ((se & 4) !== 0 && atomMatchesCode(atom, 110, true)) de |= 8;
    if ((se & 8) !== 0 && atomMatchesCode(atom, 118, true)) de |= 16;
    if ((se & 16) !== 0 && atomMatchesCode(atom, 46, false)) de |= 32;
    if ((se & 96) !== 0 && atom.canBodyStem) de |= 64;
    dst.envMask = de;
  }

  const sf = src.stemFlags;
  if ((sf & STEM_HAS_CHAR) !== 0 && atom.matchesDot) {
    dst.extTrie[0] |= 1;
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
  dst.stemFlags = df;
}

function hasTrieAccept(trie, bits) {
  const terminals = trie.terminals;
  const words = trie.wordCount;
  for (let w = 0; w < words; w += 1) {
    let b = bits[w];
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

function evalRootGlobAstIterative(rootNode, tries) {
  const statePool = [];
  const allocState = () => (statePool.length > 0 ? statePool.pop() : createEmptyNfaState(tries));
  const freeState = (s) => {
    if (s) {
      statePool.push(s);
    }
  };

  const initState = allocState();
  clearNfaState(initState);
  initState.standalone[0] = 1;
  initState.dotfile[0] = 1;
  initState.envMask = 1;
  initState.stemFlags = STEM_CAN_START;

  let repeatBudget = 64;
  const frames = [];
  let pendingResult = null;

  const pushNode = (node, stateIn, repeatDepth) => {
    const needsBase =
      node.kind === 'ext' && (node.op === '?' || node.op === '*' || node.op === '!');
    let baseCopy = null;
    if (needsBase) {
      baseCopy = allocState();
      copyNfaStateInto(baseCopy, stateIn);
    }
    frames.push({
      kind: node.kind,
      node,
      index: 0,
      curState: stateIn,
      scratchState: null,
      baseState: baseCopy,
      accState: null,
      prevPassAcc: null,
      repeatDepth
    });
  };

  const popFrameWithResult = (f, resultState) => {
    if (f.curState && f.curState !== resultState) freeState(f.curState);
    if (f.scratchState && f.scratchState !== resultState) freeState(f.scratchState);
    if (f.baseState && f.baseState !== resultState) freeState(f.baseState);
    if (f.accState && f.accState !== resultState) freeState(f.accState);
    if (f.prevPassAcc && f.prevPassAcc !== resultState) freeState(f.prevPassAcc);
    frames.pop();
    pendingResult = resultState;
  };

  pushNode(rootNode, initState, 0);

  while (frames.length > 0) {
    const f = frames[frames.length - 1];

    if (pendingResult !== null) {
      if (f.kind === 'seq') {
        freeState(f.curState);
        f.curState = pendingResult;
        pendingResult = null;
        f.index += 1;
      } else {
        orNfaStateInto(f.accState, pendingResult);
        freeState(pendingResult);
        pendingResult = null;
        f.index += 1;
      }
    }

    if (f.kind === 'char' || f.kind === 'bracket') {
      const out = allocState();
      stepNfaLeafInPlace(tries, f.curState, out, f.node);
      popFrameWithResult(f, out);
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
          if (!f.scratchState) {
            f.scratchState = allocState();
          }
          stepNfaLeafInPlace(tries, f.curState, f.scratchState, item);
          const tmp = f.curState;
          f.curState = f.scratchState;
          f.scratchState = tmp;
          f.index += 1;
          if (f.index < items.length && items[f.index] === item && nfaStatesEqual(f.curState, f.scratchState)) {
            while (f.index < items.length && items[f.index] === item) {
              f.index += 1;
            }
          }
        } else {
          const childIn = allocState();
          copyNfaStateInto(childIn, f.curState);
          pushNode(item, childIn, f.repeatDepth);
          stoppedForChild = true;
          break;
        }
      }
      if (!stoppedForChild) {
        popFrameWithResult(f, f.curState);
      }
      continue;
    }

    // 'alt' or 'ext'
    const branches = f.node.branches;
    if (!f.accState) {
      f.accState = allocState();
      clearNfaState(f.accState);
    }
    if (f.index < branches.length) {
      const br = branches[f.index];
      if (br === EMPTY_SEQ_NODE || (br.kind === 'seq' && br.items.length === 0)) {
        orNfaStateInto(f.accState, f.curState);
        f.index += 1;
        continue;
      }
      if (br.kind === 'char' || br.kind === 'bracket') {
        if (!f.scratchState) {
          f.scratchState = allocState();
        }
        stepNfaLeafInPlace(tries, f.curState, f.scratchState, br);
        orNfaStateInto(f.accState, f.scratchState);
        f.index += 1;
        continue;
      }
      const childIn = allocState();
      copyNfaStateInto(childIn, f.curState);
      pushNode(br, childIn, f.repeatDepth + (f.node.op === '+' || f.node.op === '*' ? 1 : 0));
      continue;
    }

    const op = f.kind === 'ext' ? f.node.op : null;
    if (op === '+' || op === '*') {
      if (!f.prevPassAcc) {
        f.prevPassAcc = allocState();
        clearNfaState(f.prevPassAcc);
      }
      const changed = !nfaStatesEqual(f.accState, f.prevPassAcc);
      if (changed && f.repeatDepth <= 4 && repeatBudget > 0) {
        repeatBudget -= 1;
        copyNfaStateInto(f.prevPassAcc, f.accState);
        copyNfaStateInto(f.curState, f.accState);
        f.index = 0;
        continue;
      }
    }

    if (op === '?' || op === '*') {
      orNfaStateInto(f.accState, f.baseState);
    } else if (op === '!') {
      orNfaStateInto(f.accState, f.baseState);
      f.accState.stemFlags |= STEM_HAS_CHAR;
    }

    popFrameWithResult(f, f.accState);
  }

  return pendingResult || initState;
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
  const finalState = evalRootGlobAstIterative(ast, tries);
  if ((finalState.envMask & 64) !== 0) {
    return true;
  }
  if (hasTrieAccept(tries.standalone, finalState.standalone)) {
    return true;
  }
  if (hasTrieAccept(tries.dotfile, finalState.dotfile)) {
    return true;
  }
  if (hasTrieAccept(tries.ext, finalState.extTrie)) {
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
  const structuredSources = [];
  if (typeof topic === 'string' && topic.trim()) {
    texts.push(topic);
  }
  if (phase === 'DELIBERATION' && Array.isArray(clarifications)) {
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
        !deps.workspaceBroadDeps.includes(unwrappedSource) &&
        !deps.workspaceBroadDeps.includes(originalSource)
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
        if (label && !deps.workspaceBroadDeps.includes(label)) {
          deps.workspaceBroadDeps.push(label);
        }
      }
      if (
        unwrappedSource &&
        !sourceHasConcreteFile &&
        !sourceIsCommandOrRepo &&
        (!sourceDeps || sourceDeps.externalDeps.length === 0) &&
        !deps.externalDeps.some((d) => externalSourcesMatch(d, unwrappedSource)) &&
        !deps.workspaceBroadDeps.includes(unwrappedSource) &&
        !deps.workspaceBroadDeps.includes(originalSource) &&
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
