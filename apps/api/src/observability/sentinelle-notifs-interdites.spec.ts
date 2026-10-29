import { EmailStatus, PushStatus } from '@prisma/client';
import { MODELES_EMAIL_AUTOMATIQUES, MODELES_PUSH_AUTOMATIQUES, MODELES_SMS_AUTOMATIQUES } from '../notifications/interrupteur-notifications';
import { messageFuite, SentinelleNotifsInterditesService, SOURCE_SENTINELLE_NOTIFS } from './sentinelle-notifs-interdites.service';

/**
 * ══ SENTINELLE DES NOTIFICATIONS INTERDITES (29/10/2026) ═══════════════════════════════════════
 *
 * Elle lit ce qui est RÉELLEMENT parti (push_logs, email_logs, sms_logs) et crie au centre d'alerte si une
 * notification AUTOMATIQUE a atteint un compte hors `NOTIFS_ONLY_EMAILS`. Ces tests tiennent : elle crie
 * quand il faut, elle se tait pour le compte autorisé et pour un courriel qu'un humain a déclenché, elle se
 * tait interrupteur levé, elle ne répète pas la même ligne dans l'heure, et elle ne crie jamais sur la démo.
 */
const ADMIN = 'admin@vizyoagency.com';
const MAINTENANT = Date.parse('2026-10-29T17:00:00Z');

interface Donnees {
  push?: Array<{ userId: string | null; template: string }>;
  email?: Array<{ toAddress: string; template: string }>;
  sms?: Array<{ toNumber: string | null; template: string | null }>;
  comptes?: Array<{ id: string; email: string; phone?: string | null }>;
}

function monter(liste: string, d: Donnees = {}, opts: { demo?: boolean; emission?: boolean; panne?: boolean } = {}) {
  const comptes = d.comptes ?? [];
  const prisma = {
    pushLog: { findMany: opts.panne ? jest.fn().mockRejectedValue(new Error('base')) : jest.fn().mockResolvedValue(d.push ?? []) },
    emailLog: { findMany: jest.fn().mockResolvedValue(d.email ?? []) },
    smsLog: { findMany: jest.fn().mockResolvedValue(d.sms ?? []) },
    user: { findMany: jest.fn().mockResolvedValue(comptes) },
  };
  const errorLogger = { record: jest.fn().mockResolvedValue('id'), recordBackground: jest.fn() };
  const refroidissement = { tenterEmission: jest.fn().mockResolvedValue(opts.emission ?? true) };
  const config = { get: (k: string) => (k === 'NOTIFS_ONLY_EMAILS' ? liste : undefined) };
  const demo = opts.demo ? { enabled: true } : undefined;
  const service = new SentinelleNotifsInterditesService(prisma as never, config as never, errorLogger as never, refroidissement as never, demo as never);
  return { service, prisma, errorLogger, refroidissement };
}

