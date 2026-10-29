import { GardeFouEnvoisService } from '../email/garde-fou-envois.service';
import { SmsGatewayService } from '../sms/sms-gateway.service';
import { adresseNue, chiffresDuNumero, listeBlancheNotifs, memeNumero, MODELES_EMAIL_AUTOMATIQUES, MODELES_PUSH_AUTOMATIQUES, MODELES_SMS_AUTOMATIQUES } from './interrupteur-notifications';

/**
 * ══ INTERRUPTEUR DE SÛRETÉ — E-MAIL ET SMS (29/10/2026) ═══════════════════════════════════════
 *
 * Aucune notification AUTOMATIQUE (alerte, rapport du lundi…) n'est reçue sauf par les comptes de
 * `NOTIFS_ONLY_EMAILS`. Ces tests tiennent surtout ce qui ne doit JAMAIS être retenu : tout courriel
 * qu'un humain déclenche (invitation, mot de passe, mission, créneau, devis) et les SMS de COMMANDE
 * adressés aux boîtiers (sinon on désarme le coupe-circuit).
 */
const ADMIN = 'admin@vizyoagency.com';

function garde(liste: string) {
  const config = { get: (k: string) => (k === 'NOTIFS_ONLY_EMAILS' ? liste : undefined) };
  return new GardeFouEnvoisService(config as never, {} as never, { record: jest.fn() } as never);
}

describe('listeBlancheNotifs / numéros', () => {
  it('lit la liste sans casse ; vide = aucune restriction', () => {
    expect(listeBlancheNotifs(' Admin@VizyoAgency.com ; b@x.test ')).toEqual([ADMIN, 'b@x.test']);
    expect(listeBlancheNotifs('')).toEqual([]);
    expect(listeBlancheNotifs(undefined)).toEqual([]);
  });
  it('compare les numéros sur les 9 derniers chiffres, quelle que soit la mise en forme', () => {
    expect(chiffresDuNumero('whatsapp:+33 6 12 34 56 78')).toBe('33612345678');
    expect(memeNumero('+33612345678', '06 12 34 56 78')).toBe(true);
    expect(memeNumero('+33612345678', '+33699999999')).toBe(false);
    expect(memeNumero('123', '123')).toBe(false);
  });
  it('🔴 les SMS de commande aux boîtiers ne sont PAS dans la liste des SMS retenus', () => {
    for (const t of ['engine_control_fallback', 'tracker_provisioning', 'fix_mode_fallback', 'audio_arm', 'audio_disarm', 'tracker_command_sms', 'sim_direct', 'gateway_heartbeat']) {
      expect(MODELES_SMS_AUTOMATIQUES.has(t)).toBe(false);
    }
  });
  it('🔴 les courriels déclenchés par un humain ne sont PAS retenus (invitation en tête)', () => {
    for (const t of ['invitation', 'password_reset', 'device_verification', 'two_factor_disable', 'mission_assigned', 'mission_tournee_modifiee', 'mission_request', 'reservation_request_pending', 'installation_slot_requested', 'installation_slot_confirmed', 'partner_consent_invitation', 'lead', 'quote_client']) {
      expect(MODELES_EMAIL_AUTOMATIQUES.has(t)).toBe(false);
    }
  });
  it('les notifications automatiques sont bien dans les listes', () => {
    expect(MODELES_EMAIL_AUTOMATIQUES.has('alert')).toBe(true);
    expect(MODELES_EMAIL_AUTOMATIQUES.has('weekly_report')).toBe(true);
    expect(MODELES_SMS_AUTOMATIQUES.has('alert_notification')).toBe(true);
    expect(MODELES_SMS_AUTOMATIQUES.has('alert_whatsapp')).toBe(true);
    expect(MODELES_PUSH_AUTOMATIQUES.has('alert')).toBe(true);
  });
  it('adresseNue lit « Nom <a@x.fr> » et « A@X.fr »', () => {
    expect(adresseNue('Admin <Admin@VizyoAgency.com>')).toBe(ADMIN);
    expect(adresseNue(' A@X.fr ')).toBe('a@x.fr');
  });
});

