// Faux serveur MCP stdio pour les tests. Il prouve ce que le standard doit garantir :
//  - chaque demarrage s'inscrit dans FAUX_COMPTEUR (une ligne = un process allume) ;
//  - `compteur` incremente un etat PROPRE AU PROCESS (deux sessions isolees voient 1 et 1, jamais 1 et 2) ;
//  - la liste d'outils est lue dans FAUX_OUTILS_FICHIER (hors env : la cle du souvenir ne change pas
//    quand on la modifie, ce qui permet de tester un souvenir PERIME) ;
//  - `mourir` termine le process (serveur qui plante) ; `lent` repond apres `ms`.
import fs from 'node:fs';

if (process.env.FAUX_COMPTEUR) fs.appendFileSync(process.env.FAUX_COMPTEUR, `${process.pid}\n`);
let etat = 0;
const outils = () => {
  try { return JSON.parse(fs.readFileSync(process.env.FAUX_OUTILS_FICHIER, 'utf8')); } catch { return [{ name: 'compteur', inputSchema: { type: 'object' } }]; }
};
const ecrire = (m) => process.stdout.write(JSON.stringify(m) + '\n');
let tampon = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  tampon += d;
  let i;
  while ((i = tampon.indexOf('\n')) >= 0) {
    const ligne = tampon.slice(0, i); tampon = tampon.slice(i + 1);
    if (!ligne.trim()) continue;
    const m = JSON.parse(ligne);
    if (m.id === undefined || m.method === undefined) continue;
    if (m.method === 'initialize') ecrire({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'faux', version: '1' }, instructions: `client=${m.params.clientInfo?.name}` } });
    else if (m.method === 'tools/list') ecrire({ jsonrpc: '2.0', id: m.id, result: { tools: outils() } });
    else if (m.method === 'tools/call') {
      const n = m.params.name;
      if (n === 'mourir') process.exit(3);
      const repondre = () => ecrire({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({ pid: process.pid, etat: ++etat }) }] } });
      if (n === 'lent') setTimeout(repondre, m.params.arguments?.ms ?? 500);
      else repondre();
    } else ecrire({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'inconnu' } });
  }
});
process.stdin.on('end', () => process.exit(0));
