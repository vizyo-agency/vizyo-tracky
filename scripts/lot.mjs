import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine PAR DÉFAUT = le dossier parent de `scripts/`. `--racine <chemin>` (contrat v1.2 § 1) la remplace pour toutes les lectures. */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Variables d'environnement qui redirigent git vers un AUTRE dépôt que le dossier courant : retirées de tous les `git`
 * lancés ici, pour que « le dépôt lu » soit toujours celui de la racine (et non celui d'un processus parent).
 */
const GIT_REDIRECTING_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_PREFIX'];
function gitEnvironment() {
  const environment = { ...process.env };
  for (const name of GIT_REDIRECTING_VARIABLES) delete environment[name];
  return environment;
}

export const LOT_ID = /^[A-Z]\d\.\d+$/;
export const PROMPT_ID = /^P\d{1,3}$/;

/** Codes de sortie du processus (contrat Conductor v1 : `docs/pilotage/CONDUCTOR.md`). */
export const EXIT = Object.freeze({ READY: 0, ERROR: 2, BLOCKED: 3, ACTION_REQUIRED: 4 });
export const CONDUCTOR_RESULT_VERSION = 1;
/** Branche d'exécution UNIQUE d'un lot en mode Conductor (contrat v1.1 § 1) : une branche par lot, de P1 à Pn. */
export const conductorBranch = (lotId) => `conductor/agent-lot/${lotId}`;
/** Les deux motifs acceptés en `--conductor`, l'identifiant du lot rempli (`<ID>` tant que le lot est inconnu). */
export function acceptedBranches(lotId) {
  const id = LOT_ID.test(lotId ?? '') ? lotId : '<ID>';
  return [conductorBranch(id), `lot/${id}-<slug>`];
}
export const HUMAN_ACTION_TYPES = Object.freeze(['authenticated-browser', 'secret', 'decision', 'external-submit', 'deployment']);
export const EVIDENCE_RULE = 'file_exists_nonempty';
/** Base de l'historique d'un lot : les prompts « faits » sont les commits de HEAD absents de cette référence. */
export const BASE_REF = 'origin/main';

const CONDUCTOR_LOT_BRANCH = /^conductor\/agent-lot\/(.+)$/;
const LOT_BRANCH = /^lot\/([A-Z]\d\.\d+)-([a-z0-9][a-z0-9._-]*)$/;
const PROTECTED_BRANCHES = new Set(['main', 'master', 'dev', 'develop', 'prd', 'prod', 'production', 'staging']);
const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_EVIDENCE_READ = 1024 * 1024;

export function loadPlan(path = join(REPO, 'docs', 'pilotage', 'plan.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function lotMap(plan) {
  return new Map((plan.lots ?? []).map((lot) => [lot.id, lot]));
}

export function dependencyStates(lot, all) {
  return (lot.depends ?? []).map((id) => {
    const dependency = all.get(id);
    if (!dependency) return { id, status: 'unknown' };
    return { id, status: dependency.status, title: dependency.title };
  });
}

export function dependenciesReady(states) {
  return states.every((dependency) => dependency.status === 'done');
}

/** Date ISO 8601 AVEC fuseau (`2026-10-26T08:41:00+01:00`) ou erreur : jamais de date « locale » ambiguë. */
export function parseNotBefore(value) {
  const match = typeof value === 'string' ? ISO_WITH_OFFSET.exec(value) : null;
  if (!match) throw new Error(`not_before invalide « ${String(value)} » : attendu une date ISO 8601 avec fuseau, ex. 2026-10-26T08:41:00+01:00`);
  const [, year, month, day, hour, minute, second = '0'] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const valid =
    calendar.getUTCFullYear() === Number(year) &&
    calendar.getUTCMonth() === Number(month) - 1 &&
    calendar.getUTCDate() === Number(day) &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59;
  const date = new Date(value);
  if (!valid || Number.isNaN(date.getTime())) throw new Error(`not_before invalide « ${value} » : date ou heure inexistante`);
  return date;
}

export function dateGate(lot, now = new Date()) {
  if (!lot.not_before) return { ready: true, date: null };
  try {
    const date = parseNotBefore(lot.not_before);
    return { ready: now >= date, date };
  } catch (error) {
    return { ready: false, date: null, invalid: error.message };
  }
}

export function statusGate(lot, gate) {
  if (lot.status === 'ready') return { ready: true, reason: null };
  if (lot.status === 'waiting' && lot.not_before && gate.ready) return { ready: true, reason: null };
  const reasons = {
    done: 'TERMINÉ — ce lot est consultable mais ne doit pas être relancé.',
    partial: 'PARTIEL — requalifier le reste à faire et passer le lot à ready avant exécution.',
    decision: 'DÉCISION REQUISE — trancher le périmètre avant découpage ou code.',
    backlog: 'BACKLOG — passer explicitement le lot à ready avant exécution.',
    waiting: 'EN ATTENTE — lever le blocage externe avant exécution.',
  };
  return { ready: false, reason: reasons[lot.status] ?? `STATUT BLOQUANT — ${lot.status}.` };
}

/**
 * Un chemin de preuve est un chemin RELATIF du dépôt, en `/`, sans `..`, sans `.` ni segment vide,
 * sans caractère réservé Windows (`:` ouvre un flux de données alternatif NTFS). Retourne l'erreur ou null.
 */
export function validateRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'chemin vide';
  if (value !== value.trim()) return 'espace en début ou fin de chemin';
  if (value.includes('\0')) return 'octet nul';
  if (value.includes('\\')) return 'antislash interdit (utiliser /)';
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return 'chemin absolu';
  if (/[:*?"<>|]/.test(value)) return 'caractère réservé';
  const parts = value.split('/');
  if (parts.includes('..')) return 'segment « .. » interdit';
  if (parts.some((part) => part === '' || part === '.')) return 'segment vide ou « . »';
  return null;
}

/**
 * La preuve d'une action humaine : un fichier RÉGULIER, NON VIDE (pas seulement des blancs), dans le dépôt,
 * dont le chemin réel (liens symboliques résolus) ne sort pas du dépôt.
 * Ne dit rien de qui l'a écrit ni s'il est commité : cf. `docs/pilotage/CONDUCTOR.md` § preuve.
 */
export function inspectEvidence(repoRoot, relativePath) {
  const invalid = validateRelativePath(relativePath);
  if (invalid) return { ok: false, reason: `chemin de preuve invalide (${invalid})` };
  const full = join(repoRoot, relativePath);
  try {
    lstatSync(full);
  } catch {
    return { ok: false, reason: 'fichier de preuve absent' };
  }
  let real;
  let root;
  try {
    real = realpathSync(full);
    root = realpathSync(repoRoot);
  } catch {
    return { ok: false, reason: 'fichier de preuve illisible (lien cassé ?)' };
  }
  const path = relative(root, real);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    return { ok: false, reason: 'le fichier de preuve sort du dépôt (lien symbolique)' };
  }
  const info = statSync(real);
  if (!info.isFile()) return { ok: false, reason: 'la preuve n’est pas un fichier' };
  if (info.size === 0) return { ok: false, reason: 'fichier de preuve vide' };
  if (info.size <= MAX_EVIDENCE_READ && readFileSync(real, 'utf8').trim() === '') {
    return { ok: false, reason: 'fichier de preuve vide (blancs seulement)' };
  }
  return { ok: true, reason: null };
}

/**
 * Branche d'exécution en mode Conductor (contrat v1.1 § 1) : `conductor/agent-lot/<ID>` où <ID> est EXACTEMENT le lot
 * demandé (une branche par lot, réutilisée de P1 à Pn), ou `lot/<ID>-<slug>` du MÊME lot (et, si le plan en déclare une,
 * exactement celle-là). Tout autre `conductor/*` (autre lot, autre agent, `conductor/<agent>/<exec>`), HEAD détaché et
 * `main` sont refusés.
 */
export function classifyBranch(current, lot, expected = null) {
  if (!current) {
    return { ok: false, reason: `HEAD détaché : Conductor doit fournir ou créer la branche ${conductorBranch(lot.id)} avant d’exécuter` };
  }
  if (PROTECTED_BRANCHES.has(current)) return { ok: false, reason: `branche protégée « ${current} » : jamais d’exécution ici` };
  if (current.includes('..')) return { ok: false, reason: `nom de branche « ${current} » non sûr` };
  if (current === conductorBranch(lot.id)) return { ok: true, kind: 'conductor' };
  if (current.startsWith('conductor/')) {
    const other = CONDUCTOR_LOT_BRANCH.exec(current)?.[1];
    if (other && LOT_ID.test(other)) return { ok: false, reason: `branche « ${current} » appartient au lot ${other}, pas à ${lot.id}` };
    return { ok: false, reason: `branche « ${current} » refusée : en mode Conductor, seule ${conductorBranch(lot.id)} est acceptée (une branche par lot)` };
  }
  const match = LOT_BRANCH.exec(current);
  if (match) {
    if (match[1] !== lot.id) return { ok: false, reason: `branche « ${current} » appartient au lot ${match[1]}, pas à ${lot.id}` };
    if (expected && current !== expected) return { ok: false, reason: `branche « ${current} » ≠ branche du lot « ${expected} »` };
    return { ok: true, kind: 'lot' };
  }
  return { ok: false, reason: `branche « ${current} » non conforme : attendu ${acceptedBranches(lot.id).join(' ou ')}` };
}

function normalizeEvidenceVerdict(verdict) {
  if (typeof verdict === 'boolean') return { ok: verdict, reason: verdict ? null : 'fichier de preuve absent' };
  return verdict;
}

export function conductorGate(lot, promptId = null, decoupage = null, checkEvidence = null) {
  if (!promptId || promptId === 'CLOTURE') {
    return {
      ready: false,
      reason: 'Agent Lot accepte uniquement un prompt P1 à P999 ; la clôture reste une session dédiée.',
    };
  }
  const found = findPrompt(decoupage, promptId);
  if (!decoupage || !found) {
    return {
      ready: false,
      reason: 'Le prompt doit exister dans un découpage avant de partir dans Agent Lot.',
    };
  }
  const execution = lot.execution ?? {};
  if (execution.prompts?.length && !execution.prompts.includes(promptId)) {
    return { ready: false, reason: `${promptId} n’est pas autorisé dans Conductor pour ce lot.` };
  }
  const action = (execution.actions ?? []).find((candidate) => candidate.before_prompt === promptId);
  if (action) {
    const verdict = checkEvidence
      ? normalizeEvidenceVerdict(checkEvidence(action.output))
      : inspectEvidence(REPO, action.output);
    if (!verdict.ok) {
      return {
        ready: false,
        actionRequired: true,
        action,
        reason: `${action.id} doit être réalisée avant ${promptId}${verdict.reason ? ` (${verdict.reason})` : ''}.`,
      };
    }
  }
  return { ready: true, reason: null };
}

function splitField(value) {
  return String(value ?? '')
    .split('·')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseDecoupage(rawText) {
  const text = String(rawText).normalize('NFC');
  const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!header) throw new Error('en-tête YAML manquant');
  const meta = Object.fromEntries(
    header[1]
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf(':');
        if (index < 0) throw new Error(`ligne d'en-tête invalide : ${line}`);
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );

  const state = /## État\r?\n\r?\n([\s\S]*?)(?=\r?\n## Étape|$)/.exec(text)?.[1]?.trim() ?? '';
  const steps = [];
  const stepPattern = /## Étape (\d+) · ([^\r\n]+)\r?\n([\s\S]*?)(?=\r?\n## Étape|$)/g;
  for (const match of text.matchAll(stepPattern)) {
    const body = match[3];
    const responsible = /^Responsable : (.+)$/m.exec(body)?.[1]?.trim();
    // `Branche :` = branche du dépôt MANUEL ; `Branche Conductor :` (facultative) = branche unique du lot dans Conductor.
    const branch = /^Branche : (.+)$/m.exec(body)?.[1]?.trim() ?? null;
    const conductorBranchLine = /^Branche Conductor : (.+)$/m.exec(body)?.[1]?.trim() ?? null;
    const prompts = [];
    const promptPattern = /### (P\d+) · ([^\r\n]+)\r?\n([\s\S]*?)(?=\r?\n### P\d+ ·|$)/g;
    for (const promptMatch of body.matchAll(promptPattern)) {
      const promptBody = promptMatch[3];
      const field = (name) => new RegExp(`^${name} : (.+)$`, 'm').exec(promptBody)?.[1]?.trim();
      const actions = /Faire :\r?\n([\s\S]*?)(?=\r?\nTest :)/.exec(promptBody)?.[1]
        ?.split(/\r?\n/)
        .map((line) => line.replace(/^- /, '').trim())
        .filter(Boolean) ?? [];
      prompts.push({
        id: promptMatch[1],
        title: promptMatch[2].trim(),
        duration: Number.parseInt(field('Durée'), 10),
        files: splitField(field('Fichiers')),
        sources: splitField(field('Sources')),
        actions,
        test: field('Test'),
        done: field('Fini quand'),
        out: field('Hors périmètre'),
      });
    }
    steps.push({ number: Number(match[1]), title: match[2].trim(), responsible, branch, conductorBranch: conductorBranchLine, prompts });
  }
  return { ...meta, state, steps };
}

export function commitMessage(lot, step, prompt) {
  return `[${lot.id}] ${prompt.id} — ${prompt.title}`;
}

/**
 * Les prompts d'un lot déjà committés : `[<ID>] P<n> — …` N'IMPORTE OÙ dans le sujet
 * (« contrat: [D3.4] P1 — … » reste reconnu), comme le fait Conductor (`estLeCommitDuPrompt`).
 * `subjects` = les sujets de `origin/main..HEAD` (aucune fenêtre). Un sujet qui commence par `Revert ` (annulation d'un
 * commit de prompt) ne compte JAMAIS comme prompt fait (contrat v1.1 § 3).
 */
export function completedPrompts(lot, subjects) {
  const result = new Set();
  const marker = new RegExp(`\\[${lot.id.replace(/\./g, '\\.')}\\]\\s+(P\\d+)\\s+[—-]`);
  for (const subject of subjects) {
    if (subject.startsWith('Revert ')) continue;
    const match = marker.exec(subject);
    if (match) result.add(match[1]);
  }
  return result;
}

function flattenPrompts(decoupage, lot) {
  const flat = [];
  for (const step of decoupage?.steps ?? []) {
    for (const prompt of step.prompts) flat.push({ id: prompt.id, branch: step.branch ?? lot?.branch ?? null });
  }
  return flat;
}

/**
 * Les prompts qui précèdent `promptId` dans le découpage ET se codent sur la même branche. Sur la branche unique
 * `conductor/agent-lot/<ID>` (`unified`), TOUS les prompts précédents comptent : il n'y a qu'une branche pour tout le lot.
 */
export function promptsBefore(decoupage, lot, promptId, unified = false) {
  const flat = flattenPrompts(decoupage, lot);
  const index = flat.findIndex((candidate) => candidate.id === promptId);
  if (index < 0) return [];
  return flat.slice(0, index).filter((candidate) => unified || candidate.branch === flat[index].branch).map((candidate) => candidate.id);
}

/** Les prompts de la branche qui n'ont pas de commit (clôture). Une étape sans branche vaut pour toutes. */
export function remainingPrompts(decoupage, branch, done) {
  const remaining = [];
  for (const step of decoupage.steps) {
    if (step.branch && branch && step.branch !== branch) continue;
    for (const prompt of step.prompts) if (!done.has(prompt.id)) remaining.push(prompt.id);
  }
  return remaining;
}

/**
 * Règle de clôture d'un lot déjà `done` : le dernier prompt passe le lot à `done` dans le plan (S2.1 P3). La clôture
 * reste donc possible si, et seulement si, la branche courante est celle du lot (`lot.branch`, ou `conductor/agent-lot/<ID>`
 * qui porte alors TOUS les prompts), que le lot a un découpage, et que TOUS les prompts de cette branche ont leur commit
 * `[<ID>] P<n> — …` : le statut `done` vient alors de ces commits. Un lot `done` sans ces commits (fait avant le début
 * des travaux) reste TERMINÉ.
 */
export function clotureAfterWork(lot, decoupage, branch, done) {
  if (lot.status !== 'done' || !decoupage || !branch) return false;
  const unified = branch === conductorBranch(lot.id);
  if (!unified && lot.branch && branch !== lot.branch) return false;
  const onBranch = decoupage.steps.filter((step) => unified || !step.branch || step.branch === branch).flatMap((step) => step.prompts);
  return onBranch.length > 0 && remainingPrompts(decoupage, unified ? null : branch, done).length === 0;
}

function findCycle(lots) {
  const byId = new Map(lots.map((lot) => [lot.id, lot]));
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'visiting');
    stack.push(id);
    for (const dependency of byId.get(id)?.depends ?? []) {
      if (!byId.has(dependency) || dependency === id) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const lot of lots) {
    const cycle = visit(lot.id);
    if (cycle) return cycle;
  }
  return null;
}

export function validatePlan(plan, options = {}) {
  const decoupeDir = options.decoupeDir ?? join(REPO, 'docs', 'pilotage', 'decoupe');
  const errors = [];
  const ids = new Set();
  const asana = new Set();
  const actionIds = new Set();
  for (const lot of plan.lots ?? []) {
    if (!LOT_ID.test(lot.id)) errors.push(`${lot.id}: identifiant invalide`);
    if (ids.has(lot.id)) errors.push(`${lot.id}: doublon`);
    ids.add(lot.id);
    if (!plan.statuses?.includes(lot.status)) errors.push(`${lot.id}: statut ${lot.status} inconnu`);
    if (!(lot.done_when?.length > 0)) errors.push(`${lot.id}: done_when vide`);
    if (lot.not_before !== undefined) {
      try {
        parseNotBefore(lot.not_before);
      } catch (error) {
        errors.push(`${lot.id}: ${error.message}`);
      }
    }
    const conductorMode = ['conductor-agent-lot', 'conductor-assisted'].includes(lot.execution?.mode);
    if (conductorMode) {
      if (!lot.branch) errors.push(`${lot.id}: branche requise pour Conductor`);
      if (!(lot.execution.prompts?.length > 0)) errors.push(`${lot.id}: prompts Conductor vides`);
      for (const prompt of lot.execution.prompts ?? []) {
        if (!PROMPT_ID.test(prompt)) errors.push(`${lot.id}: prompt Conductor invalide ${prompt}`);
      }
    }
    const actionByPrompt = new Map();
    for (const action of lot.execution?.actions ?? []) {
      const name = action.id ?? '?';
      if (!action.id) errors.push(`${lot.id}: action Conductor sans identifiant`);
      else if (actionIds.has(action.id)) errors.push(`${lot.id}: action ${action.id} dupliquée`);
      else actionIds.add(action.id);
      if (!PROMPT_ID.test(action.before_prompt ?? '')) errors.push(`${lot.id}: action ${name} sans before_prompt valide`);
      else {
        if (lot.execution.prompts?.length && !lot.execution.prompts.includes(action.before_prompt)) {
          errors.push(`${lot.id}: action ${name} avant ${action.before_prompt}, absent des prompts Conductor`);
        }
        // Une seule action est évaluée par prompt (contrat v1.1 § 6) : deux actions avant le même prompt rendraient la seconde invisible.
        const first = actionByPrompt.get(action.before_prompt);
        if (first !== undefined) {
          errors.push(`${lot.id}: actions ${first} et ${name} déclarées avant le même prompt ${action.before_prompt} : une seule action humaine par prompt (fusionner les consignes ou déplacer l'une avant un autre prompt)`);
        } else actionByPrompt.set(action.before_prompt, name);
      }
      if (!action.type) errors.push(`${lot.id}: action ${name} sans type`);
      else if (!HUMAN_ACTION_TYPES.includes(action.type)) errors.push(`${lot.id}: action ${name} de type inconnu ${action.type}`);
      if (!action.title) errors.push(`${lot.id}: action ${name} sans titre`);
      if (!action.output) errors.push(`${lot.id}: action ${name} sans preuve de sortie`);
      else {
        const invalid = validateRelativePath(action.output);
        if (invalid) errors.push(`${lot.id}: action ${name} preuve de sortie invalide (${invalid})`);
      }
      if (!action.resume_prompt) errors.push(`${lot.id}: action ${name} sans prompt de reprise`);
      else if (!PROMPT_ID.test(action.resume_prompt)) errors.push(`${lot.id}: action ${name} prompt de reprise invalide ${action.resume_prompt}`);
      if (action.url && !/^https:\/\//.test(action.url)) errors.push(`${lot.id}: action ${name} url non https`);
      if (action.not_before !== undefined) {
        try {
          parseNotBefore(action.not_before);
        } catch (error) {
          errors.push(`${lot.id}: action ${name} ${error.message}`);
        }
      }
    }
    if (lot.asana_task_id) {
      if (asana.has(lot.asana_task_id)) errors.push(`${lot.id}: tâche Asana dupliquée`);
      asana.add(lot.asana_task_id);
    }
  }
  for (const lot of plan.lots ?? []) {
    for (const dependency of lot.depends ?? []) {
      if (!ids.has(dependency)) errors.push(`${lot.id}: dépendance inconnue ${dependency}`);
      if (dependency === lot.id) errors.push(`${lot.id}: dépend de lui-même`);
    }
    const file = join(decoupeDir, `${lot.id}.md`);
    if (['conductor-agent-lot', 'conductor-assisted'].includes(lot.execution?.mode) && !existsSync(file)) {
      errors.push(`${lot.id}: découpage requis pour Conductor`);
    }
    if (existsSync(file)) {
      try {
        const parsed = parseDecoupage(readFileSync(file, 'utf8'));
        if (parsed.lot !== lot.id) errors.push(`${lot.id}: en-tête du découpage = ${parsed.lot}`);
        const promptIds = new Set();
        for (const step of parsed.steps) {
          if (!step.responsible) errors.push(`${lot.id}: responsable manquant à l'étape ${step.number}`);
          if (step.conductorBranch && step.conductorBranch !== conductorBranch(lot.id)) {
            errors.push(`${lot.id}: « Branche Conductor » de l'étape ${step.number} = ${step.conductorBranch}, attendu ${conductorBranch(lot.id)} (une branche par lot)`);
          }
          for (const prompt of step.prompts) {
            if (promptIds.has(prompt.id)) errors.push(`${lot.id}: prompt dupliqué ${prompt.id}`);
            promptIds.add(prompt.id);
            if (!(prompt.duration >= 15 && prompt.duration <= 30)) errors.push(`${lot.id} ${prompt.id}: durée hors 15–30 min`);
            for (const key of ['files', 'sources', 'actions']) if (!prompt[key]?.length) errors.push(`${lot.id} ${prompt.id}: ${key} vide`);
            for (const key of ['test', 'done', 'out']) if (!prompt[key]) errors.push(`${lot.id} ${prompt.id}: ${key} vide`);
          }
        }
        for (const prompt of lot.execution?.prompts ?? []) {
          if (!promptIds.has(prompt)) errors.push(`${lot.id}: prompt Conductor absent du découpage ${prompt}`);
        }
        if (parsed.steps.length === 0) errors.push(`${lot.id}: aucune étape dans le découpage`);
      } catch (error) {
        errors.push(`${lot.id}: ${error.message}`);
      }
    }
  }
  const cycle = findCycle(plan.lots ?? []);
  if (cycle) errors.push(`${cycle[0]}: cycle de dépendances ${cycle.join(' → ')}`);
  return errors;
}

/**
 * Accès git du poste. `branch()` rend '' pour un HEAD détaché ; toute panne de git LÈVE (jamais « aucun commit »).
 * `subjects()` = les sujets de `git log origin/main..HEAD` : les commits de la branche absents de `origin/main`,
 * SANS fenêtre de N commits (contrat v1.1 § 3, identique côté Conductor). Sans `origin/main`, c'est une panne
 * (exit 2) : lancer `git fetch origin`, jamais deviner un historique.
 */
export function makeGit(repo = REPO) {
  const run = (args) => execFileSync('git', args, { cwd: repo, env: gitEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();
  return {
    branch: () => run(['branch', '--show-current']),
    subjects: () => {
      try {
        return run(['log', '--format=%s', `${BASE_REF}..HEAD`]).split(/\r?\n/).filter(Boolean);
      } catch (error) {
        const detail = String(error.stderr ?? error.message).split(/\r?\n/).find((line) => line.trim()) ?? 'erreur inconnue';
        throw new Error(`historique ${BASE_REF}..HEAD illisible (${detail.trim()}) ; lancer git fetch origin`);
      }
    },
  };
}

function safeGit(git) {
  const result = { branch: null, branchError: null, subjects: null };
  try {
    result.branch = git.branch();
  } catch (error) {
    result.branchError = String(error.message ?? error).split('\n')[0];
  }
  try {
    result.subjects = git.subjects();
  } catch (error) {
    result.subjects = null;
    result.branchError ??= String(error.message ?? error).split('\n')[0];
  }
  return result;
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(date);
}

function findPrompt(decoupage, id) {
  for (const step of decoupage?.steps ?? []) {
    const prompt = step.prompts.find((candidate) => candidate.id === id);
    if (prompt) return { step, prompt };
  }
  return null;
}

function printBrief(io, lot, states, gate, workflow, decoupage, done, verdict = null) {
  const { log } = io;
  log(`# [${lot.id}] ${lot.title}`);
  log(`${lot.responsible} · relu par ${lot.reviewer} · ${lot.track} · ${lot.estimate_hours || '?'} h · ${lot.status}`);
  if (lot.execution?.mode) log(`Exécution : ${lot.execution.mode}`);
  if (states.length === 0) log('\n**Dépendances** : aucune.');
  else {
    log('\n**Dépendances**');
    for (const state of states) log(`- ${state.id} — ${state.status}${state.title ? ` — ${state.title}` : ''}`);
  }
  if (verdict) log(`\n**${verdict}**`);
  else if (!gate.ready) log(`\n**TROP TÔT** — attendre ${gate.date ? formatDate(gate.date) : 'la date minimale'}.`);
  else if (!dependenciesReady(states)) log('\n**PAS PRÊT** — une dépendance n’est pas close.');
  else if (!workflow.ready) log(`\n**${workflow.reason}**`);
  else log('\n**PRÊT** — le lot peut commencer.');
  log(`\n## Pourquoi\n${lot.why ?? 'Voir les critères et les sources.'}`);
  log('\n## Fait quand');
  for (const criterion of lot.done_when) log(`- ${criterion}`);
  log('\n## Sources');
  for (const source of lot.sources ?? []) log(`- ${source}`);
  if (decoupage) {
    log(`\n## Découpage — état au ${decoupage.etat_au}\n${decoupage.state}`);
    for (const step of decoupage.steps) {
      log(`\n**Étape ${step.number} · ${step.title}** — ${step.responsible}`);
      for (const prompt of step.prompts) log(`- ${done.has(prompt.id) ? '✓' : '○'} \`/lot ${lot.id} ${prompt.id}\` ${prompt.title} — ${prompt.duration} min`);
    }
    log(`- ○ \`/lot ${lot.id} cloture\``);
  } else {
    log('\nAucun découpage. Si le lot dépasse quatre heures, le découper avant de coder.');
  }
}

function printHumanAction(io, lot, action) {
  const { log } = io;
  log(`\n## ACTION HUMAINE REQUISE — ${action.id}`);
  log(`Type : ${action.type}`);
  log(`Responsable : ${action.owner ?? lot.responsible}`);
  log(`Action : ${action.title}`);
  if (action.url) log(`Ouvrir : ${action.url}`);
  log(`Preuve attendue : ${action.output} (fichier non vide, dans le dépôt)`);
  log(`Reprise : /lot ${lot.id} ${action.resume_prompt}`);
  if (action.instructions?.length) {
    log('\nÀ faire');
    for (const instruction of action.instructions) log(`- ${instruction}`);
  }
  if (action.forbidden?.length) {
    log('\nInterdit pendant cette action');
    for (const item of action.forbidden) log(`- ${item}`);
  }
  log('\nConductor doit créer une tâche humaine durable, puis mettre le run en attente (code de sortie 4). Ce n’est ni un échec ni une approbation de code.');
}

/** L'action telle que Conductor la lit : `CONDUCTOR_RESULT.action` (contrat v1). Aucune valeur de compte ni de secret. */
export function actionPayload(lot, action) {
  return {
    id: action.id,
    type: action.type,
    responsible: action.owner ?? lot.responsible ?? null,
    url: action.url ?? null,
    instructions: action.instructions ?? [],
    forbidden: action.forbidden ?? [],
    evidence_path: action.output,
    evidence_rule: EVIDENCE_RULE,
    resume_command: `/lot ${lot.id} ${action.resume_prompt}`,
    not_before: action.not_before ?? lot.not_before ?? null,
  };
}

export function conductorLine(result) {
  return `CONDUCTOR_RESULT ${JSON.stringify({
    version: CONDUCTOR_RESULT_VERSION,
    status: result.status,
    exit_code: result.exit_code,
    lot: result.lot ?? null,
    prompt: result.prompt ?? null,
    reason: result.reason ?? null,
    branch: { current: result.current ?? null, accepted: acceptedBranches(result.lot) },
    action: result.action ?? null,
    commit_message: result.commit_message ?? null,
  })}`;
}

/** Chemin d'un fichier relatif au dépôt, en `/` ; hors dépôt, le seul nom du fichier. Jamais de chemin absolu local. */
function repoRelative(repo, target) {
  const path = relative(repo, target).split(sep).join('/');
  return path === '' || path.startsWith('..') || isAbsolute(path) ? basename(target) : path;
}

/**
 * Retire d'un message tout chemin absolu local (contrat v1.1 § 5) : la racine du dépôt devient un chemin relatif, tout
 * autre chemin absolu (lecteur Windows, UNC, dossiers usuels POSIX) devient `<chemin local>`. Le dossier de l'utilisateur,
 * le dossier temporaire ou l'emplacement du dépôt n'ont rien à faire dans une raison lue par une autre machine.
 */
export function scrubLocalPaths(text, repo = REPO) {
  let result = String(text ?? '');
  const roots = new Set([repo]);
  try {
    roots.add(realpathSync(repo));
  } catch {
    // dépôt introuvable : le motif générique suffit
  }
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    for (const variant of new Set([root, root.replaceAll('\\', '/'), root.replaceAll('/', '\\')])) {
      result = result.split(`${variant}/`).join('').split(`${variant}\\`).join('').split(variant).join('.');
    }
  }
  return result.replace(/(?<![\w.:/-])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|private|root|mnt|opt|etc|usr|srv|Volumes)\/)[^\s'"`)>\]]*/g, '<chemin local>');
}

const samePath = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));

/**
 * `--racine <chemin>` (contrat v1.2 § 1) : le chemin doit être ABSOLU, être lui-même un dossier (pas un lien symbolique ni
 * une jonction), et être la RACINE d'un dépôt ou worktree git (`git rev-parse --show-toplevel` y mène). Les messages ne
 * citent jamais le chemin (aucun chemin local dans `reason`). Rend `{ ok, root, reason }`, `root` = chemin canonique.
 * Ne lit rien d'autre que `git rev-parse` : le contenu du dépôt cible (dont son éventuel `scripts/lot.mjs`) n'est jamais exécuté.
 */
export function resolveRoot(value) {
  const fail = (reason) => ({ ok: false, root: null, reason });
  if (typeof value !== 'string' || value === '' || value.includes('\0')) return fail('chemin vide ou invalide');
  if (!isAbsolute(value)) return fail('un chemin absolu est requis');
  let info;
  try {
    info = lstatSync(value);
  } catch {
    return fail('dossier introuvable');
  }
  if (info.isSymbolicLink()) return fail('un lien symbolique (ou une jonction) n’est pas une racine de dépôt');
  if (!info.isDirectory()) return fail('ce n’est pas un dossier');
  let real;
  let top;
  try {
    real = realpathSync.native(value);
    top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: real, env: gitEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return fail('ce n’est pas un dépôt git lisible');
  }
  let realTop;
  try {
    realTop = realpathSync.native(top);
  } catch {
    return fail('racine git illisible');
  }
  if (!samePath(real, realTop)) return fail('ce n’est pas la racine du dépôt git (sous-dossier ou lien)');
  return { ok: true, root: real, reason: null };
}

function parseArgs(argv) {
  const options = { check: false, conductor: false, replay: false, since: null, root: null, positional: [], unknown: [], problems: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === '--check' && index === 0) options.check = true;
    else if (argument === '--conductor') options.conductor = true;
    else if (argument === '--rejouer') options.replay = true;
    // Conductor passe encore `--depuis origin/<base>` (versions antérieures au contrat v1) : accepté, sans effet.
    // La valeur est OBLIGATOIRE et ne peut pas commencer par « - » : `--depuis --conductor` n'avale jamais l'option suivante
    // (celle-ci est lue normalement, et `--depuis` seul est une erreur d'usage).
    else if (argument === '--depuis') {
      const value = index + 1 < argv.length ? String(argv[index + 1]) : '';
      if (value === '' || value.startsWith('-')) options.problems.push('--depuis attend une référence git (valeur absente ou commençant par « - »).');
      else {
        options.since = value;
        index += 1;
      }
    } else if (argument === '--racine') {
      // Une seule fois, valeur obligatoire (un chemin absolu ne commence jamais par « - »).
      const value = index + 1 < argv.length ? String(argv[index + 1]) : '';
      if (options.root !== null) options.problems.push('--racine ne peut être donné qu’une fois.');
      else if (value === '' || value.startsWith('-')) options.problems.push('--racine attend un chemin absolu (valeur absente ou commençant par « - »).');
      else {
        options.root = value;
        index += 1;
      }
    } else if (argument.startsWith('-')) options.unknown.push(argument);
    else options.positional.push(argument);
  }
  return options;
}

