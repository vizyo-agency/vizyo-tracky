import { Prisma, type PrismaClient } from '@prisma/client';
import type { Contexte } from './transformations';

/**
 * ═══ LES ZONES DE DÉMO — quand la source n'a AUCUNE géofence ═══════════════════════════════
 *
 * Relevé de la répétition du 04/11/2026 (CH de Dieppe) : l'onglet Géofences de la démo affichait
 * « 0 zone » — un écran vide, dans l'une des fonctions que l'on montre. Le défaut n'est pas dans
 * l'importeur mais dans la source : la production n'a plus aucune zone active sur ces sociétés
 * (les alertes d'entrée et de sortie s'arrêtent le 07/07), et l'importeur recopiait fidèlement ce
 * vide.
 *
 * Une démo qui montre « 0 zone » ne démontre pas la fonction. Quand la source n'a rien, on
 * FABRIQUE donc trois zones à partir de ce que la flotte fait réellement : ses lieux de départ les
 * plus fréquents. Elles sont donc cohérentes avec la carte (un dépôt là où les véhicules
 * démarrent), sans rien emprunter à la production que des coordonnées de départ déjà importées
 * avec les trajets.
 *
 * ⚠️ UNE ZONE SUR LE DÉPÔT, AVEC TOUTE LA FLOTTE, INONDERAIT LE CENTRE D'ALERTE : quarante-six
 * véhicules qui partent et reviennent chaque jour, c'est des centaines d'alertes d'entrée et de
 * sortie quotidiennes, et une cloche qui ne veut plus rien dire. Chaque zone ne cible donc que les
 * {@link VEHICULES_PAR_ZONE} véhicules qui y partent le plus souvent : de quoi voir des alertes de
 * zone vivre, pas de quoi noyer les autres.
 *
 * Pur et déterministe : les mêmes départs et le même sel donnent les mêmes zones, avec les mêmes
 * identifiants — un rafraîchissement ne les recrée pas, il les retrouve.
 */

/** Une ligne de la lecture source : combien de départs d'UN véhicule dans UNE cellule d'environ un kilomètre. */
export interface DepartsParVehicule {
  /** Identifiant SOURCE du véhicule. */
  vehicleId: string;
  /** Nombre de départs de ce véhicule dans la cellule. */
  n: number;
  /** Moyenne des latitudes de départ dans la cellule. */
  lat: number;
  /** Moyenne des longitudes de départ dans la cellule. */
  lng: number;
  /** Clé de la cellule (coordonnées arrondies), pour regrouper les lignes. */
  cellule: string;
}

export interface GrappeDeparts {
  lat: number;
  lng: number;
  /** Départs cumulés de tous les véhicules dans la cellule. */
  n: number;
  /** Les véhicules de la cellule, du plus assidu au moins assidu. Identifiants SOURCE. */
  vehicules: Array<{ vehicleId: string; n: number }>;
}

export const NB_ZONES_DE_DEMO = 3;
/** Deux zones plus proches que cela seraient la même, vue de la carte. */
export const ECART_MIN_ZONES_M = 2_000;
export const VEHICULES_PAR_ZONE = 3;
/** Une cellule qui compte moins de départs n'est pas un lieu, c'est un hasard de tournée. */
export const DEPARTS_MIN_PAR_ZONE = 20;

/** Les trois zones, dans l'ordre de fréquentation décroissante du lieu qui les porte. */
const GABARITS = [
  { nom: 'Dépôt principal', rayonM: 250, rule: 'BOTH', couleur: '#10e0a0' },
  { nom: 'Zone de livraison', rayonM: 200, rule: 'BOTH', couleur: '#3b82f6' },
  { nom: 'Site client', rayonM: 200, rule: 'ENTER', couleur: '#f59e0b' },
] as const;

/** Distance entre deux points, en mètres (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Regroupe les lignes (véhicule × cellule) en cellules, centre pondéré par le nombre de départs. */
export function regrouperDeparts(lignes: readonly DepartsParVehicule[]): GrappeDeparts[] {
  const parCellule = new Map<string, { n: number; lat: number; lng: number; vehicules: Map<string, number> }>();
  for (const l of lignes) {
    if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng) || !(l.n > 0)) continue;
    const c = parCellule.get(l.cellule) ?? { n: 0, lat: 0, lng: 0, vehicules: new Map<string, number>() };
    c.n += l.n;
    c.lat += l.lat * l.n;
    c.lng += l.lng * l.n;
    c.vehicules.set(l.vehicleId, (c.vehicules.get(l.vehicleId) ?? 0) + l.n);
    parCellule.set(l.cellule, c);
  }
  return Array.from(parCellule.values())
    .map((c) => ({
      lat: c.lat / c.n,
      lng: c.lng / c.n,
      n: c.n,
      vehicules: Array.from(c.vehicules, ([vehicleId, n]) => ({ vehicleId, n })).sort(
        (a, b) => b.n - a.n || a.vehicleId.localeCompare(b.vehicleId),
      ),
    }))
    .sort((a, b) => b.n - a.n || a.lat - b.lat || a.lng - b.lng);
}

