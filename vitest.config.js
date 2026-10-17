import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les tests du standard SPAWNENT de vrais process : 30 s (doctrine du parc, le defaut de 5 s est calibre
    // pour des tests en memoire). Une borne, pas une attente : seul ce qui depasse est touche.
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: [['default', { summary: false }]],
  },
});
