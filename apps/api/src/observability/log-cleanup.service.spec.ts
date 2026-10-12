import { LogCleanupService } from './log-cleanup.service';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import type { SystemActivityService } from '../system-activity/system-activity.service';
import type { ErrorLogger } from './error-logger.service';

/**
 * Lot 1 — purge RÉELLE des journaux SMS (`sms_logs` : numéros + contenu = données personnelles)
 * à 90 jours, avec le garde-fou commun < 30 j.
 */
const DAY = 86_400_000;

function makeService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    WIRE_LOGS_RETENTION_DAYS: 7,
    ERROR_LOGS_RETENTION_DAYS: 30,
    MUTATION_AUDIT_RETENTION_DAYS: 365,
    SMS_LOGS_RETENTION_DAYS: 90,
    ...overrides,
  };
  const prisma = {
    wireLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    errorLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    systemActivityLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    smsLog: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
  };
  const systemActivity = { record: jest.fn() };
  const errorLogger = { recordBackground: jest.fn() };
  const service = new LogCleanupService(
    prisma as unknown as PrismaService,
    { get: (k: string) => values[k] } as unknown as ConfigService<never, true>,
    systemActivity as unknown as SystemActivityService,
    errorLogger as unknown as ErrorLogger,
  );
  return { service, prisma, systemActivity, errorLogger };
}

describe('LogCleanupService — rétention des journaux SMS', () => {
  it('un SMS de 91 j est PURGÉ, un SMS de 89 j est CONSERVÉ (borne 90 j)', async () => {
    const { service, prisma } = makeService();
    await service.cleanupLogs();

    const cutoff = prisma.smsLog.deleteMany.mock.calls[0][0].where.createdAt.lt as Date;
    const now = Date.now();
    expect(new Date(now - 91 * DAY).getTime()).toBeLessThan(cutoff.getTime()); // purgé
    expect(new Date(now - 89 * DAY).getTime()).toBeGreaterThan(cutoff.getTime()); // conservé
    expect(Math.abs(cutoff.getTime() - (now - 90 * DAY))).toBeLessThan(60_000);
  });

  it('la purge SMS est tracée au journal système (catégorie RETENTION)', async () => {
    const { service, systemActivity } = makeService();
    await service.cleanupLogs();
    const entry = systemActivity.record.mock.calls[0][0];
    expect(entry).toMatchObject({ category: 'RETENTION', action: 'logs_purged' });
    expect(entry.meta).toMatchObject({ smsDeleted: 4, smsDays: 90 });
  });

  it('GARDE-FOU : SMS_LOGS_RETENTION_DAYS=10 fait ÉCHOUER le job, aucun journal supprimé', async () => {
    const { service, prisma } = makeService({ SMS_LOGS_RETENTION_DAYS: 10 });
    await expect(service.cleanupLogs()).rejects.toThrow(/30 j/);
    expect(prisma.smsLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.wireLog.deleteMany).not.toHaveBeenCalled(); // le garde-fou passe AVANT toute suppression
  });

  it('le cron rattrape l’échec et le remonte au centre d’alerte (pas de rejet non capté)', async () => {
    const { service, errorLogger } = makeService({ SMS_LOGS_RETENTION_DAYS: 10 });
    await expect(service.runCleanup()).resolves.toBeUndefined();
    expect(errorLogger.recordBackground).toHaveBeenCalledTimes(1);
    expect(errorLogger.recordBackground.mock.calls[0][1]).toBe('cron:log-cleanup');
  });

  it('SMS_LOGS_RETENTION_DAYS=0 : purge SMS désactivée, les autres journaux continuent', async () => {
    const { service, prisma } = makeService({ SMS_LOGS_RETENTION_DAYS: 0 });
    await service.cleanupLogs();
    expect(prisma.smsLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.wireLog.deleteMany).toHaveBeenCalledTimes(1);
  });
});

/**
 * 29/09 — le fil « Agenda » d'une société (catégories RESERVATION et AGENDA du journal système)
 * se lit des mois après : il suit la rétention de l'audit des mutations (365 j), pas les 30 j
 * du journal courant.
 */