/** Les lieux retenus : les plus fréquentés, écartés d'au moins {@link ECART_MIN_ZONES_M}. */
export function lieuxDeZones(grappes: readonly GrappeDeparts[]): GrappeDeparts[] {
  const retenus: GrappeDeparts[] = [];
  for (const g of grappes) {
    if (retenus.length >= NB_ZONES_DE_DEMO) break;
    if (g.n < DEPARTS_MIN_PAR_ZONE) continue;
    if (retenus.some((r) => distanceM(r, g) < ECART_MIN_ZONES_M)) continue;
    retenus.push(g);
  }
  return retenus;
}

/**
 * Lit, dans la SOURCE, les départs de trajets par véhicule et par cellule d'environ un kilomètre
 * (coordonnées arrondies à 0,01°). Lecture seule, bornée par véhicule × cellule : une cellule qui
 * compte moins de {@link DEPARTS_MIN_PAR_ZONE} / 4 départs pour un véhicule n'est pas retenue,
 * pour ne pas rapatrier tout le semis de la flotte.
 */
export async function lireDepartsPourZones(
  source: PrismaClient,
  vehiculeIdsSource: readonly string[],
  depuis: Date,
): Promise<DepartsParVehicule[]> {
  if (vehiculeIdsSource.length === 0) return [];
  const ids = Prisma.join(vehiculeIdsSource.map((id) => Prisma.sql`${id}::uuid`));
  const lignes = await source.$queryRaw<
    Array<{ vehicleId: string; n: number; lat: number; lng: number; cellule: string }>
  >(Prisma.sql`
    SELECT "vehicleId"::text AS "vehicleId",
           count(*)::int AS n,
           avg("startLat")::float8 AS lat,
           avg("startLng")::float8 AS lng,
           round("startLat"::numeric, 2)::text || ':' || round("startLng"::numeric, 2)::text AS cellule
    FROM "trips"
    WHERE "vehicleId" IN (${ids})
      AND "startedAt" >= ${depuis}
      AND "startLat" IS NOT NULL AND "startLng" IS NOT NULL
    GROUP BY "vehicleId", round("startLat"::numeric, 2), round("startLng"::numeric, 2)
    HAVING count(*) >= ${Math.max(1, Math.floor(DEPARTS_MIN_PAR_ZONE / 4))}
  `);
  return lignes.map((l) => ({ ...l, n: Number(l.n) }));
}

export interface ZoneDeDemo {
  ligne: Prisma.GeofenceUncheckedCreateInput;
  /** Les rattachements zone → véhicule, déjà remappés vers les identifiants de démo. */
  rattachements: Prisma.GeofenceVehicleCreateManyInput[];
}

/**
 * Fabrique les zones. Appelle `ctx.ids.marquer('Geofence', …)` : sans cela l'importeur les
 * supprimerait aussitôt avec « ce que la source n'a plus ».
 */
export function zonesDeDemo(grappes: readonly GrappeDeparts[], ctx: Contexte): ZoneDeDemo[] {
  return lieuxDeZones(grappes).map((lieu, rang) => {
    const gabarit = GABARITS[rang]!;
    const cle = `zone-de-demo-${rang + 1}`;
    const id = ctx.ids.marquer('Geofence', cle);
    const cibles = lieu.vehicules
      .slice(0, VEHICULES_PAR_ZONE)
      .map((v) => ctx.ids.siImporte('Vehicle', v.vehicleId))
      .filter((v): v is string => v !== null);
    return {
      ligne: {
        id,
        fleetId: ctx.idFlotteDemo,
        name: gabarit.nom,
        type: 'CIRCLE',
        rule: gabarit.rule,
        // Arrondi à 5 décimales (≈ 1 m) : la moyenne brute ferait « 43.671283746 » dans la base.
        centerLat: Math.round(lieu.lat * 1e5) / 1e5,
        centerLng: Math.round(lieu.lng * 1e5) / 1e5,
        radiusMeters: gabarit.rayonM,
        polygonPoints: Prisma.JsonNull,
        corridorPoints: Prisma.JsonNull,
        corridorWidthM: null,
        color: gabarit.couleur,
        active: true,
        createdAt: ctx.maintenant,
        updatedAt: ctx.maintenant,
      },
      rattachements: cibles.map((vehicleId) => ({ geofenceId: id, vehicleId, createdAt: ctx.maintenant })),
    };
  });
}
