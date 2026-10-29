import { UserRole } from '@prisma/client';
import { activeAnnouncementsFor, AnnouncementDef } from './announcements.catalog';

const DEF: AnnouncementDef = {
  id: 'test',
  startsAt: new Date('2026-10-29T00:00:00+01:00'),
  endsAt: new Date('2026-11-03T00:00:00+01:00'),
  roles: [UserRole.NIGHT_WATCHMAN, UserRole.SUPER_ADMIN],
  fleetNames: ['cdef31'],
};
const PENDANT = new Date('2026-10-30T10:00:00+01:00');

describe('activeAnnouncementsFor', () => {
  it('montre l annonce à un veilleur, quelle que soit sa société', () => {
    expect(activeAnnouncementsFor([DEF], { role: UserRole.NIGHT_WATCHMAN, fleetName: 'Autre' }, PENDANT)).toHaveLength(1);
  });

  it('montre l annonce à un super-admin sans société', () => {
    expect(activeAnnouncementsFor([DEF], { role: UserRole.SUPER_ADMIN, fleetName: null }, PENDANT)).toHaveLength(1);
  });

  it('montre l annonce à tout compte de la société ciblée, casse et espaces ignorés', () => {
    for (const role of [UserRole.FLEET_ADMIN, UserRole.FLEET_MANAGER, UserRole.VIEWER, UserRole.DRIVER]) {
      expect(activeAnnouncementsFor([DEF], { role, fleetName: '  CDEF31 ' }, PENDANT)).toHaveLength(1);
    }
  });

  it('reconnaît le nom long de la société en base de développement', () => {
    const viewer = { role: UserRole.FLEET_ADMIN, fleetName: "CDEF 31 — Centre Dép. de l'Enfant et de la Famille" };
    expect(activeAnnouncementsFor([DEF], viewer, PENDANT)).toHaveLength(1);
  });

  it('un motif vide ne reconnaît aucune société', () => {
    const def = { ...DEF, roles: [], fleetNames: ['', ' - '] };
    expect(activeAnnouncementsFor([def], { role: UserRole.VIEWER, fleetName: 'Transports Dupont' }, PENDANT)).toEqual([]);
  });

  it('ne montre rien aux autres sociétés ni à un compte sans société', () => {
    expect(activeAnnouncementsFor([DEF], { role: UserRole.FLEET_ADMIN, fleetName: 'Transports Dupont' }, PENDANT)).toEqual([]);
    expect(activeAnnouncementsFor([DEF], { role: UserRole.FLEET_ADMIN, fleetName: null }, PENDANT)).toEqual([]);
  });

  it('respecte la période : fermée avant le début, ouverte au début, fermée à la fin exacte', () => {
    const viewer = { role: UserRole.NIGHT_WATCHMAN, fleetName: null };
    expect(activeAnnouncementsFor([DEF], viewer, new Date('2026-10-28T23:59:59+01:00'))).toEqual([]);
    expect(activeAnnouncementsFor([DEF], viewer, DEF.startsAt)).toHaveLength(1);
    expect(activeAnnouncementsFor([DEF], viewer, new Date('2026-11-02T23:59:59+01:00'))).toHaveLength(1);
    expect(activeAnnouncementsFor([DEF], viewer, DEF.endsAt)).toEqual([]);
  });
});
