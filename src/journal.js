// journal.js — journal du standard. ⚠️ L'ESPACE SE DECLARE : 2 fichiers de MAX_OCTETS au plus
// (le courant + `.1`), rotation a l'ecriture en lisant la taille REELLE (statSync). Rien d'autre.
// ⚠️ JAMAIS de stdout : le standard n'en a pas besoin, mais un enfant stdio si — ne pas melanger.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_OCTETS = 2 * 1024 * 1024;

/** @param {string} dossier @returns {(ligne:string)=>void} */
export function ouvrirJournal(dossier) {
  const fichier = path.join(dossier, 'switchboard.log');
  fs.mkdirSync(dossier, { recursive: true });
  return (ligne) => {
    try {
      try { if (fs.statSync(fichier).size > MAX_OCTETS) fs.renameSync(fichier, fichier + '.1'); } catch { /* SILENCE: fichier absent au premier ecrit */ }
      fs.appendFileSync(fichier, `${new Date().toISOString()} ${ligne}\n`);
    } catch (e) {
      process.stderr.write(`[mcp-switchboard] journal inaccessible : ${e?.code || e}\n`);
    }
  };
}
