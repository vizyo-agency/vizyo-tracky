/**
 * ══ INTERRUPTEUR DE SÛRETÉ DES NOTIFICATIONS (29/10/2026) ═══════════════════════════════════
 *
 * Demande du propriétaire : le système de notifications va être refait proprement ; en attendant,
 * AUCUN utilisateur ne doit recevoir de notification AUTOMATIQUE — push, e-mail ni SMS — sauf les
 * comptes listés dans `NOTIFS_ONLY_EMAILS` (aujourd'hui : admin@vizyoagency.com).
 *
 * Trois cœurs d'envoi, trois gardes, une seule liste de comptes et trois listes de modèles :
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
 * ── CE QUI EST RETENU : LES NOTIFICATIONS AUTOMATIQUES, ET RIEN D'AUTRE ─────────────────────
 *
 * Précision du propriétaire (29/10, 18 h) : seules les notifications DÉCLENCHÉES PAR LE SYSTÈME
 * sont coupées — alertes (batterie faible, GPS perdu, excès de vitesse, géofence, alimentation…),
 * rapport du lundi, rappels. Tout ce qu'un humain déclenche — une invitation, une réservation, une
 * mission assignée, un créneau d'installation, un mot de passe oublié, un devis — part comme avant.
 *
 * D'où des listes FERMÉES de ce qui est retenu (et non de ce qui est exempté) : un nouveau modèle
 * d'envoi passe par défaut, et c'est la sentinelle (`SentinelleNotifsInterditesService`) qui lit les
 * MÊMES listes pour crier si l'une de ces notifications part quand même vers un autre compte.
 */
export const MODELES_EMAIL_AUTOMATIQUES: ReadonlySet<string> = new Set([
  'alert', // alerte véhicule
  'weekly_report', // rapport du lundi (cron)
  'depot_incident', // incident de dépôt, notifié aux gestionnaires
]);

/**
 * SMS automatiques adressés à une personne. Les SMS de COMMANDE adressés à un boîtier (coupe-circuit,
 * audio, mode GPS, provisioning, SIM) n'y figurent volontairement PAS : ce ne sont pas des
 * notifications, et les retenir désarmerait le coupe-circuit.
 */
export const MODELES_SMS_AUTOMATIQUES: ReadonlySet<string> = new Set(['alert_notification', 'alert_whatsapp']);

/**
 * Push automatiques (`PushTemplateId`) : l'alerte véhicule, le rappel d'entretien, le rapport prêt et
 * l'avis système (coupe-circuit, centre d'alerte). Les push « demande à valider » et « assistance » sont
 * la conséquence d'un geste humain : ils partent.
 */
export const MODELES_PUSH_AUTOMATIQUES: ReadonlySet<string> = new Set([
  'alert',
  'maintenance_due',
  'report_ready',
  'system_notice',
]);

/** Extrait l'adresse nue de « Nom <a@x.fr> » ou « a@x.fr », en minuscules. */
export function adresseNue(destinataire: string): string {
  const m = /<([^>]+)>/.exec(destinataire);
  return (m ? m[1] : destinataire).trim().toLowerCase();
}

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