describe('Interrupteur — e-mail (GardeFouEnvoisService)', () => {
  it('🔴 liste active : une notification AUTOMATIQUE vers un autre destinataire est retenue', async () => {
    const g = garde(ADMIN);
    expect(await g.motifDeRetenue({ canal: 'email', destinataire: 'remy@a2r.test', modele: 'alert' })).toMatch(/NOTIFS_ONLY_EMAILS/);
    expect(await g.motifDeRetenue({ canal: 'email', destinataire: 'remy@a2r.test', modele: 'weekly_report' })).toMatch(/NOTIFS_ONLY_EMAILS/);
    expect(await g.motifDeRetenue({ canal: 'email', destinataire: 'remy@a2r.test', modele: 'depot_incident' })).toMatch(/NOTIFS_ONLY_EMAILS/);
  });
  it('🔴 liste active : tout courriel déclenché par un humain PART (invitation, mot de passe, mission, créneau…)', async () => {
    const g = garde(ADMIN);
    for (const modele of ['invitation', 'password_reset', 'device_verification', 'mission_assigned', 'installation_slot_confirmed', 'reservation_request_pending', null]) {
      expect(await g.motifDeRetenue({ canal: 'email', destinataire: 'remy@a2r.test', modele })).toBeNull();
    }
  });
  it('le compte autorisé reçoit, casse et « Nom <adresse> » compris', async () => {
    const g = garde(ADMIN);
    expect(await g.motifDeRetenue({ canal: 'email', destinataire: 'Admin@VizyoAgency.com', modele: 'alert' })).toBeNull();
    expect(await g.motifDeRetenue({ canal: 'email', destinataire: 'Admin <admin@vizyoagency.com>', modele: 'alert' })).toBeNull();
  });
  it('plusieurs destinataires : TOUS doivent être autorisés', async () => {
    const g = garde(ADMIN);
    expect(await g.motifDeRetenue({ canal: 'email', destinataire: `${ADMIN}, remy@a2r.test`, modele: 'alert' })).toMatch(/NOTIFS_ONLY_EMAILS/);
  });
  it('🔴 liste VIDE : comportement d’avant, rien n’est retenu', async () => {
    const g = garde('');
    expect(await g.motifDeRetenue({ canal: 'email', destinataire: 'remy@a2r.test', modele: 'alert' })).toBeNull();
  });
});

describe('Interrupteur — SMS (SmsGatewayService)', () => {
  function sms(liste: string, comptes: Array<{ phone: string | null }>, panne = false) {
    const prisma = {
      user: { findMany: panne ? jest.fn().mockRejectedValue(new Error('base')) : jest.fn().mockResolvedValue(comptes) },
      smsLog: { create: jest.fn().mockResolvedValue({ id: 'l1' }) },
    };
    const record = jest.fn();
    const config = { get: (k: string) => (k === 'NOTIFS_ONLY_EMAILS' ? liste : undefined) };
    const service = new SmsGatewayService(prisma as never, { record: jest.fn() } as never, { emit: jest.fn() } as never, { record } as never, config as never);
    return { service, prisma, record };
  }

  it('🔴 SMS d’alerte vers un autre numéro : retenu, sans écriture ni envoi, ok:true', async () => {
    const { service, prisma, record } = sms(ADMIN, [{ phone: '+33611111111' }]);
    const r = await service.send('+33699999999', 'Alerte', { template: 'alert_notification' });
    expect(r.ok).toBe(true);
    expect(r.submittedStatus).toBe('retenu');
    expect(prisma.smsLog.create).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sms_retenu' }));
  });
  it('🔴 échec FERMÉ : comptes illisibles, le SMS de notification est retenu', async () => {
    const { service } = sms(ADMIN, [], true);
    const r = await service.send('+33611111111', 'Alerte', { template: 'alert_notification' });
    expect(r.submittedStatus).toBe('retenu');
  });
  it('🔴 une COMMANDE à un boîtier n’est jamais retenue, liste active ou non', async () => {
    const { service, prisma } = sms(ADMIN, []);
    const r = await service.send('+34590103060', 'cmd', { template: 'engine_control_fallback' });
    expect(r.submittedStatus).not.toBe('retenu');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
  it('🔴 un SMS déclenché par un humain (réservation publique) PART, liste active', async () => {
    const { service, prisma } = sms(ADMIN, []);
    const r = await service.send('+33699999999', 'Votre réservation', { template: 'reservation_public' });
    expect(r.submittedStatus).not.toBe('retenu');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
  it('liste vide : un SMS d’alerte part comme avant', async () => {
    const { service } = sms('', []);
    const r = await service.send('+33699999999', 'Alerte', { template: 'alert_notification' });
    expect(r.submittedStatus).not.toBe('retenu');
  });
});
