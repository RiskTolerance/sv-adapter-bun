/* global ENV_PREFIX */
import { check_env_conflicts, create_env } from './internal/env';

check_env_conflicts(ENV_PREFIX, Bun.env);

export const env = create_env(ENV_PREFIX, Bun.env);
