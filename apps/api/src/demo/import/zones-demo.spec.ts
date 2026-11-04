import {
  ECART_MIN_ZONES_M,
  NB_ZONES_DE_DEMO,
  VEHICULES_PAR_ZONE,
  distanceM,
  lieuxDeZones,
  regrouperDeparts,
  zonesDeDemo,
  type DepartsParVehicule,
} from './zones-demo';
import { Correspondances, type Contexte, Assainisseur } from './transformations';

const SEL = 'un-sel-de-test-suffisamment-long';

function contexte(vehiculesImportes: string[] = []): Contexte {
  const ids = new Correspondances(SEL);
  for (const v of vehiculesImportes) ids.marquer('Vehicle', v);
  return {
    sel: SEL,
    nomFlotte: 'Transports Démo',
    idFlotteDemo: 'f1e2d3c4-0000-5000-8000-000000000001',
    maintenant: new Date('2026-11-04T08:00:00Z'),
    ids,
    assainisseur: new Assainisseur(),
  };
}

/** Une ligne source : `n` départs du véhicule `v` dans la cellule autour de (lat, lng). */
function ligne(v: string, n: number, lat: number, lng: number): DepartsParVehicule {
  return { vehicleId: v, n, lat, lng, cellule: `${lat.toFixed(2)}:${lng.toFixed(2)}` };
}

// Trois lieux distincts d'une flotte toulousaine : le dépôt (très fréquenté), puis deux autres.
const DEPOT = { lat: 43.671, lng: 1.442 };
const LIVRAISON = { lat: 43.604, lng: 1.444 };
const CLIENT = { lat: 43.534, lng: 1.4 };

const DEPARTS: DepartsParVehicule[] = [
  ligne('v1', 400, DEPOT.lat, DEPOT.lng),
  ligne('v2', 380, DEPOT.lat, DEPOT.lng),
  ligne('v3', 300, DEPOT.lat, DEPOT.lng),
  ligne('v4', 50, DEPOT.lat, DEPOT.lng),
  ligne('v5', 120, LIVRAISON.lat, LIVRAISON.lng),
  ligne('v6', 60, LIVRAISON.lat, LIVRAISON.lng),
  ligne('v1', 40, CLIENT.lat, CLIENT.lng),
  ligne('v7', 30, CLIENT.lat, CLIENT.lng),
];

describe('zones de démo (source sans géofence)', () => {
  it('regroupe les départs par cellule, du lieu le plus fréquenté au moins fréquenté', () => {
    const grappes = regrouperDeparts(DEPARTS);
    expect(grappes.map((g) => g.n)).toEqual([1130, 180, 70]);
    expect(grappes[0]!.vehicules.map((v) => v.vehicleId)).toEqual(['v1', 'v2', 'v3', 'v4']);
    // Centre pondéré : il reste sur la cellule, jamais ailleurs.
    expect(distanceM(grappes[0]!, DEPOT)).toBeLessThan(5);
  });

  it('retient au plus trois lieux, distants d\'au moins 2 km — deux cellules voisines sont le MÊME dépôt', () => {
    const voisine = ligne('v8', 900, DEPOT.lat, DEPOT.lng + 0.01); // ≈ 0,8 km du dépôt : même lieu
    const lieux = lieuxDeZones(regrouperDeparts([...DEPARTS, voisine]));
    expect(lieux).toHaveLength(NB_ZONES_DE_DEMO);
    for (let i = 0; i < lieux.length; i++) {
      for (let j = i + 1; j < lieux.length; j++) {
        expect(distanceM(lieux[i]!, lieux[j]!)).toBeGreaterThanOrEqual(ECART_MIN_ZONES_M);
      }
    }
  });

  it("ignore un « lieu » qui n'est qu'un hasard de tournée", () => {
    expect(lieuxDeZones(regrouperDeparts([ligne('v1', 5, 43.7, 1.5)]))).toEqual([]);
    expect(lieuxDeZones([])).toEqual([]);
  });

  it('fabrique des cercles complets, nommés sans rien de la source, rattachés aux véhicules les plus assidus', () => {
    const ctx = contexte(['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']);
    const zones = zonesDeDemo(regrouperDeparts(DEPARTS), ctx);
    expect(zones.map((z) => z.ligne.name)).toEqual(['Dépôt principal', 'Zone de livraison', 'Site client']);

    const depot = zones[0]!;
    expect(depot.ligne).toMatchObject({
      fleetId: ctx.idFlotteDemo,
      type: 'CIRCLE',
      rule: 'BOTH',
      radiusMeters: 250,
      active: true,
      corridorWidthM: null,
    });
    expect(distanceM({ lat: depot.ligne.centerLat as number, lng: depot.ligne.centerLng as number }, DEPOT)).toBeLessThan(5);

    // Pas toute la flotte : trois véhicules au plus, les plus assidus — sinon la cloche déborde.
    expect(depot.rattachements).toHaveLength(VEHICULES_PAR_ZONE);
    expect(depot.rattachements.map((r) => r.vehicleId)).toEqual(
      ['v1', 'v2', 'v3'].map((v) => ctx.ids.id('Vehicle', v)),
    );
    expect(depot.rattachements.every((r) => r.geofenceId === depot.ligne.id)).toBe(true);
  });

  it("marque les zones comme importées — sinon l'importeur les supprimerait avec « ce que la source n'a plus »", () => {
    const ctx = contexte(['v1', 'v2', 'v3', 'v5', 'v7']);
    const zones = zonesDeDemo(regrouperDeparts(DEPARTS), ctx);
    expect(ctx.ids.idsImportes('Geofence').sort()).toEqual(zones.map((z) => z.ligne.id as string).sort());
  });

  it('est déterministe : deux rafraîchissements retrouvent les mêmes zones, avec les mêmes identifiants', () => {
    const a = zonesDeDemo(regrouperDeparts(DEPARTS), contexte(['v1', 'v2', 'v3']));
    const b = zonesDeDemo(regrouperDeparts([...DEPARTS].reverse()), contexte(['v1', 'v2', 'v3']));
    expect(a.map((z) => z.ligne.id)).toEqual(b.map((z) => z.ligne.id));
    expect(a.map((z) => [z.ligne.centerLat, z.ligne.centerLng])).toEqual(b.map((z) => [z.ligne.centerLat, z.ligne.centerLng]));
  });

  it("ne rattache pas un véhicule que l'import n'a pas retenu", () => {
    const zones = zonesDeDemo(regrouperDeparts(DEPARTS), contexte(['v1'])); // seul v1 existe côté démo
    expect(zones[0]!.rattachements).toHaveLength(1);
  });
});
