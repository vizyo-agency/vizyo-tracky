import { UserRole } from '@prisma/client';

/**
 * Annonces affichées dans l'application (popup d'information à durée limitée).
 *
 * L'API décide QUI voit QUOI et QUAND (l'horloge du serveur fait foi, pas celle du poste) ;
 * le CONTENU (titre, texte, vidéo) vit côté web, dans le registre de même identifiant. Ajouter
 * une annonce = une ligne ici + une entrée dans `announcements.registry.ts` côté web. Aucune
 * migration : rien n'est stocké en base (la fermeture est mémorisée par le navigateur).
 */
export interface AnnouncementDef {
  /** Identifiant stable, partagé avec le registre web. Ne jamais le réutiliser pour un autre texte. */
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** Visible pour ces rôles, quelle que soit la société. */
  roles: UserRole[];
  /**
   * Visible pour TOUS les comptes des sociétés dont le nom CONTIENT l'un de ces motifs, casse,
   * espaces et ponctuation ignorés (« cdef31 » reconnaît « cdef31 » en production comme
   * « CDEF 31 — Centre… » en base de développement).
   */
  fleetNames: string[];
}

export const ANNOUNCEMENTS: AnnouncementDef[] = [
  {
    // 2026-10-28 — véhicules « bloqués en journée » chez CDEF31 : une coupe manuelle du veilleur
    // suspend l'horaire automatique tant qu'on ne rallume pas. Mise en ligne le 29/10 : cinq jours pleins après aujourd'hui (jusqu'au 03/11 inclus).
    id: 'gel-veilleur-2026-10',
    startsAt: new Date('2026-10-29T00:00:00+01:00'),
    endsAt: new Date('2026-11-04T00:00:00+01:00'),
    roles: [UserRole.NIGHT_WATCHMAN, UserRole.SUPER_ADMIN],
    fleetNames: ['cdef31'],
  },
];

export interface AnnouncementViewer {
  role: UserRole;
  fleetName: string | null;
}

const nettoyer = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Les annonces ouvertes à cet utilisateur à cet instant. Pure : testable sans base. */
export function activeAnnouncementsFor(
  defs: readonly AnnouncementDef[],
  viewer: AnnouncementViewer,
  now: Date,
): AnnouncementDef[] {
  const fleet = viewer.fleetName ? nettoyer(viewer.fleetName) : '';
  return defs.filter((d) => {
    if (now < d.startsAt || now >= d.endsAt) return false;
    if (d.roles.includes(viewer.role)) return true;
    // Un motif vide ne doit jamais reconnaître toutes les sociétés.
    return fleet !== '' && d.fleetNames.some((n) => nettoyer(n) !== '' && fleet.includes(nettoyer(n)));
  });
}
