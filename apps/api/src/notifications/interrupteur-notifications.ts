/**
 * ══ INTERRUPTEUR DE SÛRETÉ DES NOTIFICATIONS (29/10/2026) ═══════════════════════════════════
 *
 * Demande du propriétaire : le système de notifications va être refait proprement ; en attendant,
 * AUCUN utilisateur ne doit recevoir de notification — push, e-mail ni SMS — sauf les comptes
 * listés dans `NOTIFS_ONLY_EMAILS` (aujourd'hui : admin@vizyoagency.com).
 *
 * Trois cœurs d'envoi, trois gardes, une seule liste :
 *   - push   → `WebPushService.sendToSubscriptions` (le seul appel à `webpush.sendNotification`) ;
 *   - e-mail → `GardeFouEnvoisService.motifDeRetenue`, appelé par `EmailService.send` ;
 *   - SMS    → `SmsGatewayService.send`, pour les seuls modèles destinés à une PERSONNE.
 *
 * Liste vide = comportement normal. Rien n'est supprimé : les abonnements, les préférences et les
 * règles d'alerte sont intacts, la levée est immédiate (vider la variable, recréer l'API).
 */

/** « a@x.fr, B@x.fr ; c@x.fr » → adresses en minuscules ; vide → liste vide (aucune restriction). */
export function listeBlancheNotifs(brut: string | undefined | null): string[] {
  return (brut ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * Courriels qui ne sont PAS des notifications mais la porte du compte : les retenir enfermerait
 * l'utilisateur dehors (mot de passe oublié, code de vérification d'appareil, désactivation du 2FA),
 * ou perdrait une demande qu'un prospect vient de déposer lui-même sur la page vitrine.
 */
export const MODELES_EMAIL_EXEMPTES: ReadonlySet<string> = new Set([
  'password_reset',
  'device_verification',
  'two_factor_disable',
  'lead',
  'lead_welcome',
  'quote_client',
  'quote_signed',
]);

/**
 * SMS adressés à une personne (client, conducteur, demandeur). Les SMS de COMMANDE adressés à un
 * boîtier (coupe-circuit, audio, mode GPS, provisioning, SIM) n'y figurent volontairement PAS :
 * ce ne sont pas des notifications, et les retenir désarmerait le coupe-circuit.
 */
export const MODELES_SMS_UTILISATEURS: ReadonlySet<string> = new Set([
  'alert_notification',
  'alert_whatsapp',
  'reservation_public',
]);

/** Chiffres seuls d'un numéro, pour comparer « +33 6 12… » et « 06 12… » sans se soucier de la mise en forme. */
export function chiffresDuNumero(numero: string): string {
  return numero.replace(/^whatsapp:/i, '').replace(/\D/g, '');
}

/** Deux numéros désignent-ils la même ligne ? On compare les 9 derniers chiffres (indicatif ignoré). */
export function memeNumero(a: string, b: string): boolean {
  const x = chiffresDuNumero(a);
  const y = chiffresDuNumero(b);
  if (x.length < 6 || y.length < 6) return false;
  return x.slice(-9) === y.slice(-9);
}