describe('SentinelleNotifsInterditesService', () => {
  it('🔴 un push automatique reçu par un autre compte : une ligne CRITICAL au centre d’alerte', async () => {
    const { service, errorLogger } = monter(ADMIN, {
      push: [{ userId: 'remy', template: 'alert' }, { userId: 'remy', template: 'alert' }],
      comptes: [{ id: 'remy', email: 'remy@a2r.test' }],
    });
    const fuites = await service.controler(MAINTENANT);
    expect(fuites).toHaveLength(1);
    expect(fuites[0]).toMatchObject({ canal: 'push', envois: 2, destinataires: ['remy@a2r.test'], modeles: { alert: 2 } });
    expect(errorLogger.record).toHaveBeenCalledTimes(1);
    const [erreur, source, contexte, niveau] = errorLogger.record.mock.calls[0];
    expect(source).toBe(SOURCE_SENTINELLE_NOTIFS);
    expect(niveau).toBe('CRITICAL');
    expect(String((erreur as Error).message)).toMatch(/remy@a2r\.test/);
    expect(contexte).toMatchObject({ canal: 'push', envois: 2 });
  });

  it('le compte autorisé reçoit : aucune ligne', async () => {
    const { service, errorLogger } = monter(ADMIN, {
      push: [{ userId: 'admin', template: 'alert' }],
      email: [{ toAddress: 'Admin <Admin@VizyoAgency.com>', template: 'alert' }],
      sms: [{ toNumber: '+33611111111', template: 'alert_notification' }],
      comptes: [{ id: 'admin', email: 'Admin@VizyoAgency.com', phone: '06 11 11 11 11' }],
    });
    expect(await service.controler(MAINTENANT)).toEqual([]);
    expect(errorLogger.record).not.toHaveBeenCalled();
  });

  it('🔴 un courriel automatique parti vers un autre destinataire : détecté, plusieurs destinataires compris', async () => {
    const { service } = monter(ADMIN, { email: [{ toAddress: `${ADMIN}, remy@a2r.test`, template: 'weekly_report' }] });
    const fuites = await service.controler(MAINTENANT);
    expect(fuites).toHaveLength(1);
    expect(fuites[0]).toMatchObject({ canal: 'email', destinataires: ['remy@a2r.test'], modeles: { weekly_report: 1 } });
  });

  it('🔴 un SMS d’alerte parti vers un autre numéro : détecté', async () => {
    const { service } = monter(ADMIN, {
      sms: [{ toNumber: '+33699999999', template: 'alert_notification' }],
      comptes: [{ id: 'admin', email: ADMIN, phone: '+33611111111' }],
    });
    const fuites = await service.controler(MAINTENANT);
    expect(fuites).toHaveLength(1);
    expect(fuites[0]).toMatchObject({ canal: 'sms', destinataires: ['+33699999999'] });
  });

  it('une ligne par canal : trois canaux qui fuient, trois lignes', async () => {
    const { service, errorLogger } = monter(ADMIN, {
      push: [{ userId: 'remy', template: 'alert' }],
      email: [{ toAddress: 'remy@a2r.test', template: 'alert' }],
      sms: [{ toNumber: '+33699999999', template: 'alert_whatsapp' }],
      comptes: [{ id: 'remy', email: 'remy@a2r.test' }],
    });
    await service.controler(MAINTENANT);
    expect(errorLogger.record).toHaveBeenCalledTimes(3);
  });

  it('🔴 elle ne lit QUE les modèles automatiques : une invitation n’est pas une fuite', async () => {
    const { service, prisma } = monter(ADMIN);
    await service.controler(MAINTENANT);
    expect(prisma.pushLog.findMany.mock.calls[0][0].where.template.in).toEqual([...MODELES_PUSH_AUTOMATIQUES]);
    expect(prisma.pushLog.findMany.mock.calls[0][0].where.status).toBe(PushStatus.SENT);
    const where = prisma.emailLog.findMany.mock.calls[0][0].where;
    expect(where.template.in).toEqual([...MODELES_EMAIL_AUTOMATIQUES]);
    expect(where.template.in).not.toContain('invitation');
    expect(where.status.notIn).toEqual(expect.arrayContaining([EmailStatus.BLOCKED, EmailStatus.FAILED]));
    expect(prisma.smsLog.findMany.mock.calls[0][0].where.template.in).toEqual([...MODELES_SMS_AUTOMATIQUES]);
  });

  it('🔴 interrupteur levé (liste vide) : elle se tait et ne lit rien', async () => {
    const { service, prisma, errorLogger } = monter('', { push: [{ userId: 'remy', template: 'alert' }] });
    expect(await service.controler(MAINTENANT)).toEqual([]);
    expect(prisma.pushLog.findMany).not.toHaveBeenCalled();
    expect(errorLogger.record).not.toHaveBeenCalled();
  });

  it('🔴 la démo n’est jamais jugée', async () => {
    const { service, prisma } = monter(ADMIN, { push: [{ userId: 'remy', template: 'alert' }] }, { demo: true });
    expect(await service.controler(MAINTENANT)).toEqual([]);
    expect(prisma.pushLog.findMany).not.toHaveBeenCalled();
  });

  it('🔴 refroidissement : une fuite déjà signalée dans l’heure n’écrit pas une seconde ligne', async () => {
    const { service, errorLogger, refroidissement } = monter(
      ADMIN,
      { push: [{ userId: 'remy', template: 'alert' }], comptes: [{ id: 'remy', email: 'remy@a2r.test' }] },
      { emission: false },
    );
    const fuites = await service.controler(MAINTENANT);
    expect(fuites).toHaveLength(1); // la fuite est vue…
    expect(refroidissement.tenterEmission).toHaveBeenCalledWith('sentinelle-notif-interdite:push', 3_600_000);
    expect(errorLogger.record).not.toHaveBeenCalled(); // …mais pas répétée
  });

  it('🔴 journaux illisibles : elle ne lève jamais et dit qu’elle est aveugle', async () => {
    const { service, errorLogger } = monter(ADMIN, {}, { panne: true });
    await expect(service.controler(MAINTENANT)).resolves.toEqual([]);
    expect(errorLogger.recordBackground).toHaveBeenCalledWith(expect.any(Error), SOURCE_SENTINELLE_NOTIFS, { motif: 'lecture' }, 'ERROR');
  });

  it('le message nomme les comptes (cinq au plus) et le modèle', () => {
    const m = messageFuite({
      canal: 'push',
      envois: 9,
      destinataires: ['a@x.t', 'b@x.t', 'c@x.t', 'd@x.t', 'e@x.t', 'f@x.t', 'g@x.t'],
      modeles: { alert: 9 },
    });
    expect(m).toContain('a@x.t');
    expect(m).toContain('et 2 autre(s)');
    expect(m).toContain('alert ×9');
    expect(m).not.toContain('f@x.t');
  });
});
