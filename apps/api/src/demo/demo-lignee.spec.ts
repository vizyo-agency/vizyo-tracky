import { DOMAINE_DEMO, idsDeLignee, idsMasques } from './demo-lignee';

// Arbre d'invitation de la démo, tel qu'on l'a vu le 04/11/2026 :
//   commercial ──invite──► prospect ──invite──► collegue ──invite──► stagiaire
//   commercial ──invite──► ibti (une AUTRE lignée : jamais visible du prospect)
const COMPTES = [
  { id: 'commercial', email: 'commercial@tracky.test' },
  { id: 'prospect', email: 'Prospect@Exemple.test' },
  { id: 'collegue', email: 'collegue@exemple.test' },
  { id: 'stagiaire', email: 'stagiaire@exemple.test' },
  { id: 'ibti', email: 'ibti@exemple.test' },
  { id: 'seed-admin', email: `demo-admin${DOMAINE_DEMO}` },
  { id: 'seed-lecteur', email: `demo-lecteur${DOMAINE_DEMO.toUpperCase()}` },
];
const INVITATIONS = [
  { email: 'prospect@exemple.test', createdById: 'commercial' },
  { email: 'collegue@exemple.test', createdById: 'prospect' },
  { email: 'STAGIAIRE@exemple.test', createdById: 'collegue' },
  { email: 'ibti@exemple.test', createdById: 'commercial' },
];

describe('demo-lignee — la cloison de la démonstration (une seule règle, deux écrans)', () => {
  it('un prospect voit lui-même et toute sa descendance d’invitation', () => {
    expect([...idsDeLignee('prospect', INVITATIONS, COMPTES)].sort()).toEqual(['collegue', 'prospect', 'stagiaire']);
  });

  it('jamais ses ascendants (le commercial) ni une lignée sœur (ibti)', () => {
    const visibles = idsDeLignee('prospect', INVITATIONS, COMPTES);
    expect(visibles.has('commercial')).toBe(false);
    expect(visibles.has('ibti')).toBe(false);
  });

  it('une invitation en boucle ne fait pas boucler le parcours', () => {
    const boucle = [...INVITATIONS, { email: 'prospect@exemple.test', createdById: 'stagiaire' }];
    expect([...idsDeLignee('prospect', boucle, COMPTES)].sort()).toEqual(['collegue', 'prospect', 'stagiaire']);
  });

  it('une invitation dont le compte n’existe pas (encore en attente) est ignorée', () => {
    const attente = [...INVITATIONS, { email: 'pas-encore@exemple.test', createdById: 'prospect' }];
    expect(idsDeLignee('prospect', attente, COMPTES).size).toBe(3);
  });

  it('idsMasques : tout ce qui est hors lignée, SAUF les comptes de rôle du seed (@demo)', () => {
    expect(idsMasques('prospect', INVITATIONS, COMPTES).sort()).toEqual(['commercial', 'ibti']);
  });

  it('le domaine du seed se lit sans tenir compte de la casse', () => {
    expect(idsMasques('prospect', INVITATIONS, COMPTES)).not.toContain('seed-lecteur');
  });

  it('un lecteur sans invitation ne voit que lui : tous les autres comptes sont masqués, hors seed', () => {
    expect(idsMasques('ibti', INVITATIONS, COMPTES).sort()).toEqual(['collegue', 'commercial', 'prospect', 'stagiaire']);
  });
});
