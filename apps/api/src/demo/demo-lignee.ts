/**
 * ═══ EN DÉMONSTRATION, UN PROSPECT NE VOIT QUE SA LIGNÉE ═══════════════════════════════════
 *
 * La démo n'a qu'une flotte : tous les prospects (FLEET_ADMIN) y sont dans le même locataire. La
 * page Utilisateurs (`UsersController.cloisonDemo`) borne donc ce qu'un prospect lit à sa
 * DESCENDANCE d'invitation (lui, ceux qu'il a invités, ceux qu'ils ont invités à leur tour) plus
 * les comptes de rôle du seed. Jamais ses ascendants, jamais une lignée sœur.
 *
 * Cette règle vit ici, en fonction PURE, parce qu'elle est maintenant lue à deux endroits : la page
 * Utilisateurs et les écrans d'activité de la flotte (« En ligne maintenant », fil d'activité,
 * commandes moteur, agenda). Le 04/11/2026, à la répétition de la démo du CH de Dieppe, « Ibti
 * Benzagouta · Admin flotte · Tableau de bord · vu il y a 59 s » s'affichait dans « En ligne
 * maintenant » alors que son adresse avait disparu de la liste des utilisateurs : la présence lisait
 * `user_sessions` sans passer par la cloison. Une règle écrite deux fois dérive ; écrite une fois,
 * elle ne peut pas oublier un écran.
 */

/** Domaine des comptes de rôle posés par le seed de la démonstration. */
export const DOMAINE_DEMO = '@demo.vizyoagency.com';

export interface InvitationLignee {
  email: string;
  createdById: string;
}

export interface CompteLignee {
  id: string;
  email: string;
}

/**
 * Identifiants des comptes que `lecteurId` a le droit de voir : lui-même et sa descendance
 * d'invitation, en largeur. Un e-mail déjà vu ne se rouvre pas : c'est ce qui borne le parcours si
 * deux invitations se croisaient. L'arbre se reconstruit depuis `Invitation` (`createdById` →
 * `email`), qui SURVIT à son acceptation.
 */
export function idsDeLignee(
  lecteurId: string,
  invitations: readonly InvitationLignee[],
  comptes: readonly CompteLignee[],
): Set<string> {
  const idParEmail = new Map(comptes.map((c) => [c.email.toLowerCase(), c.id]));
  const idsAutorises = new Set<string>([lecteurId]);
  const emailsVus = new Set<string>();
  const file: string[] = [lecteurId];
  while (file.length > 0) {
    const auteur = file.shift()!;
    for (const inv of invitations) {
      if (inv.createdById !== auteur) continue;
      const email = inv.email.toLowerCase();
      if (emailsVus.has(email)) continue;
      emailsVus.add(email);
      const id = idParEmail.get(email);
      if (id && !idsAutorises.has(id)) {
        idsAutorises.add(id);
        file.push(id);
      }
    }
  }
  return idsAutorises;
}

/**
 * Les comptes qu'un lecteur NE doit PAS voir : tous ceux qui ne sont ni dans sa lignée ni des
 * comptes de rôle du seed. Les super-administrateurs et le propriétaire n'ont pas à y figurer :
 * les écrans d'activité les excluent déjà (rôles élevés), et la page Utilisateurs ne les filtre
 * pas pour un prospect (c'est l'exploitant).
 */
export function idsMasques(
  lecteurId: string,
  invitations: readonly InvitationLignee[],
  comptes: readonly CompteLignee[],
): string[] {
  const visibles = idsDeLignee(lecteurId, invitations, comptes);
  return comptes
    .filter((c) => !visibles.has(c.id) && !c.email.toLowerCase().endsWith(DOMAINE_DEMO))
    .map((c) => c.id);
}
