import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Variables mínimas para que src/shared/config.ts valide sin un .env real.
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
      STATE_BACKEND: 'memory',
    },
  },
});
