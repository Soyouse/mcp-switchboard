// souvenir.js — I/O du souvenir (UN fichier dans le dossier d'etat). Execute souvenir-pure.js.
// ⚠️ Ecriture ATOMIQUE (tmp propre au pid + rename) ; aucune ecriture si rien de neuf.
// 🛑 BEST-EFFORT : une lecture ratee rend `null` (=> l'outil s'allume, comme avant), jamais un throw.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { matiereCle, lire, ecrire } from './souvenir-pure.js';

/** @param {string} dossier @param {(l:string)=>void} log */
export function ouvrirSouvenir(dossier, log) {
  const fichier = path.join(dossier, 'souvenir.json');
  const lireDoc = () => {
    try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch (e) {
      if (e?.code !== 'ENOENT') log(`[souvenir] lecture : ${e?.code || e?.message || e} (ignore)`);
      return null;
    }
  };
  return {
    /** @param {string} nom @param {object} def @param {unknown} protocolVersion */
    cle(nom, def, protocolVersion) {
      return createHash('sha256').update(matiereCle(nom, def, protocolVersion)).digest('hex');
    },
    /** @param {string} cle */
    lire(cle) {
      return lire(lireDoc(), cle);
    },
    /** @param {string} cle @param {{init?:object, liste?:{methode:string, resultat:object}}} patch */
    ecrire(cle, patch) {
      const avant = lireDoc();
      const apres = ecrire(avant, cle, patch);
      const texte = JSON.stringify(apres);
      if (avant && JSON.stringify(avant) === texte) return;
      const tmp = `${fichier}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, texte);
        fs.renameSync(tmp, fichier);
      } catch (e) {
        log(`[souvenir] ecriture : ${e?.code || e?.message || e} (ignore)`);
        try { fs.rmSync(tmp, { force: true }); } catch { /* SILENCE: nettoyage d'un temporaire deja signale */ }
      }
    },
  };
}
