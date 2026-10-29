/**
 * Contenu des annonces (popup d'information à durée limitée). Qui les voit et quand est décidé
 * par l'API (`apps/api/src/announcements/announcements.catalog.ts`, même identifiant) : ici, on
 * ne décide que de ce qui s'affiche. Une annonce que l'API n'ouvre pas à l'utilisateur ne
 * s'affiche jamais, même si elle figure dans ce registre.
 */
export interface AnnouncementPoint {
  titre: string;
  texte: string;
}

export interface AnnouncementContent {
  id: string;
  titre: string;
  intro: string;
  points: AnnouncementPoint[];
  /** Scène animée servie par l'application elle-même (iframe de même origine). */
  video?: { src: string; titre: string };
}

export const ANNOUNCEMENT_CONTENTS: Readonly<Record<string, AnnouncementContent>> = {
  'gel-veilleur-2026-10': {
    id: 'gel-veilleur-2026-10',
    titre: 'Un véhicule reste coupé le matin ?',
    intro:
      "Quand le veilleur coupe un véhicule à la main, son horaire automatique est suspendu. " +
      "La remise en service de 7h n'a donc pas lieu : le véhicule reste coupé en journée " +
      "tant que personne ne le rallume.",
    points: [
      {
        titre: 'Veilleur',
        texte: "Après une coupe manuelle de nuit, rallumez le véhicule avant 7h, sauf s'il doit rester immobilisé.",
      },
      {
        titre: 'Équipes de jour',
        texte: "Véhicule encore coupé alors qu'il devrait rouler ? Horaires flotte, puis « Réactiver ».",
      },
      {
        titre: 'L’écran affiche « Couper » alors que le moteur est coupé ?',
        texte: 'Le véhicule est peut-être dans un souterrain ou une zone sans GPS. Cliquez sur « Synchroniser le boîtier » : l’écran se remet d’accord avec le véhicule.',
      },
      {
        titre: 'Ce n’est pas une panne',
        texte: "Le planning automatique fonctionne : coupe à 22h, remise en service à 7h, chaque jour.",
      },
    ],
    video: {
      src: '/assets/tuto/gel-veilleur.html',
      titre: 'Tutoriel : pourquoi un véhicule reste coupé après une coupe manuelle de nuit',
    },
  },
};
