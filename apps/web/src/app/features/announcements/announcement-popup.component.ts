import { ChangeDetectionStrategy, Component, computed, HostListener, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Info, LucideAngularModule, X } from 'lucide-angular';
import { AnnouncementsService } from '../../core/services/announcements.service';
import { ConsentService } from '../../core/services/consent.service';
import { OnboardingService } from '../../core/services/onboarding.service';
import { PermissionOnboardingService } from '../../core/services/permission-onboarding.service';
import { SecurityService } from '../../core/services/security.service';

/**
 * Popup d'information à durée limitée (voir `AnnouncementsService`). Refusable : elle ne bloque
 * rien et cède la place à tout ce qui est plus prioritaire (consentement, vérification
 * d'appareil, proposition 2FA, premiers pas). Fermer = jusqu'à demain ; « J'ai compris » = pour de bon.
 */
@Component({
  selector: 'app-announcement-popup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    @if (annonce(); as a) {
      @if (libre()) {
        <!--
          MÊME HABILLAGE QUE LA FENÊTRE D'ATTENTE DES COMMANDES MOTEUR (29/10/2026) : voile flouté, carte
          centrée, icône en tête, liste à pastilles, gros bouton plein. Un seul langage visuel pour tout ce
          qui s'impose à l'écran.
        -->
        <div class="an-voile" (click)="fermer(a.id)">
          <div class="an-carte" role="dialog" aria-modal="true" aria-labelledby="an-titre" (click)="$event.stopPropagation()">
            <button type="button" class="an-x" aria-label="Fermer" (click)="fermer(a.id)">
              <lucide-icon [img]="X" [size]="18"></lucide-icon>
            </button>

            <span class="an-icone" aria-hidden="true"><lucide-icon [img]="Info" [size]="30"></lucide-icon></span>
            <h1 id="an-titre" class="an-titre">{{ a.titre }}</h1>
            <p class="an-sous-titre">Information · quelques jours seulement</p>
            <p class="an-intro">{{ a.intro }}</p>

            @if (a.video; as v) {
              @if (urlVideo(); as src) {
                <div class="an-video">
                  <iframe [src]="src" [title]="v.titre" loading="lazy"></iframe>
                </div>
              }
            }

            <ol class="an-points">
              @for (p of a.points; track p.titre) {
                <li class="an-point">
                  <span class="an-pastille" aria-hidden="true"></span>
                  <span class="an-point-txt"><strong>{{ p.titre }}</strong> {{ p.texte }}</span>
                </li>
              }
            </ol>

            <button type="button" class="an-btn" (click)="terminer(a.id)">J'ai compris</button>
            <button type="button" class="an-lien" (click)="fermer(a.id)">Me le rappeler demain</button>
          </div>
        </div>
      }
    }
  `,
  styles: [
    `
    /* Voile et carte : mêmes valeurs que .ec-suivi-voile / .ec-suivi (engine-control-button). */
    .an-voile {
      /* 7100 : AU-DESSUS de la barre de navigation du bas (7000) — à 3700 elle masquait le pied de la feuille mobile. */
      position: fixed; inset: 0; z-index: 7100; display: flex; align-items: center; justify-content: center;
      padding: 16px; background: color-mix(in srgb, var(--bg-primary) 62%, transparent);
      backdrop-filter: blur(3px); font-family: inherit;
    }
    .an-carte {
      position: relative; width: 100%; max-width: 460px; max-height: 92vh; max-height: 92dvh; overflow-y: auto;
      padding: 24px 22px 14px; text-align: center;
      background: var(--bg-secondary); border: 1px solid var(--border-strong); border-radius: var(--radius-card, 18px);
    }
    .an-x {
      position: absolute; top: 8px; right: 8px; width: 44px; height: 44px;
      display: inline-flex; align-items: center; justify-content: center;
      background: none; border: 0; border-radius: 12px; cursor: pointer; color: var(--fg-secondary);
    }
    .an-x:hover { color: var(--fg-primary); }
    .an-icone { display: inline-flex; color: var(--texte-succes); }
    .an-titre { margin: 10px 0 2px; font-size: 1.15rem; font-weight: 800; letter-spacing: -.01em; color: var(--fg-primary); }
    .an-sous-titre { margin: 0 0 12px; font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--fg-secondary); }
    .an-intro { margin: 0 0 14px; font-size: .88rem; line-height: 1.55; color: var(--fg-secondary); text-wrap: pretty; }

    .an-video {
      aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; margin: 0 0 14px;
      background: #080b0a; border: 1px solid var(--border-strong);
    }
    .an-video iframe { width: 100%; height: 100%; border: 0; display: block; }

    .an-points { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-direction: column; gap: 9px; text-align: left; }
    .an-point { display: flex; align-items: flex-start; gap: 10px; font-size: .86rem; line-height: 1.5; color: var(--fg-secondary); }
    .an-pastille { width: 9px; height: 9px; border-radius: 9999px; flex: none; margin-top: 7px; background: var(--color-tracky-light); }
    .an-point-txt strong { display: block; color: var(--fg-primary); font-weight: 700; }

    .an-btn {
      width: 100%; min-height: 46px; font: inherit; font-weight: 700; font-size: .95rem; cursor: pointer; border: 0;
      border-radius: 12px; background: var(--color-tracky-light); color: var(--accent-ink);
    }
    .an-lien {
      display: flex; align-items: center; justify-content: center; width: 100%; min-height: 44px;
      font: inherit; font-size: .82rem; font-weight: 600; background: none; border: 0; cursor: pointer;
      color: var(--fg-secondary); border-radius: 10px;
    }
    .an-lien:hover { color: var(--fg-primary); text-decoration: underline; }

    /* Sous 640 px : une feuille, comme la proposition 2FA (mêmes jetons de plateforme). */
    @media (max-width: 639px) {
      .an-voile { align-items: flex-end; padding: 0; }
      .an-carte {
        max-width: none; border: 0;
        border-top-left-radius: var(--feuille-rayon); border-top-right-radius: var(--feuille-rayon);
        border-bottom-left-radius: 0; border-bottom-right-radius: 0;
        padding: 22px 20px calc(12px + env(safe-area-inset-bottom)); max-height: 90vh; max-height: 90dvh;
      }
    }
    `,
  ],
})
export class AnnouncementPopupComponent {
  private readonly annonces = inject(AnnouncementsService);
  private readonly consent = inject(ConsentService);
  private readonly security = inject(SecurityService);
  private readonly onboarding = inject(OnboardingService);
  private readonly permsOnboard = inject(PermissionOnboardingService);

  private readonly sanitizer = inject(DomSanitizer);

  readonly X = X;
  readonly Info = Info;
  readonly annonce = this.annonces.courante;

  /**
   * Adresse de la scène animée. Angular refuse une adresse d'iframe dynamique sans cette
   * déclaration ; elle vient d'une constante du registre (jamais d'une saisie ni de l'API).
   * Un `computed` pour garder le MÊME objet d'un cycle à l'autre : un nouvel objet à chaque
   * détection de changement rechargerait l'iframe en boucle.
   */
  readonly urlVideo = computed<SafeResourceUrl | null>(() => {
    const v = this.annonce()?.video;
    return v ? this.sanitizer.bypassSecurityTrustResourceUrl(v.src) : null;
  });

  /** Rien de plus prioritaire n'occupe l'écran. */
  libre(): boolean {
    return (
      !this.consent.mustAccept() &&
      !this.security.mustVerify() &&
      !this.security.propose() &&
      !this.onboarding.shouldShow() &&
      !this.permsOnboard.shouldOnboard()
    );
  }

  fermer(id: string): void {
    this.annonces.fermer(id);
  }

  terminer(id: string): void {
    this.annonces.terminer(id);
  }

  @HostListener('document:keydown.escape')
  onEchap(): void {
    const a = this.annonce();
    if (a && this.libre()) this.fermer(a.id);
  }
}
