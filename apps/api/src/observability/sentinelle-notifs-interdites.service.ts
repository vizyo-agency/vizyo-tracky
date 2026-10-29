import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { EmailStatus, PushStatus } from '@prisma/client';
import { DemoModeService } from '../demo/demo-mode.service';
import {
  adresseNue,
  listeBlancheNotifs,
  memeNumero,
  MODELES_EMAIL_AUTOMATIQUES,
  MODELES_PUSH_AUTOMATIQUES,
  MODELES_SMS_AUTOMATIQUES,
} from '../notifications/interrupteur-notifications';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorLogger } from './error-logger.service';
import { CLES_REFROIDISSEMENT, RefroidissementAlerteService } from './refroidissement-alerte.service';

/** Source des lignes écrites au centre d'alerte. */
export const SOURCE_SENTINELLE_NOTIFS = 'sentinelle-notifs';

/**
 * Fenêtre relue à chaque passage. Trois fois le pas du cron : un passage manqué (redéploiement) ne
 * laisse pas de trou, et le refroidissement empêche que le recouvrement n'écrive deux fois la même ligne.
 */
const FENETRE_MS = 15 * 60_000;

/** Une ligne par canal et par heure : une fuite qui dure se rappelle, elle ne se répète pas. */
const REFROIDISSEMENT_MS = 60 * 60_000;

/** Lignes de journal lues au plus par canal et par passage. Un garde-fou ne doit pas peser. */
const MAX_LIGNES = 500;

/** Comptes nommés dans un message ; au-delà, on compte sans énumérer. */
const MAX_NOMMES = 5;

export type CanalNotif = 'push' | 'email' | 'sms';

export interface FuiteNotif {
  canal: CanalNotif;
  /** Nombre d'envois parvenus à un compte hors liste. */
  envois: number;
  /** Comptes (adresse ou numéro) concernés, sans doublon. */
  destinataires: string[];
  /** Modèles d'envoi concernés, avec leur compte. */
  modeles: Record<string, number>;
}

function ajouter(fuites: Map<string, FuiteNotif>, canal: CanalNotif, destinataire: string, modele: string): void {
  const f = fuites.get(canal) ?? { canal, envois: 0, destinataires: [], modeles: {} };
  f.envois += 1;
  if (!f.destinataires.includes(destinataire)) f.destinataires.push(destinataire);
  f.modeles[modele] = (f.modeles[modele] ?? 0) + 1;
  fuites.set(canal, f);
}

/**
 * Phrase écrite au centre d'alerte pour une fuite. Exportée : le test la lit, et l'écran la montre telle quelle.
 */
export function messageFuite(f: FuiteNotif): string {
  const noms = f.destinataires.slice(0, MAX_NOMMES).join(', ');
  const reste = f.destinataires.length > MAX_NOMMES ? ` et ${f.destinataires.length - MAX_NOMMES} autre(s)` : '';
  const modeles = Object.entries(f.modeles)
    .map(([m, n]) => `${m} ×${n}`)
    .join(', ');
  return (
    `Notification automatique (${f.canal}) reçue par un compte hors liste : ${f.envois} envoi(s) vers ${f.destinataires.length} compte(s) ` +
    `— ${noms}${reste} — modèle(s) : ${modeles}. L'interrupteur de sûreté (NOTIFS_ONLY_EMAILS) devait les retenir : ` +
    `un chemin d'envoi le contourne.`
  );
}

/**
 * ══ SENTINELLE — UNE NOTIFICATION AUTOMATIQUE A ATTEINT UN AUTRE COMPTE QUE LE VÔTRE (29/10/2026) ══
 *
 * Demande du propriétaire, le jour où il a coupé les notifications automatiques de tous les comptes sauf
 * le sien pour refaire le système proprement : « ajoute une sentinelle qui surveille si un user autre que
 * admin reçoit une notif, me prévenir dans le centre d'alerte ».
 *
 * Un interrupteur qui retient trois cœurs d'envoi ne dit pas s'il fuit. Les cœurs sont gardés, mais un
 * quatrième chemin d'envoi (un nouveau service, un client HTTP direct) les contournerait sans que rien ne
 * le dise — c'est exactement ainsi que les alertes de vitesse sont parties sans que personne le voie.
 * Cette sentinelle ne regarde pas le CODE : elle regarde ce qui est RÉELLEMENT PARTI, dans les trois
 * journaux (`push_logs`, `email_logs`, `sms_logs`), et compare les destinataires à la liste blanche.
 *
 * Elle lit les MÊMES listes de modèles que l'interrupteur (`interrupteur-notifications.ts`) : les deux ne
 * peuvent pas diverger. Un courriel d'invitation vers un autre compte n'est PAS une fuite — il n'est pas
 * automatique.
 *
 * Liste `NOTIFS_ONLY_EMAILS` vide = interrupteur levé = rien à surveiller : elle se tait. Sinon, une ligne
 * CRITICAL par canal et par heure au plus, qui est relayée aux super-admins par la vigie du centre d'alerte.
 */
@Injectable()
export class SentinelleNotifsInterditesService {
  private readonly logger = new Logger(SentinelleNotifsInterditesService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly errorLogger: ErrorLogger,
    private readonly refroidissement: RefroidissementAlerteService,
    // La démo a ses propres comptes fictifs et aucun interrupteur : la juger créerait de fausses fuites.
    @Optional() private readonly demoMode?: DemoModeService,
  ) {}