/**
 * Cœur du script, sans effet de bord : rend `{ exitCode, stdout, stderr }`. `env` injecte le dépôt, le plan, l'horloge,
 * git et la lecture de la preuve (les tests), le défaut est le poste réel.
 */
export function run(argv = [], env = {}) {
  // La racine lue (plan, découpages, preuves, git) : `--racine` (résolue plus bas), sinon l'injection des tests, sinon le dossier du script.
  let repo = env.repo ?? REPO;
  let planPath;
  let decoupeDir;
  let git = null;
  let evidenceOf;
  const now = env.now ?? new Date();
  const useRoot = (root) => {
    repo = root;
    planPath = env.planPath ?? join(repo, 'docs', 'pilotage', 'plan.json');
    decoupeDir = env.decoupeDir ?? join(repo, 'docs', 'pilotage', 'decoupe');
    git = env.git ?? makeGit(repo);
    evidenceOf = env.checkEvidence ?? ((path) => inspectEvidence(repo, path));
  };

  const out = [];
  const err = [];
  // Aucun chemin absolu local dans une erreur ni dans `reason` (contrat v1.1 § 5) : chemins relatifs au dépôt seulement.
  const clean = (text) => scrubLocalPaths(text, repo);
  // Jamais de retour chariot dans la sortie, quelle que soit la fin de ligne des fichiers lus (CRLF) : Conductor lit la
  // dernière ligne de stdout, un `\r` résiduel la rendrait illisible ou ferait fuiter des fins de ligne Windows.
  const eol = (text) => String(text).replace(/\r\n?/g, '\n');
  const io = { log: (line = '') => out.push(eol(line)), error: (line = '') => err.push(eol(clean(line))) };
  const options = parseArgs(argv);
  const conductorMode = options.conductor;
  const state = { lot: null, prompt: null, current: null, currentKnown: false, action: null, commit: null };

  /**
   * `branch.current` : `null` si et seulement si HEAD est détaché (contrat v1.2 § 4). Sur une sortie précoce (usage, plan
   * illisible, lot inconnu) la branche n'a pas encore été lue : on la lit ici, au mieux. Seul cas sans réponse : git
   * indisponible ou `--racine` refusée, donc `status = error`, où `null` veut dire « inconnue » et où Conductor ne lit pas la branche.
   */
  const settleCurrent = () => {
    if (state.currentKnown || git === null) return;
    state.currentKnown = true;
    try {
      state.current = git.branch() || null;
    } catch {
      state.current = null;
    }
  };

  const finish = (status, exitCode, reason = null) => {
    if (conductorMode) {
      settleCurrent();
      io.log(conductorLine({ status, exit_code: exitCode, lot: state.lot, prompt: state.prompt, reason: reason === null ? null : clean(reason), current: state.current, action: state.action, commit_message: state.commit }));
    }
    return { exitCode, stdout: out.length ? `${out.join('\n')}\n` : '', stderr: err.length ? `${err.join('\n')}\n` : '' };
  };
  const usage = (message) => {
    io.error(message);
    return finish('error', EXIT.ERROR, message);
  };

  try {
    return runChecked();
  } catch (error) {
    const message = `Erreur interne : ${error?.message ?? error}`;
    io.error(message);
    return finish('error', EXIT.ERROR, message);
  }

  function runChecked() {
    if (options.unknown.length) return usage(`Option inconnue : ${options.unknown.join(', ')}`);
    if (options.problems.length) return usage(options.problems[0]);
    if (options.positional.length > (options.check ? 0 : 2)) {
      return usage(`Arguments en trop : ${options.positional.slice(options.check ? 0 : 2).join(' ')} (usage : node scripts/lot.mjs <ID> [P<n> | cloture] [--conductor] [--rejouer] [--racine <chemin absolu>])`);
    }
    if (options.root !== null) {
      const resolved = resolveRoot(options.root);
      if (!resolved.ok) return usage(`--racine refusée : ${resolved.reason}.`);
      useRoot(resolved.root);
    } else useRoot(repo);

    let plan;
    try {
      plan = loadPlan(planPath);
    } catch (error) {
      // Le message natif de Node porte le chemin ABSOLU du fichier : on ne garde que son nom relatif et la cause.
      const cause = error instanceof SyntaxError ? `JSON invalide, ${error.message}` : (error?.code ?? 'lecture impossible');
      return usage(`Plan illisible : ${repoRelative(repo, planPath)} (${cause})`);
    }
    const errors = validatePlan(plan, { decoupeDir });
    if (options.check) {
      if (conductorMode) return usage('--check ne se combine pas avec --conductor.');
      if (errors.length) {
        for (const message of errors) io.error(`- ${message}`);
        return finish('error', EXIT.ERROR);
      }
      io.log(`OK — ${plan.lots.length} lots valides.`);
      return finish('ready', EXIT.READY);
    }
    const id = String(options.positional[0] ?? '').toUpperCase();
    state.lot = id || null;
    const rawMode = String(options.positional[1] ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    state.prompt = rawMode === 'cloture' ? 'cloture' : rawMode ? rawMode.toUpperCase() : null;
    if (errors.length) {
      io.error('Plan invalide :');
      for (const message of errors) io.error(`- ${message}`);
      return finish('error', EXIT.ERROR, `plan invalide (${errors.length} erreur(s)) : ${errors[0]}`);
    }
    if (!LOT_ID.test(id)) return usage('Usage : node scripts/lot.mjs <ID> [P<n> | cloture] [--conductor] [--rejouer]');
    const all = lotMap(plan);
    const lot = all.get(id);
    if (!lot) return usage(`Lot inconnu : ${id}`);
    if (conductorMode) {
      if (options.replay) return usage('--rejouer est interdit avec --conductor : Conductor tranche sur l’historique git.');
      if (!state.prompt) return usage('Un prompt P1 à P999 est requis avec --conductor.');
      if (state.prompt !== 'cloture' && !PROMPT_ID.test(state.prompt)) return usage(`Prompt invalide : ${options.positional[1]}`);
    }

    const g = safeGit(git);
    state.currentKnown = true;
    if (g.branch !== null) state.current = g.branch || null;
    const currentBranch = g.branch ?? '';
    const done = completedPrompts(lot, g.subjects ?? []);
    const states = dependencyStates(lot, all);
    const gate = dateGate(lot, now);
    if (gate.invalid) return usage(`[${lot.id}] ${gate.invalid}`);
    let workflow = statusGate(lot, gate);
    const decoupagePath = join(decoupeDir, `${lot.id}.md`);
    const decoupage = existsSync(decoupagePath) ? parseDecoupage(readFileSync(decoupagePath, 'utf8')) : null;
    const wantsCloture = state.prompt === 'cloture';
    if (!workflow.ready && wantsCloture && !conductorMode && g.subjects && clotureAfterWork(lot, decoupage, currentBranch, done)) {
      workflow = { ready: true, reason: null, afterWork: true };
    }

    const early = PROMPT_ID.test(state.prompt ?? '') ? findPrompt(decoupage, state.prompt) : null;
    if (early) state.commit = commitMessage(lot, early.step, early.prompt);

    if (!gate.ready || !dependenciesReady(states) || !workflow.ready) {
      printBrief(io, lot, states, gate, workflow, decoupage, done);
      const open = states.filter((dependency) => dependency.status !== 'done').map((dependency) => `${dependency.id} (${dependency.status})`);
      if (!gate.ready) return finish('too_early', EXIT.BLOCKED, `TROP TÔT — attendre ${formatDate(gate.date)}.`);
      if (open.length) return finish('blocked', EXIT.BLOCKED, `PAS PRÊT — dépendance(s) ouverte(s) : ${open.join(', ')}.`);
      return finish('blocked', EXIT.BLOCKED, workflow.reason);
    }

    if (conductorMode) {
      if (wantsCloture) {
        printBrief(io, lot, states, gate, workflow, decoupage, done);
        const reason = conductorGate(lot, 'CLOTURE', decoupage).reason;
        io.log(`\n**NON COMPATIBLE CONDUCTOR** — ${reason}`);
        return finish('blocked', EXIT.BLOCKED, reason);
      }
      if (!decoupage) {
        const reason = 'Lot non découpé : Agent Lot ne code que des prompts d’un découpage.';
        printBrief(io, lot, states, gate, workflow, decoupage, done);
        io.log(`\n**NON COMPATIBLE CONDUCTOR** — ${reason}`);
        return finish('blocked', EXIT.BLOCKED, reason);
      }
      if (!findPrompt(decoupage, state.prompt)) return usage(`Prompt inconnu : ${id} ${state.prompt}`);
    }

    if (!state.prompt) {
      printBrief(io, lot, states, gate, workflow, decoupage, done);
      return finish('ready', EXIT.READY);
    }

    if (wantsCloture) return closeLot();

    if (!PROMPT_ID.test(state.prompt) || !decoupage) return usage(`Prompt invalide ou lot non découpé : ${options.positional[1]}`);
    const found = findPrompt(decoupage, state.prompt);
    if (!found) return usage(`Prompt inconnu : ${id} ${state.prompt}`);
    const { step, prompt } = found;
    state.commit = commitMessage(lot, step, prompt);
    const expectedBranch = step.branch ?? lot.branch ?? null;
    let branchKind = null;

    const allowed = lot.execution?.prompts;
    if (conductorMode && allowed?.length && !allowed.includes(prompt.id)) {
      const reason = `${prompt.id} n’est pas autorisé dans Conductor pour ce lot.`;
      io.log(`# [${lot.id}] ${prompt.id}\n\n**NON COMPATIBLE CONDUCTOR** — ${reason}`);
      return finish('blocked', EXIT.BLOCKED, reason);
    }

    if (g.branch === null || g.subjects === null) {
      io.error(`git indisponible : ${g.branchError ?? 'erreur inconnue'}`);
      return finish('error', EXIT.ERROR, `git indisponible : ${g.branchError ?? 'erreur inconnue'}`);
    }
    if (conductorMode) {
      const verdict = classifyBranch(currentBranch, lot, expectedBranch);
      if (!verdict.ok) {
        io.log(`# [${lot.id}] ${prompt.id}\n\n**MAUVAISE BRANCHE** — ${verdict.reason}. S'arrêter.`);
        return finish('blocked', EXIT.BLOCKED, `MAUVAISE BRANCHE — ${verdict.reason}`);
      }
      branchKind = verdict.kind;
    } else if (expectedBranch && currentBranch !== expectedBranch) {
      io.log(`# [${lot.id}] ${prompt.id}\n\n**MAUVAISE BRANCHE** — session sur \`${currentBranch || 'inconnue'}\`, prompt sur \`${expectedBranch}\`. S'arrêter.`);
      return finish('blocked', EXIT.BLOCKED, 'MAUVAISE BRANCHE');
    }

    if (done.has(prompt.id) && !options.replay) {
      const reason = `${prompt.id} est déjà committé sur cette branche (déjà fait) ; ne pas le refaire${conductorMode ? '' : ' (--rejouer pour le reprendre volontairement)'}.`;
      io.log(`# [${lot.id}] ${prompt.id}\n\n**DÉJÀ FAIT** — ${reason}`);
      return finish('blocked', EXIT.BLOCKED, reason);
    }
    const missing = promptsBefore(decoupage, lot, prompt.id, branchKind === 'conductor').filter((previous) => !done.has(previous));
    if (missing.length) {
      const reason = `ORDRE DES PROMPTS — ${prompt.id} exige d’abord ${missing.join(', ')} (commit « [${lot.id}] P<n> — … » absent de la branche).`;
      io.log(`# [${lot.id}] ${prompt.id}\n\n**${reason}**`);
      return finish('blocked', EXIT.BLOCKED, reason);
    }

    if (conductorMode) {
      const conductor = conductorGate(lot, prompt.id, decoupage, evidenceOf);
      if (!conductor.ready) {
        if (conductor.actionRequired) {
          printBrief(io, lot, states, gate, workflow, decoupage, done, 'ACTION HUMAINE REQUISE — le lot n’est pas bloqué, une personne doit agir avant ce prompt');
          printHumanAction(io, lot, conductor.action);
          state.action = actionPayload(lot, conductor.action);
          return finish('action_required', EXIT.ACTION_REQUIRED, conductor.reason);
        }
        io.log(`\n**NON COMPATIBLE CONDUCTOR** — ${conductor.reason}`);
        return finish('blocked', EXIT.BLOCKED, conductor.reason);
      }
    }

    io.log(`# [${lot.id}] ${prompt.id} · ${prompt.title} — ${prompt.duration} min`);
    // En mode Conductor, la branche d'exécution est celle du contrat (une par lot), pas la branche « manuelle » du découpage.
    const shownBranch = conductorMode ? (branchKind === 'conductor' ? conductorBranch(lot.id) : currentBranch) : (step.branch ?? lot.branch ?? 'à créer');
    io.log(`Étape ${step.number} · ${step.title} — ${step.responsible} · branche \`${shownBranch}\``);
    if (conductorMode) {
      io.log('\n## Conductor');
      io.log('- Travailler dans le worktree isolé fourni ; ne pas créer de worktree imbriqué.');
      io.log('- Commiter avec le message exact, mais ne pas pousser, ouvrir de PR ou déployer.');
      io.log('- Rendre le commit à Conductor : la plateforme proposera le push à la validation humaine.');
    }
    if (done.has(prompt.id)) io.log(`\n⚠️ ${prompt.id} a déjà un commit (--rejouer).`);
    for (const [title, values] of [['Fichiers', prompt.files], ['Sources', prompt.sources], ['Faire', prompt.actions]]) {
      io.log(`\n## ${title}`);
      for (const value of values) io.log(`- ${value}`);
    }
    io.log(`\n## Test\n${prompt.test}`);
    io.log(`\n## Fini quand\n${prompt.done}`);
    io.log(`\n## Hors périmètre\n${prompt.out}`);
    io.log(`\n## Commit\n${state.commit}`);
    return finish('ready', EXIT.READY);

    function closeLot() {
      if (!decoupage) {
        io.log(`# [${lot.id}] clôture\n\nLot sans découpage : vérifier chaque critère puis suivre GUIDE § 3.`);
        return finish('ready', EXIT.READY);
      }
      if (g.branch === null || g.subjects === null) {
        io.error(`git indisponible : ${g.branchError ?? 'erreur inconnue'}`);
        return finish('error', EXIT.ERROR, `git indisponible : ${g.branchError ?? 'erreur inconnue'}`);
      }
      // Hors Conductor, la clôture se fait sur la branche du lot OU sur la branche unique d'une exécution Conductor.
      const unified = currentBranch === conductorBranch(lot.id);
      if (lot.branch && currentBranch !== lot.branch && !unified) {
        io.log(`# [${lot.id}] clôture\n\n**MAUVAISE BRANCHE** — session sur \`${currentBranch || 'inconnue'}\`, lot sur \`${lot.branch}\` ou \`${conductorBranch(lot.id)}\`. S'arrêter.`);
        return finish('blocked', EXIT.BLOCKED, 'MAUVAISE BRANCHE');
      }
      const remaining = remainingPrompts(decoupage, unified ? null : currentBranch, done);
      io.log(`# [${lot.id}] clôture — branche ${currentBranch || 'inconnue'}`);
      if (remaining.length) {
        const reason = `PAS PRÊTE — prompts sans commit : ${remaining.join(', ')}.`;
        io.log(`\n**${reason}**`);
        return finish('blocked', EXIT.BLOCKED, reason);
      }
      if (workflow.afterWork) io.log(`\nLe plan marque ${lot.id} \`done\` : ce statut vient des commits de cette branche, la clôture reste autorisée.`);
      io.log('\n**PRÊTE** — lancer les contrôles, les deux relectures et la PR selon le skill.');
      return finish('ready', EXIT.READY);
    }
  }
}

function main(argv = process.argv.slice(2)) {
  const result = run(argv);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
