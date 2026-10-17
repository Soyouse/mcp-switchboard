// verification.js — PREUVE qu'un outil rend la MEME chose par le standard qu'en lancement direct.
// Utilisee par `basculer` : difference => retour automatique en stdio (la bascule ne laisse jamais un
// outil different de ce qu'il etait). Compare la liste d'outils COMPLETE (noms, descriptions, schemas).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import os from 'node:os';
import { definitionLancable } from './config-pure.js';
import { identiques } from './souvenir-pure.js';

/** Toutes les pages de tools/list (pagination par curseur). */
async function outils(client) {
  const tous = [];
  let cursor;
  do {
    const r = await client.listTools(cursor ? { cursor } : {});
    tous.push(...r.tools);
    cursor = r.nextCursor;
  } while (cursor);
  return tous;
}

/**
 * @param {{command:string, args:string[], env:Record<string,string>, cwd:string|null}} def definition stdio d'origine
 * @param {string} url adresse de l'outil dans le standard
 * @param {string} jeton
 * @returns {Promise<{identique:boolean, direct:number, standard:number, detail?:string}>}
 */
export async function comparer(def, url, jeton) {
  const prete = definitionLancable(def, process.env);
  if (!prete.ok) return { identique: false, direct: 0, standard: 0, detail: prete.raison };
  const direct = new Client({ name: 'mcp-switchboard-verification', version: '1' });
  const parStandard = new Client({ name: 'mcp-switchboard-verification', version: '1' });
  try {
    await direct.connect(new StdioClientTransport({ command: prete.def.command, args: prete.def.args, env: { ...process.env, ...prete.def.env }, cwd: prete.def.cwd || os.homedir(), stderr: 'ignore' }));
    await parStandard.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${jeton}` } } }));
    const [a, b] = await Promise.all([outils(direct), outils(parStandard)]);
    const tri = (l) => [...l].sort((x, y) => String(x.name).localeCompare(String(y.name)));
    const identique = identiques(tri(a), tri(b));
    return { identique, direct: a.length, standard: b.length, ...(identique ? {} : { detail: `outils differents : direct [${a.map((t) => t.name).join(', ')}] / standard [${b.map((t) => t.name).join(', ')}]` }) };
  } catch (e) {
    return { identique: false, direct: 0, standard: 0, detail: `verification impossible : ${e?.message || e}` };
  } finally {
    await direct.close().catch(() => {});
    await parStandard.close().catch(() => {});
  }
}