  /** Toutes les 5 minutes : une fuite doit se voir dans le quart d'heure, pas le lendemain. */
  @Cron('20 */5 * * * *')
  async controler(now = Date.now()): Promise<FuiteNotif[]> {
    if (this.demoMode?.enabled) return [];
    if (this.running) return [];
    this.running = true;
    try {
      const autorises = listeBlancheNotifs(this.config.get<string>('NOTIFS_ONLY_EMAILS'));
      if (autorises.length === 0) return []; // interrupteur levé : rien à surveiller
      const depuis = new Date(now - FENETRE_MS);
      const fuites = await this.detecter(autorises, depuis);
      for (const f of fuites) await this.signaler(f);
      return fuites;
    } catch (err) {
      // Une sentinelle qui casse le planificateur serait pire que pas de sentinelle. Mais une sentinelle
      // AVEUGLE doit le dire : une ligne par six heures, pour que le silence ne passe pas pour « tout va bien ».
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Sentinelle des notifications interdites : lecture impossible — ${message}`);
      const cle = `${CLES_REFROIDISSEMENT.SENTINELLE_NOTIF_INTERDITE}:lecture`;
      if (await this.refroidissement.tenterEmission(cle, 6 * 3_600_000)) {
        this.errorLogger.recordBackground(
          new Error(`Sentinelle des notifications interdites aveugle : journaux illisibles (${message})`),
          SOURCE_SENTINELLE_NOTIFS,
          { motif: 'lecture' },
          'ERROR',
        );
      }
      return [];
    } finally {
      this.running = false;
    }
  }

  /** Lit les trois journaux et rend, par canal, ce qui est parti vers un compte absent de la liste. */
  async detecter(autorises: string[], depuis: Date): Promise<FuiteNotif[]> {
    const fuites = new Map<string, FuiteNotif>();
    const ok = new Set(autorises);

    // ── Push : une ligne par appareil ciblé, `SENT` = accepté par le service de push du navigateur.
    const pushs = await this.prisma.pushLog.findMany({
      where: {
        status: PushStatus.SENT,
        template: { in: [...MODELES_PUSH_AUTOMATIQUES] },
        createdAt: { gte: depuis },
        userId: { not: null },
      },
      select: { userId: true, template: true },
      take: MAX_LIGNES,
    });
    if (pushs.length > 0) {
      const ids = [...new Set(pushs.map((p) => p.userId).filter((i): i is string => !!i))];
      const comptes = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
      const courriel = new Map(comptes.map((c) => [c.id, (c.email ?? '').toLowerCase()]));
      for (const p of pushs) {
        const mail = courriel.get(p.userId as string) ?? '(compte supprimé)';
        if (!ok.has(mail)) ajouter(fuites, 'push', mail, p.template);
      }
    }

    // ── E-mail : ce qui n'est ni retenu (BLOCKED) ni en échec n'a pas été retenu — donc a pu atteindre quelqu'un.
    const mails = await this.prisma.emailLog.findMany({
      where: {
        template: { in: [...MODELES_EMAIL_AUTOMATIQUES] },
        status: { notIn: [EmailStatus.BLOCKED, EmailStatus.FAILED] },
        createdAt: { gte: depuis },
      },
      select: { toAddress: true, template: true },
      take: MAX_LIGNES,
    });
    for (const m of mails) {
      const dest = m.toAddress.split(',').map(adresseNue).filter(Boolean);
      for (const d of dest) if (!ok.has(d)) ajouter(fuites, 'email', d, m.template);
    }

    // ── SMS : un numéro est « de la liste » s'il est celui d'un compte de la liste.
    const sms = await this.prisma.smsLog.findMany({
      where: {
        direction: 'OUT',
        template: { in: [...MODELES_SMS_AUTOMATIQUES] },
        status: { notIn: ['failed', 'undelivered'] },
        createdAt: { gte: depuis },
      },
      select: { toNumber: true, template: true },
      take: MAX_LIGNES,
    });
    if (sms.length > 0) {
      const comptes = await this.prisma.user.findMany({
        where: { email: { in: autorises, mode: 'insensitive' } },
        select: { phone: true },
      });
      const telephones = comptes.map((c) => c.phone).filter((t): t is string => !!t);
      for (const s of sms) {
        const numero = s.toNumber ?? '(numéro inconnu)';
        if (!telephones.some((t) => memeNumero(t, numero))) ajouter(fuites, 'sms', numero, s.template ?? 'inconnu');
      }
    }

    return [...fuites.values()];
  }

  private async signaler(f: FuiteNotif): Promise<void> {
    const cle = `${CLES_REFROIDISSEMENT.SENTINELLE_NOTIF_INTERDITE}:${f.canal}`;
    if (!(await this.refroidissement.tenterEmission(cle, REFROIDISSEMENT_MS))) return;
    const message = messageFuite(f);
    this.logger.error(`[notifs] FUITE — ${message}`);
    await this.errorLogger.record(
      new Error(message),
      SOURCE_SENTINELLE_NOTIFS,
      { motif: 'notif-interdite', canal: f.canal, envois: f.envois, destinataires: f.destinataires.slice(0, 20), modeles: f.modeles },
      'CRITICAL',
    );
  }
}
