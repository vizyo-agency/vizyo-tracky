import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { listeBlanchePush, WebPushService } from './web-push.service';

/**
 * ══ INTERRUPTEUR DE SÛRETÉ DES NOTIFICATIONS PUSH (29/10/2026) ════════════════════════════════
 *
 * Demande du propriétaire : corriger des bugs sans spammer les utilisateurs. Un seul cœur d'envoi, donc un seul
 * endroit à garder. Ces tests tiennent : rien ne part pour un compte hors liste ; la liste vide ne change rien ;
 * une panne de lecture n'envoie RIEN (échec fermé) ; aucun abonnement n'est supprimé.
 */
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({ statusCode: 201 }),
}));

const ADMIN = 'admin@vizyoagency.com';
const subDe = (userId: string, n = 1) => ({ id: `sub-${userId}-${n}`, endpoint: `https://push.example.test/${userId}/${n}`, p256dh: 'k', auth: 'a', userId });
const payload = { title: 'Alerte', body: 'Corps', template: 'test' } as never;

function monter(listeBlanche: string, comptes: Array<{ id: string; email: string }>) {
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue(comptes) },
    pushSubscription: { findMany: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
    pushLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const env: Record<string, string> = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.test', PUSH_ONLY_EMAILS: listeBlanche };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService<never, true>;
  const service = new WebPushService(prisma as never, config as never, { record: jest.fn() } as never);
  const envoyer = (subs: ReturnType<typeof subDe>[]) =>
    (service as unknown as { sendToSubscriptions: (...a: unknown[]) => Promise<{ sent: number }> }).sendToSubscriptions(subs, payload, 'test', 'push_sent', null, null);
  return { prisma, envoyer };
}

describe('listeBlanchePush', () => {
  it('lit une liste séparée par virgules, points-virgules ou espaces, sans casse', () => {
    expect(listeBlanchePush(' Admin@VizyoAgency.com ; autre@x.test,  c@x.test ')).toEqual(['admin@vizyoagency.com', 'autre@x.test', 'c@x.test']);
  });
  it('vide, absente ou blanche : AUCUNE restriction', () => {
    expect(listeBlanchePush('')).toEqual([]);
    expect(listeBlanchePush(undefined)).toEqual([]);
    expect(listeBlanchePush('   ,; ')).toEqual([]);
  });
});

describe('WebPushService — interrupteur de sûreté', () => {
  beforeEach(() => (webpush.sendNotification as jest.Mock).mockClear());

  it('🔴 liste active : seul le compte autorisé reçoit — les autres sont écartés', async () => {
    const { envoyer } = monter(ADMIN, [{ id: 'admin', email: ADMIN }, { id: 'remy', email: 'remy@a2r.test' }]);
    const r = await envoyer([subDe('admin'), subDe('remy'), subDe('remy', 2)]);
    expect(r.sent).toBe(1);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect((webpush.sendNotification as jest.Mock).mock.calls[0][0].endpoint).toContain('/admin/');
  });

  it('🔴 aucun abonné autorisé : RIEN ne part', async () => {
    const { envoyer } = monter(ADMIN, [{ id: 'remy', email: 'remy@a2r.test' }]);
    const r = await envoyer([subDe('remy')]);
    expect(r.sent).toBe(0);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('la casse de l’e-mail est ignorée', async () => {
    const { envoyer } = monter('ADMIN@vizyoagency.COM', [{ id: 'admin', email: 'Admin@VizyoAgency.com' }]);
    expect((await envoyer([subDe('admin')])).sent).toBe(1);
  });

  it('🔴 ÉCHEC FERMÉ : si les comptes sont illisibles, rien n’est envoyé', async () => {
    const { prisma, envoyer } = monter(ADMIN, []);
    prisma.user.findMany.mockRejectedValue(new Error('base indisponible'));
    const r = await envoyer([subDe('admin')]);
    expect(r.sent).toBe(0);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('aucun abonnement n’est supprimé ni modifié : la levée est immédiate', async () => {
    const { prisma, envoyer } = monter(ADMIN, [{ id: 'remy', email: 'remy@a2r.test' }]);
    await envoyer([subDe('remy')]);
    expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('🔴 liste VIDE : comportement d’avant, tout le monde reçoit', async () => {
    const { prisma, envoyer } = monter('', [{ id: 'remy', email: 'remy@a2r.test' }]);
    const r = await envoyer([subDe('admin'), subDe('remy')]);
    expect(r.sent).toBe(2);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
