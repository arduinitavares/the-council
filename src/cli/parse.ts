export type Command = 'start' | 'inspect' | 'respond' | 'resume' | 'cancel' | 'qualify';
export interface CliArgs { command: Command; workspace: string; json: true; run?: string; input?: string; config?: string; profile?: string }
export function parseArgs(argv: readonly string[]): CliArgs {
  const command = argv[0] as Command;
  const required: Record<Command, readonly string[]> = { start: ['input'], inspect: ['run'], respond: ['run', 'input'], resume: ['run'], cancel: ['run'], qualify: ['profile'] };
  if (!Object.hasOwn(required, command)) throw new Error('USAGE');
  const allowed = new Set(['workspace', 'json', ...required[command], ...(command === 'start' ? ['config'] : [])]);
  const values: Record<string, string | true> = {};
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i]!;
    if (!flag.startsWith('--') || !allowed.has(flag.slice(2)) || Object.hasOwn(values, flag.slice(2))) throw new Error('USAGE');
    const key = flag.slice(2);
    if (key === 'json') values[key] = true;
    else { const value = argv[++i]; if (!value || value.startsWith('--') || value.includes('\0')) throw new Error('USAGE'); values[key] = value; }
  }
  if (values.json !== true || typeof values.workspace !== 'string' || required[command].some(key => typeof values[key] !== 'string')) throw new Error('USAGE');
  return { command, ...values } as unknown as CliArgs;
}
