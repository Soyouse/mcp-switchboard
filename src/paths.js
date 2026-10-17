// paths.js — SEUL module qui sait ou vivent les fichiers selon l'OS (savoir-OS en UN endroit).
// ⚠️ Toute autre partie du code passe par ici : un chemin calcule ailleurs divergerait d'un OS a l'autre.
import os from 'node:os';
import path from 'node:path';

/**
 * @param {{platform?:string, env?:Record<string,string|undefined>, home?:string}} [o]
 * @returns {{config:string, etat:string}} fichier de configuration + dossier d'etat (journal, jeton, souvenir)
 */
export function emplacements(o = {}) {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const home = o.home ?? os.homedir();
  const j = platform === 'win32' ? path.win32.join : path.posix.join;
  let baseConfig, baseEtat;
  if (platform === 'win32') {
    baseConfig = env.APPDATA || j(home, 'AppData', 'Roaming');
    baseEtat = env.LOCALAPPDATA || j(home, 'AppData', 'Local');
  } else if (platform === 'darwin') {
    baseConfig = baseEtat = j(home, 'Library', 'Application Support');
  } else {
    baseConfig = env.XDG_CONFIG_HOME || j(home, '.config');
    baseEtat = env.XDG_STATE_HOME || j(home, '.local', 'state');
  }
  return {
    config: env.MCP_SWITCHBOARD_CONFIG || j(baseConfig, 'mcp-switchboard', 'switchboard.json'),
    etat: env.MCP_SWITCHBOARD_STATE || j(baseEtat, 'mcp-switchboard'),
  };
}
