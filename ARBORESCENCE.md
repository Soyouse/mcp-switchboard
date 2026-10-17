# Arborescence

Une ligne par fichier de code. `tests/gates.test.js` rougit si un fichier de `src/`, `bin/`, `tools/`, `tests/` ou `.githooks/` manque ici, ou si une ligne cite un fichier disparu.

## Service
- `src/main.js` : entrée du service. Lit la config (refus nommé si invalide), le jeton, écoute, relit la config à chaud, s'arrête proprement.
- `src/serveur.js` : HTTP Streamable (SDK officiel), contrôle d'hôte et de jeton, fin de session par inactivité, routes `/sante`, `/relire`, `/arreter`.
- `src/session.js` : une fenêtre et son serveur. Souvenir du handshake, file d'attente pendant l'allumage, rejeu, confrontation avec la liste vivante.
- `src/session-pure.js` : décision pure, que faire de chaque message (serveur froid ou chaud).
- `src/enfant.js` : lancement et arrêt de l'arbre de processus, résolution des exécutables Windows sans shell.
- `src/souvenir.js` : écriture atomique du souvenir sur disque.
- `src/souvenir-pure.js` : décision pure du souvenir (clé, plafond).
- `src/config-pure.js` : validation de la config, adresses admises, développement `${VAR}` et `${VAR:-défaut}`.
- `src/bascule-pure.js` : plan de bascule d'une entrée stdio vers le standard, et son inverse exact.
- `src/service-pure.js` : fichier de service par OS (tâche Windows, LaunchAgent macOS, unité systemd Linux).
- `src/verification.js` : preuve que le standard expose les mêmes outils que le lancement direct.
- `src/paths.js` : seul module qui connaît les emplacements propres à chaque OS.
- `src/journal.js` : journal borné.

## Commandes
- `bin/mcp-switchboard.js` : `installer`, `basculer`, `revenir`, `etat`.
- `bin/sans-fenetre.vbs` : lanceur Windows sans fenêtre, propage le code de sortie.

## Outils du dépôt
- `tools/fuite-pure.js` : décision pure du juge anti-fuite (motifs génériques, exceptions admises, liste personnelle).
- `tools/fuite-gate.mjs` : juge anti-fuite sur les fichiers suivis et indexés, et sur un message de commit (`--message`).
- `tools/ci-clean-clone.mjs` : rejoue `npm run ci` sur un clone vierge (worktree détaché, `npm ci` dedans).

## Hooks git (activés par `npm install`, script `prepare`)
- `.githooks/pre-commit` : juge anti-fuite sur les fichiers.
- `.githooks/commit-msg` : juge anti-fuite sur le message.
- `.githooks/pre-push` : suite complète.

## Tests
- `tests/standard.test.js` : bout en bout contre de vrais processus.
- `tests/fixtures/faux-serveur.js` : serveur MCP stdio minimal pour les tests.
- `tests/session-pure.test.js` : décision des sessions.
- `tests/bascule-pure.test.js` : plans de bascule et de retour.
- `tests/souvenir-config-pure.test.js` : souvenir, config, chemins, service.
- `tests/fuite-pure.test.js` : décision du juge anti-fuite.
- `tests/gates.test.js` : juges du dépôt (fuite, CI = une commande locale, arborescence, hooks, sources non instrumentées).

## Configuration
`package.json`, `vitest.config.js`, `vitest.pure.config.js` (suites pures pour la mutation), `stryker.conf.json` (mutation des modules purs, seuil 100), `.github/workflows/ci.yml` (appelle `npm run ci` sur Linux, Windows et macOS), `.gitattributes` (LF partout).
