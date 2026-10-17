// Config DEDIEE a la mutation (Stryker) : SEULEMENT les suites des modules purs. Jamais les suites
// qui spawnent (standard.test.js) : un mutant lancerait de vrais process a chaque essai.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/session-pure.test.js', 'tests/bascule-pure.test.js', 'tests/souvenir-config-pure.test.js'],
    testTimeout: 30000,
  },
});
