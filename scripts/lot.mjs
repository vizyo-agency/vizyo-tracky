import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAN_PATH = join(REPO, 'docs', 'pilotage', 'plan.json');
const DECOUPE_DIR = join(REPO, 'docs', 'pilotage', 'decoupe');
export const LOT_ID = /^[A-Z]\d\.\d+$/;

export function loadPlan(path = PLAN_PATH) {
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

export function dateGate(lot, now = new Date()) {
  if (!lot.not_before) return { ready: true, date: null };
  const date = new Date(lot.not_before);
  return { ready: now >= date, date };
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

export function conductorGate(lot, promptId = null, decoupage = null, fileExists = existsSync) {
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
    const output = action.output ? join(REPO, action.output) : null;
    if (!output || !fileExists(output)) {
      return {
        ready: false,
        actionRequired: true,
        action,
        reason: `${action.id} doit être réalisée avant ${promptId}.`,
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

export function parseDecoupage(text) {
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
    const branch = /^Branche : (.+)$/m.exec(body)?.[1]?.trim() ?? null;
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
    steps.push({ number: Number(match[1]), title: match[2].trim(), responsible, branch, prompts });
  }
  return { ...meta, state, steps };
}

export function commitMessage(lot, step, prompt) {
  return `[${lot.id}] ${prompt.id} — ${prompt.title}`;
}

export function completedPrompts(lot, subjects) {
  const result = new Set();
  const prefix = `[${lot.id}] `;
  for (const subject of subjects) {
    if (!subject.startsWith(prefix)) continue;
    const match = /^(P\d+) — /.exec(subject.slice(prefix.length));
    if (match) result.add(match[1]);
  }
  return result;
}

export function validatePlan(plan) {
  const errors = [];
  const ids = new Set();
  const asana = new Set();
  for (const lot of plan.lots ?? []) {
    if (!LOT_ID.test(lot.id)) errors.push(`${lot.id}: identifiant invalide`);
    if (ids.has(lot.id)) errors.push(`${lot.id}: doublon`);
    ids.add(lot.id);
    if (!plan.statuses?.includes(lot.status)) errors.push(`${lot.id}: statut ${lot.status} inconnu`);
    if (!(lot.done_when?.length > 0)) errors.push(`${lot.id}: done_when vide`);
    if (['conductor-agent-lot', 'conductor-assisted'].includes(lot.execution?.mode)) {
      if (!lot.branch) errors.push(`${lot.id}: branche requise pour Conductor`);
      if (!(lot.execution.prompts?.length > 0)) errors.push(`${lot.id}: prompts Conductor vides`);
      for (const prompt of lot.execution.prompts ?? []) {
        if (!/^P\d{1,3}$/.test(prompt)) errors.push(`${lot.id}: prompt Conductor invalide ${prompt}`);
      }
      for (const action of lot.execution.actions ?? []) {
        if (!action.id) errors.push(`${lot.id}: action Conductor sans identifiant`);
        if (!/^P\d{1,3}$/.test(action.before_prompt ?? '')) errors.push(`${lot.id}: action ${action.id ?? '?'} sans before_prompt valide`);
        if (!action.type) errors.push(`${lot.id}: action ${action.id ?? '?'} sans type`);
        if (!action.title) errors.push(`${lot.id}: action ${action.id ?? '?'} sans titre`);
        if (!action.output) errors.push(`${lot.id}: action ${action.id ?? '?'} sans preuve de sortie`);
        if (!action.resume_prompt) errors.push(`${lot.id}: action ${action.id ?? '?'} sans prompt de reprise`);
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
    const file = join(DECOUPE_DIR, `${lot.id}.md`);
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
  return errors;
}

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function decoupageFor(lot) {
  const path = join(DECOUPE_DIR, `${lot.id}.md`);
  return existsSync(path) ? parseDecoupage(readFileSync(path, 'utf8')) : null;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(date);
}

function printBrief(lot, states, gate, workflow, decoupage, done) {
  console.log(`# [${lot.id}] ${lot.title}`);
  console.log(`${lot.responsible} · relu par ${lot.reviewer} · ${lot.track} · ${lot.estimate_hours || '?'} h · ${lot.status}`);
  if (lot.execution?.mode) console.log(`Exécution : ${lot.execution.mode}`);
  if (states.length === 0) console.log('\n**Dépendances** : aucune.');
  else {
    console.log('\n**Dépendances**');
    for (const state of states) console.log(`- ${state.id} — ${state.status}${state.title ? ` — ${state.title}` : ''}`);
  }
  if (!gate.ready) console.log(`\n**TROP TÔT** — attendre ${formatDate(gate.date)}.`);
  else if (!dependenciesReady(states)) console.log('\n**PAS PRÊT** — une dépendance n’est pas close.');
  else if (!workflow.ready) console.log(`\n**${workflow.reason}**`);
  else console.log('\n**PRÊT** — le lot peut commencer.');
  console.log(`\n## Pourquoi\n${lot.why ?? 'Voir les critères et les sources.'}`);
  console.log('\n## Fait quand');
  for (const criterion of lot.done_when) console.log(`- ${criterion}`);
  console.log('\n## Sources');
  for (const source of lot.sources ?? []) console.log(`- ${source}`);
  if (decoupage) {
    console.log(`\n## Découpage — état au ${decoupage.etat_au}\n${decoupage.state}`);
    for (const step of decoupage.steps) {
      console.log(`\n**Étape ${step.number} · ${step.title}** — ${step.responsible}`);
      for (const prompt of step.prompts) console.log(`- ${done.has(prompt.id) ? '✓' : '○'} \`/lot ${lot.id} ${prompt.id}\` ${prompt.title} — ${prompt.duration} min`);
    }
    console.log(`- ○ \`/lot ${lot.id} cloture\``);
  } else {
    console.log('\nAucun découpage. Si le lot dépasse quatre heures, le découper avant de coder.');
  }
}

function findPrompt(decoupage, id) {
  for (const step of decoupage?.steps ?? []) {
    const prompt = step.prompts.find((candidate) => candidate.id === id);
    if (prompt) return { step, prompt };
  }
  return null;
}

function printHumanAction(lot, action) {
  console.log(`\n## ACTION HUMAINE REQUISE — ${action.id}`);
  console.log(`Type : ${action.type}`);
  console.log(`Responsable : ${action.owner ?? lot.responsible}`);
  console.log(`Action : ${action.title}`);
  if (action.url) console.log(`Ouvrir : ${action.url}`);
  console.log(`Preuve attendue : ${action.output}`);
  console.log(`Reprise : /lot ${lot.id} ${action.resume_prompt}`);
  if (action.instructions?.length) {
    console.log('\nÀ faire');
    for (const instruction of action.instructions) console.log(`- ${instruction}`);
  }
  if (action.forbidden?.length) {
    console.log('\nInterdit pendant cette action');
    for (const item of action.forbidden) console.log(`- ${item}`);
  }
  console.log('\nConductor doit créer une tâche humaine durable, puis mettre le run en attente. Ce n’est ni un échec ni une approbation de code.');
}

function main(argv = process.argv.slice(2)) {
  const plan = loadPlan();
  const errors = validatePlan(plan);
  if (argv[0] === '--check') {
    if (errors.length) {
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 2;
    } else console.log(`OK — ${plan.lots.length} lots valides.`);
    return;
  }
  if (errors.length) {
    console.error('Plan invalide :');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 2;
    return;
  }

  const id = String(argv[0] ?? '').toUpperCase();
  if (!LOT_ID.test(id)) {
    console.error('Usage : node scripts/lot.mjs <ID> [P<n> | cloture]');
    process.exitCode = 2;
    return;
  }
  const all = lotMap(plan);
  const lot = all.get(id);
  if (!lot) {
    console.error(`Lot inconnu : ${id}`);
    process.exitCode = 2;
    return;
  }
  const states = dependencyStates(lot, all);
  const gate = dateGate(lot);
  const workflow = statusGate(lot, gate);
  const decoupage = decoupageFor(lot);
  const subjects = git(['log', '--format=%s'], '').split(/\r?\n/).filter(Boolean);
  const done = completedPrompts(lot, subjects);
  const rawMode = argv.slice(1).find((argument) => !String(argument).startsWith('--')) ?? '';
  const mode = String(rawMode).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const conductorMode = argv.includes('--conductor');
  const conductor = conductorGate(lot, mode ? mode.toUpperCase() : null, decoupage);

  if (!gate.ready || !dependenciesReady(states) || !workflow.ready) {
    printBrief(lot, states, gate, workflow, decoupage, done);
    process.exitCode = 3;
    return;
  }
  if (conductorMode && !conductor.ready) {
    printBrief(lot, states, gate, workflow, decoupage, done);
    if (conductor.actionRequired) {
      printHumanAction(lot, conductor.action);
      process.exitCode = 4;
    } else {
      console.log(`\n**NON COMPATIBLE CONDUCTOR** — ${conductor.reason}`);
      process.exitCode = 3;
    }
    return;
  }
  if (!mode) {
    printBrief(lot, states, gate, workflow, decoupage, done);
    return;
  }
  if (mode === 'cloture') {
    if (!decoupage) {
      console.log(`# [${lot.id}] clôture\n\nLot sans découpage : vérifier chaque critère puis suivre GUIDE § 3.`);
      return;
    }
    const branch = git(['branch', '--show-current'], '');
    if (lot.branch && branch !== lot.branch) {
      console.log(`# [${lot.id}] clôture\n\n**MAUVAISE BRANCHE** — session sur \`${branch || 'inconnue'}\`, lot sur \`${lot.branch}\`. S'arrêter.`);
      process.exitCode = 3;
      return;
    }
    const remaining = [];
    for (const step of decoupage.steps) {
      if (step.branch && branch && step.branch !== branch) continue;
      for (const prompt of step.prompts) if (!done.has(prompt.id)) remaining.push(prompt.id);
    }
    console.log(`# [${lot.id}] clôture — branche ${branch || 'inconnue'}`);
    if (remaining.length) {
      console.log(`\n**PAS PRÊTE** — prompts sans commit : ${remaining.join(', ')}.`);
      process.exitCode = 3;
    } else console.log('\n**PRÊTE** — lancer les contrôles, les deux relectures et la PR selon le skill.');
    return;
  }
  const promptId = mode.toUpperCase();
  if (!/^P\d+$/.test(promptId) || !decoupage) {
    console.error(`Prompt invalide ou lot non découpé : ${argv[1]}`);
    process.exitCode = 2;
    return;
  }
  const found = findPrompt(decoupage, promptId);
  if (!found) {
    console.error(`Prompt inconnu : ${id} ${promptId}`);
    process.exitCode = 2;
    return;
  }
  const { step, prompt } = found;
  const branch = git(['branch', '--show-current'], '');
  const expectedBranch = step.branch ?? lot.branch;
  if (expectedBranch && branch !== expectedBranch) {
    console.log(`# [${lot.id}] ${prompt.id}\n\n**MAUVAISE BRANCHE** — session sur \`${branch || 'inconnue'}\`, prompt sur \`${expectedBranch}\`. S'arrêter.`);
    process.exitCode = 3;
    return;
  }
  console.log(`# [${lot.id}] ${prompt.id} · ${prompt.title} — ${prompt.duration} min`);
  console.log(`Étape ${step.number} · ${step.title} — ${step.responsible} · branche \`${step.branch ?? lot.branch ?? 'à créer'}\``);
  if (conductorMode) {
    console.log('\n## Conductor');
    console.log('- Travailler dans le worktree isolé fourni ; ne pas créer de worktree imbriqué.');
    console.log('- Commiter avec le message exact, mais ne pas pousser, ouvrir de PR ou déployer.');
    console.log('- Rendre le commit à Conductor : la plateforme proposera le push à la validation humaine.');
  }
  if (done.has(prompt.id)) console.log(`\n⚠️ ${prompt.id} a déjà un commit.`);
  for (const [title, values] of [['Fichiers', prompt.files], ['Sources', prompt.sources], ['Faire', prompt.actions]]) {
    console.log(`\n## ${title}`);
    for (const value of values) console.log(`- ${value}`);
  }
  console.log(`\n## Test\n${prompt.test}`);
  console.log(`\n## Fini quand\n${prompt.done}`);
  console.log(`\n## Hors périmètre\n${prompt.out}`);
  console.log(`\n## Commit\n${commitMessage(lot, step, prompt)}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
