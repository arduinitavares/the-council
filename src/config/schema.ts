import { councilConfigSchema } from '../domain/schemas.js';

export function isExactModelId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && /[0-9._-]/.test(value);
}

/** Syntax is independent of current model admission. Exact IDs are checked by catalog. */
export const configSchema = councilConfigSchema.superRefine((config, ctx) => {
  for (const selection of [...Object.values(config.reviewers), config.judge]) {
    if (!isExactModelId(selection.model) || !/^[a-z]+$/.test(selection.effort)) {
      ctx.addIssue({ code: 'custom', message: 'Expected exact model and effort identifiers' });
    }
  }
});
export class ConfigError extends Error {
  constructor(readonly code: 'CONFIG_INVALID' | 'CONFIG_NOT_FOUND' | 'CONFIG_VERSION_UNSUPPORTED' | 'CONFIG_NATIVE_ONLY_USE_NATIVE_COMMAND') { super(code); }
}
