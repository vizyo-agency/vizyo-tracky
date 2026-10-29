import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { swallow } from '../error/swallow';
import { AuthService } from './auth.service';
import { ANNOUNCEMENT_CONTENTS, AnnouncementContent } from './announcements.registry';

interface ActiveAnnouncement {
  id: string;
  startsAt: string;
  endsAt: string;
}

/** Ce que le navigateur retient d'une annonce pour un compte : fermée un jour donné, ou pour de bon. */
interface Memo {
  vu?: string;
  fini?: boolean;
}

/**
 * Popups d'information à durée limitée. L'API dit lesquelles sont ouvertes à l'utilisateur
 * (`GET /api/announcements/active`) ; ce service ne garde que celle à afficher maintenant.
 *
 * Fermer la popup la masque jusqu'au lendemain ; « J'ai compris » la masque pour de bon. La
 * mémoire est PAR COMPTE (le poste du veilleur est partagé) et uniquement dans le navigateur :
 * une donnée vidée ou un autre appareil la fait simplement réapparaître, ce qui est sans gravité
 * pour une information. Tout accès au stockage est protégé : il peut lever (navigation privée).
 */
@Injectable({ providedIn: 'root' })
export class AnnouncementsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly ouvertes = signal<ActiveAnnouncement[]>([]);
  /** Fermées pendant cette session : évite de les rouvrir au prochain rechargement de la liste. */
  private readonly fermees = signal<ReadonlySet<string>>(new Set());
  /** Incrémenté à chaque écriture de la mémoire, pour que `courante` se recalcule. */
  private readonly memoVersion = signal(0);

  /** L'annonce à afficher maintenant, ou null. */
  readonly courante = computed<AnnouncementContent | null>(() => {
    this.memoVersion();
    const maintenant = Date.now();
    for (const a of this.ouvertes()) {
      const contenu = ANNOUNCEMENT_CONTENTS[a.id];
      if (!contenu) continue;
      // L'API a déjà filtré ; on revérifie l'horloge au cas où l'onglet reste ouvert des jours.
      if (maintenant < Date.parse(a.startsAt) || maintenant >= Date.parse(a.endsAt)) continue;
      if (this.fermees().has(a.id)) continue;
      const memo = this.lire(a.id);
      if (memo.fini || memo.vu === this.aujourdhui()) continue;
      return contenu;
    }
    return null;
  });

  async load(): Promise<void> {
    // Le service survit à la déconnexion : un nouveau compte dans le même onglet repart de zéro.
    this.fermees.set(new Set());
    try {
      this.ouvertes.set(await firstValueFrom(this.http.get<ActiveAnnouncement[]>('/api/announcements/active')));
    } catch (err) {
      // Une information facultative ne doit jamais gêner : liste vide, on réessaiera au prochain démarrage.
      swallow('announcements:load', err);
      this.ouvertes.set([]);
    }
  }

  /** « Fermer » : masquée jusqu'à demain. */
  fermer(id: string): void {
    this.fermees.update((s) => new Set(s).add(id));
    this.ecrire(id, { vu: this.aujourdhui() });
  }

  /** « J'ai compris » : ne plus l'afficher. */
  terminer(id: string): void {
    this.fermees.update((s) => new Set(s).add(id));
    this.ecrire(id, { fini: true });
  }

  private aujourdhui(): string {
    // Jour calendaire LOCAL (format ISO) : « jusqu'à demain » suit l'horloge du poste.
    return new Date().toLocaleDateString('sv-SE');
  }

  private cle(id: string): string {
    return `vizyo-tracky-annonce:${this.auth.user()?.sub ?? '-'}:${id}`;
  }

  private lire(id: string): Memo {
    try {
      const brut = localStorage.getItem(this.cle(id));
      return brut ? (JSON.parse(brut) as Memo) : {};
    } catch {
      return {};
    }
  }

  private ecrire(id: string, memo: Memo): void {
    try {
      localStorage.setItem(this.cle(id), JSON.stringify(memo));
    } catch (err) {
      swallow('announcements:memo', err);
    }
    this.memoVersion.update((v) => v + 1);
  }
}
