# mcp-switchboard — le standard MCP local

**Problème.** Chaque fenêtre de Claude Code (ou de Codex, ou d'Antigravity) lance sa propre copie de chaque serveur MCP stdio, qu'elle s'en serve ou non. 10 serveurs × 4 fenêtres = 40 processus, la plupart inutiles.

**Ce que fait le standard.** Un seul petit service local (`127.0.0.1`), toujours allumé. Les fenêtres s'y branchent par une adresse au lieu de lancer leurs serveurs :

- **Une fenêtre qui s'ouvre n'allume rien.** Le handshake MCP (`initialize`, listes d'outils) est servi depuis le *souvenir* de ce que ce même serveur a déjà répondu, mot pour mot.
- **Au premier vrai appel, la fenêtre obtient SON serveur**, lancé pour elle seule, avec son handshake d'origine rejoué. Jamais partagé avec une autre fenêtre : état, connexions et attentes restent propres à chaque fenêtre, comme en stdio.
- **La fenêtre se ferme, son serveur s'arrête** (tout son arbre de processus).
- **Souvenir périmé** (serveur mis à jour) : la liste vivante est comparée au premier appel ; si elle diffère, le souvenir est réécrit et le client reçoit `list_changed`.

## Fiabilité (mesurée, voir `tests/standard.test.js`)

| Cas | Comportement |
|---|---|
| Fenêtre fermée proprement (Codex : `DELETE`) | serveur arrêté immédiatement |
| Fenêtre partie sans prévenir (Claude Code, Gemini/Antigravity) | le noyau voit la socket tomber (`keepalive`) ; sans activité pendant 30 s, serveur arrêté |
| Serveur qui plante | la requête reçoit une erreur nommée ; la suivante le relance |
| Standard redémarré | session inconnue ⇒ `404` ⇒ le client recommence son handshake (spec MCP) |
| Commande introuvable | erreur nommée à l'appel, jamais un silence |

**Sécurité (spec MCP 2025-06-18) :** écoute `127.0.0.1` par défaut, ou une adresse privée déclarée (`"hote"` : sous Windows, une carte de bouclage dédiée évite les connexions perdues sur 127/8 sous charge) — jamais 0.0.0.0 ni une adresse publique, `Host` et `Origin` vérifiés (anti DNS-rebinding), jeton porteur exigé à chaque requête. Le jeton n'est jamais écrit en clair dans la config des clients : `Bearer ${MCP_SWITCHBOARD_TOKEN}`.

## Utilisation

```sh
node bin/mcp-switchboard.js installer          # service de l'OS (Windows, macOS, Linux) + jeton
node bin/mcp-switchboard.js basculer crm stats # ces entrées de ~/.mcp.json passent par le standard
node bin/mcp-switchboard.js etat                # sessions et serveurs allumés
node bin/mcp-switchboard.js revenir crm         # retour en stdio, mot pour mot
```

Config : `%APPDATA%\mcp-switchboard\switchboard.json` (Windows) · `~/Library/Application Support/mcp-switchboard/` (macOS) · `~/.config/mcp-switchboard/` (Linux). Relue à chaud.

## Développement

`npm run ci` (toute la suite, ce que la CI lance sur les 3 OS) · `npm run test:pure` · mutation : `stryker run --mutate src/<fichier>.js` (6 modules purs, plancher 100 %).