describe('LogCleanupService — rétention du journal système (fil Agenda)', () => {
  /** Rejoue un `where` Prisma { createdAt: { lt }, category: …, NOT: {…} } sur une ligne en mémoire. */
  function supprimee(where: any, ligne: { category: string; action?: string; createdAt: Date }): boolean {
    if (!(ligne.createdAt < where.createdAt.lt)) return false;
    if (where.NOT && Object.entries(where.NOT).every(([k, v]) => (ligne as any)[k] === v)) return false;
    const c = where.category;
    if (typeof c === 'string') return ligne.category === c;
    if (c?.in) return c.in.includes(ligne.category);
    if (c?.notIn) return !c.notIn.includes(ligne.category);
    if (c?.not) return ligne.category !== c.not;
    return true;
  }

  function purge(lignes: { category: string; action?: string; ageDays: number }[]) {
    const { service, prisma } = makeService();
    return service.cleanupLogs().then(() => {
      const wheres = prisma.systemActivityLog.deleteMany.mock.calls.map((c: any[]) => c[0].where);
      const now = Date.now();
      return lignes.map((l) => {
        const ligne = { category: l.category, action: l.action, createdAt: new Date(now - l.ageDays * DAY) };
        return { ...l, purgee: wheres.some((w: any) => supprimee(w, ligne)) };
      });
    });
  }

  it('RESERVATION et AGENDA de 200 j sont CONSERVÉES, comme MUTATION ; EMAIL de 31 j est purgé', async () => {
    const r = await purge([
      { category: 'RESERVATION', ageDays: 200 },
      { category: 'AGENDA', ageDays: 200 },
      { category: 'MUTATION', ageDays: 200 },
      { category: 'EMAIL', ageDays: 31 },
      { category: 'AI', ageDays: 31 },
    ]);
    expect(r.map((x) => [x.category, x.purgee])).toEqual([
      ['RESERVATION', false],
      ['AGENDA', false],
      ['MUTATION', false],
      ['EMAIL', true],
      ['AI', true],
    ]);
  });

  it('RESERVATION et AGENDA de 366 j sont purgées (borne 365 j de MUTATION_AUDIT_RETENTION_DAYS)', async () => {
    const r = await purge([
      { category: 'RESERVATION', ageDays: 366 },
      { category: 'AGENDA', ageDays: 366 },
      { category: 'RESERVATION', ageDays: 364 },
    ]);
    expect(r.map((x) => x.purgee)).toEqual([true, true, false]);
  });

  // VPS-055 (12/10/2026) : le marqueur posé par le seed le 07/09 a été purgé à 30 j, et l'import
  // de la démo du 11/10 a refusé d'écrire dans une base « non marquée ».
  it('le marqueur « base de démonstration » n’est JAMAIS purgé, même à 400 j ; les autres lignes DEMO le sont', async () => {
    const r = await purge([
      { category: 'DEMO', action: 'base_de_demonstration', ageDays: 35 },
      { category: 'DEMO', action: 'base_de_demonstration', ageDays: 400 },
      { category: 'DEMO', action: 'refresh_done', ageDays: 31 },
      { category: 'DEMO', action: 'refresh_requested', ageDays: 31 },
      { category: 'DEMO', action: 'refresh_done', ageDays: 29 },
    ]);
    expect(r.map((x) => [x.action, x.ageDays, x.purgee])).toEqual([
      ['base_de_demonstration', 35, false],
      ['base_de_demonstration', 400, false],
      ['refresh_done', 31, true],
      ['refresh_requested', 31, true],
      ['refresh_done', 29, false],
    ]);
  });

  it('l’exemption vise le COUPLE catégorie + action : une action homonyme hors DEMO reste purgée', async () => {
    const r = await purge([{ category: 'EMAIL', action: 'base_de_demonstration', ageDays: 31 }]);
    expect(r[0].purgee).toBe(true);
  });

  it('les deux purges du journal système sont DISJOINTES (aucune catégorie visée deux fois)', async () => {
    const { service, prisma } = makeService();
    await service.cleanupLogs();
    const [courant, audit] = prisma.systemActivityLog.deleteMany.mock.calls.map((c: any[]) => c[0].where);
    expect(courant.category).toEqual({ notIn: ['MUTATION', 'RESERVATION', 'AGENDA'] });
    expect(audit.category).toEqual({ in: ['MUTATION', 'RESERVATION', 'AGENDA'] });
  });
});
