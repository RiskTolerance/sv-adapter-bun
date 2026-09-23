import { defineEnvVars } from '@sveltejs/kit/env';

// kit 3 only exposes environment variables that are declared here
export const variables = defineEnvVars({
  ADAPTER_BUN_TEST_SECRET: {
    // read when the server starts (not inlined at build time); optional so
    // the app still boots when it is unset
    schema: value => value,
  },
});
