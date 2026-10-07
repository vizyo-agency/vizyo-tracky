/**
 * ══ L'ÉCHO MOTEUR DU BOÎTIER, QUAND PERSONNE NE L'ATTEND PLUS (incident CDEF31, 06 et 07/10/2026) ══
 *
 * Un boîtier Coban répond à une coupure (`J`) par une trame `imei:<IMEI>,jt,…` et à une remise en
 * route (`K`) par `imei:<IMEI>,kt,…`. Le guetteur d'accusé (`AckWaiterService`) ne les attend que
 * 15 s. Or le 403C n'exécute pas toujours `J` à réception : il peut la DIFFÉRER, puis émet `jt` au
 * moment où il coupe réellement le relais. Mesuré sur un véhicule de CDEF31, deux soirs de suite :
 *
 *   06/10 22:05:20  J envoyé (planning)   → `jt` à 22:07:57, 157 s plus tard
 *   07/10 23:06:45  J envoyé (veilleur)   → `jt` à 23:07:54,  69 s plus tard
 *
 * Les deux fois, l'écho est arrivé APRÈS l'abandon du guetteur, a été ingéré comme une simple
 * position, et la coupure est restée « envoyée » puis « non confirmée » — alors que le véhicule
 * était bel et bien immobilisé. C'est ce qui a privé le veilleur du bouton « Rallumer » deux soirs
 * de suite.
 *
 * Même trou dans l'autre sens (TRK-083 / T71) : un écho arrivé AVANT l'inscription du guetteur
 * (`kt` 0,4 s après l'envoi, le 07/10 à 05:00:05, sur un autre véhicule) est perdu de la même façon.
 *
 * Le serveur TCP diffuse donc tout écho moteur qu'aucun guetteur n'a pris, avec l'heure GPS de la
 * trame. `EngineControlService.onEchoMoteur` rapproche un `jt` de la dernière COUPURE du boîtier
 * (tardif ou précoce) ; un `kt` ne fait que signaler une contradiction — la remise en route garde
 * sa propre route (relance TCP, secours SMS), et son écho précoce reste T71.
 */
export const TRACKER_ENGINE_ECHO_EVENT = 'tracker.engine-echo';

export interface TrackerEngineEchoEvent {
  imei: string;
  /** `jt` = le boîtier vient de couper ; `kt` = il vient de remettre en route. */
  action: 'CUT' | 'RESTORE';
  /** Trame complète, telle que reçue (sans le `;` séparateur). */
  raw: string;
  /** Réception par le serveur, ISO 8601. */
  at: string;
  /**
   * Heure de la trame selon le BOÎTIER (GPS), ISO 8601. C'est elle qui date l'écho : un Coban
   * revide son tampon à la reconnexion, et un `jt` d'hier peut arriver maintenant. Sans heure, un
   * écho ne prouve rien.
   */
  deviceTime: string | null;
}

/**
 * Lit l'écho moteur d'une trame : `'CUT'` pour `jt`, `'RESTORE'` pour `kt`, `null` sinon.
 *
 * Strict, comme le veut C2 (motifs ancrés, IMEI exact) : le premier champ doit être exactement
 * `imei:<IMEI de la session>`, et le mot-clé doit former TOUT le deuxième champ. Un `jt` noyé dans
 * un texte, ou porté par l'IMEI d'un autre boîtier, n'est pas un écho.
 */
export function lireEchoMoteur(imei: string, raw: string): 'CUT' | 'RESTORE' | null {
  const champs = raw.split(',');
  if (champs.length < 2) return null;
  if ((champs[0] ?? '').trim().toLowerCase() !== `imei:${imei}`) return null;
  const motCle = (champs[1] ?? '').trim().toLowerCase();
  if (motCle === 'jt') return 'CUT';
  if (motCle === 'kt') return 'RESTORE';
  return null;
}
