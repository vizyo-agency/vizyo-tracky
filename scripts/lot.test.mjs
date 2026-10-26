import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import {
  ACCEPTED_BRANCHES,
  EXIT,
  classifyBranch,
  commitMessage,
  completedPrompts,
  conductorGate,
  dateGate,
  dependenciesReady,
  dependencyStates,
  loadPlan,
  lotMap,
  parseDecoupage,
  run,
  statusGate,
  validatePlan,
} from './lot.mjs';

// ── Fixtures : aucun test de ce bloc ne lit le plan réel du dépôt ─────────────────────────────
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const STATUSES = ['done', 'partial', 'ready', 'waiting', 'decision', 'backlog'];
const NOW = new Date('2026-06-01T10:00:00Z');
const FIRST_SUBJECT = '[T1.1] P1 — Premier prompt';
const SECOND_SUBJECT = '[T1.1] P2 — Deuxième prompt';
const THIRD_SUBJECT = '[T1.1] P3 — Troisième prompt';

function lotFixture(overrides = {}) {
  return {
    id: 'T1.1',
    title: 'Lot de test',
    stream: 'Test',
    status: 'ready',
    asana_task_id: 'asana-t11',
    responsible: 'Alice',
    reviewer: 'Bob',
    track: 'Essai',
    estimate_hours: 2,
    depends: [],
    branch: 'lot/T1.1-essai',
    execution: { mode: 'conductor-agent-lot', prompts: ['P1', 'P2', 'P3'] },
    done_when: ['critère vérifiable'],
    sources: ['source.md'],
    ...overrides,
  };
}

function promptBlock(number, title) {
  return [
    `### P${number} · ${title}`,
    'Durée : 20 min',
    'Fichiers : a.txt · b.txt',
    'Sources : doc § 1',
    '',
    'Faire :',
    `- geste ${number}`,
    '',
    'Test : `node -v`',
    `Fini quand : critère ${number}`,
    'Hors périmètre : le reste',
    '',
  ].join('\n');
}

/** Un découpage à deux étapes (P1-P2 puis P3) sur la même branche. */
function decoupageText({ lotId = 'T1.1', branch = 'lot/T1.1-essai', eol = '\n' } = {}) {
  return [
    '---',
    `lot: ${lotId}`,
    'etat_au: 2026-06-01',
    '---',
    '',
    `# ${lotId} — Lot de test`,
    '',
    '## État',
    '',
    'Un état vérifiable.',
    '',
    '## Étape 1 · Début',
    'Responsable : Alice',
    `Branche : ${branch}`,
    '',
    promptBlock(1, 'Premier prompt'),
    promptBlock(2, 'Deuxième prompt'),
    '## Étape 2 · Fin',
    'Responsable : Alice',
    `Branche : ${branch}`,
    '',
    promptBlock(3, 'Troisième prompt'),
  ]
    .join('\n')
    .replace(/\n/g, eol);
}

/** Écrit un plan et ses découpages dans un dossier jetable, rend l'environnement injectable de `run()`. */
function fixtureEnv({ lots = [lotFixture()], decoupes = { 'T1.1': decoupageText() }, branch = 'lot/T1.1-essai', subjects = [], now = NOW, checkEvidence, gitError = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lot-test-'));
  tempDirs.push(dir);
  const decoupeDir = join(dir, 'decoupe');
  mkdirSync(decoupeDir, { recursive: true });
  const planPath = join(dir, 'plan.json');
  writeFileSync(planPath, JSON.stringify({ version: 2, statuses: STATUSES, lots }));
  for (const [id, text] of Object.entries(decoupes)) writeFileSync(join(decoupeDir, `${id}.md`), text);
  const failure = () => {
    throw new Error(gitError);
  };
  const git = gitError ? { branch: failure, subjects: failure } : { branch: () => branch, subjects: () => subjects };
  return { repo: dir, planPath, decoupeDir, now, git, ...(checkEvidence ? { checkEvidence } : {}) };
}

/** `run()` en mode Conductor : rend le résultat brut et la dernière ligne de stdout décodée. */
function conductor(args, options) {
  const result = run([...args, '--conductor'], fixtureEnv(options));
  const last = result.stdout.trimEnd().split('\n').at(-1);
  assert.ok(last.startsWith('CONDUCTOR_RESULT '), `dernière ligne inattendue : ${last}`);
  return { ...result, json: JSON.parse(last.slice('CONDUCTOR_RESULT '.length)) };
}

function plain(args, options) {
  return run(args, fixtureEnv(options));
}

// ── Contrat CONDUCTOR_RESULT v1 ───────────────────────────────────────────────────────────────
test('contrat : la ligne finale a exactement les clés et l’ordre du contrat v1', () => {
  const { json, exitCode } = conductor(['T1.1', 'P1']);
  assert.equal(exitCode, EXIT.READY);
  assert.deepEqual(Object.keys(json), ['version', 'status', 'exit_code', 'lot', 'prompt', 'reason', 'branch', 'action', 'commit_message']);
  assert.deepEqual(Object.keys(json.branch), ['current', 'accepted']);
  assert.deepEqual(json.branch.accepted, ['conductor/<agent>/<exec>', 'lot/<ID>-<slug>']);
  assert.deepEqual(json.branch.accepted, [...ACCEPTED_BRANCHES]);
  assert.equal(json.version, 1);
});

test('contrat ready : exit_code 0, commit_message exact, aucune action ni raison', () => {
  const { json, exitCode, stdout } = conductor(['T1.1', 'P1']);
  assert.equal(exitCode, 0);
  assert.equal(json.status, 'ready');
  assert.equal(json.exit_code, 0);
  assert.equal(json.lot, 'T1.1');
  assert.equal(json.prompt, 'P1');
  assert.equal(json.reason, null);
  assert.equal(json.action, null);
  assert.equal(json.commit_message, '[T1.1] P1 — Premier prompt');
  assert.match(stdout, /## Commit\n\[T1\.1\] P1 — Premier prompt\n/);
});

test('contrat : lot et prompt en minuscules sont normalisés', () => {
  const { json } = conductor(['t1.1', 'p1']);
  assert.equal(json.status, 'ready');
  assert.equal(json.lot, 'T1.1');
  assert.equal(json.prompt, 'P1');
});

test('contrat : la ligne CONDUCTOR_RESULT est la DERNIÈRE ligne de stdout pour chaque statut', () => {
  const cases = [
    conductor(['T1.1', 'P1']), // ready
    conductor(['T1.1', 'P1'], { now: NOW, lots: [lotFixture({ not_before: '2999-01-01T00:00:00+01:00', status: 'waiting' })] }), // too_early
    conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'backlog' })] }), // blocked
    conductor(['T9.9', 'P1']), // error
  ];
  assert.deepEqual(cases.map(({ json }) => json.status), ['ready', 'too_early', 'blocked', 'error']);
  for (const { stdout } of cases) {
    const lines = stdout.trimEnd().split('\n');
    assert.equal(lines.filter((line) => line.startsWith('CONDUCTOR_RESULT ')).length, 1);
    assert.ok(lines.at(-1).startsWith('CONDUCTOR_RESULT '));
    assert.ok(!lines.at(-1).includes('\n'));
  }
});

test('contrat : exit_code du JSON = code de sortie du processus, pour tous les statuts', () => {
  const expected = [
    [conductor(['T1.1', 'P1']), 0, 'ready'],
    [conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'waiting', not_before: '2999-01-01T00:00:00+01:00' })] }), 3, 'too_early'],
    [conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'decision' })] }), 3, 'blocked'],
    [conductor(['T9.9', 'P1']), 2, 'error'],
  ];
  for (const [result, code, status] of expected) {
    assert.equal(result.exitCode, code);
    assert.equal(result.json.exit_code, code);
    assert.equal(result.json.status, status);
  }
});

test('contrat : too_early et dépendance ouverte sont deux statuts distincts, tous deux en code 3', () => {
  const early = conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'waiting', not_before: '2999-01-01T00:00:00+01:00' })] });
  assert.equal(early.json.status, 'too_early');
  assert.match(early.json.reason, /TROP TÔT/);
  const blocked = conductor(['T1.1', 'P1'], { lots: [lotFixture({ depends: ['T0.1'] }), lotFixture({ id: 'T0.1', status: 'waiting', branch: undefined, execution: undefined, asana_task_id: 'a0' })] });
  assert.equal(blocked.json.status, 'blocked');
  assert.match(blocked.json.reason, /T0\.1/);
  assert.equal(blocked.exitCode, 3);
});

test('contrat : usage (sans prompt, prompt invalide, lot inconnu, option inconnue) = error, code 2', () => {
  for (const args of [['T1.1'], ['T1.1', 'banane'], ['T9.9', 'P1'], ['pas-un-lot', 'P1'], ['T1.1', 'P1', '--nimporte']]) {
    const result = run([...args, '--conductor'], fixtureEnv());
    assert.equal(result.exitCode, 2, args.join(' '));
    const last = result.stdout.trimEnd().split('\n').at(-1);
    assert.equal(JSON.parse(last.slice('CONDUCTOR_RESULT '.length)).status, 'error', args.join(' '));
  }
  const noArgs = run(['--conductor'], fixtureEnv());
  assert.equal(JSON.parse(noArgs.stdout.trimEnd().split('\n').at(-1).slice(17)).lot, null);
});

test('contrat : un prompt absent du découpage = error 2 ; un lot sans découpage = blocked 3', () => {
  const unknown = conductor(['T1.1', 'P9']);
  assert.equal(unknown.exitCode, 2);
  assert.equal(unknown.json.status, 'error');
  const none = conductor(['T1.1', 'P1'], { decoupes: {}, lots: [lotFixture({ execution: undefined })] });
  assert.equal(none.exitCode, 3);
  assert.equal(none.json.status, 'blocked');
  assert.match(none.json.reason, /découpé/);
});

test('contrat : un plan invalide ou illisible = error 2 avec la ligne finale', () => {
  const env = fixtureEnv({ lots: [lotFixture({ done_when: [] })] });
  const invalid = run(['T1.1', 'P1', '--conductor'], env);
  assert.equal(invalid.exitCode, 2);
  assert.match(invalid.stdout.trimEnd().split('\n').at(-1), /^CONDUCTOR_RESULT .*"status":"error"/);
  const missing = run(['T1.1', 'P1', '--conductor'], { ...env, planPath: join(env.repo, 'absent.json') });
  assert.equal(missing.exitCode, 2);
  assert.match(missing.stdout.trimEnd().split('\n').at(-1), /"status":"error"/);
});

test('contrat : une panne de git est une erreur (2), jamais « aucun commit »', () => {
  const { json, exitCode } = conductor(['T1.1', 'P1'], { gitError: 'safe.directory' });
  assert.equal(exitCode, 2);
  assert.equal(json.status, 'error');
  assert.match(json.reason, /git indisponible/);
});

test('contrat : la clôture est refusée en mode Conductor (blocked, 3), sans toucher au code de la branche', () => {
  for (const word of ['cloture', 'clôture', 'CLOTURE']) {
    const { json, exitCode } = conductor(['T1.1', word], { subjects: [FIRST_SUBJECT, SECOND_SUBJECT, THIRD_SUBJECT] });
    assert.equal(exitCode, 3, word);
    assert.equal(json.status, 'blocked');
    assert.equal(json.prompt, 'cloture');
    assert.match(json.reason, /clôture/);
  }
});

test('contrat : hors --conductor, aucune ligne CONDUCTOR_RESULT et les codes historiques', () => {
  const ready = plain(['T1.1', 'P1']);
  assert.equal(ready.exitCode, 0);
  assert.ok(!ready.stdout.includes('CONDUCTOR_RESULT'));
  const wrongBranch = plain(['T1.1', 'P1'], { branch: 'autre' });
  assert.equal(wrongBranch.exitCode, 3);
  assert.match(wrongBranch.stdout, /MAUVAISE BRANCHE/);
  assert.ok(!wrongBranch.stdout.includes('CONDUCTOR_RESULT'));
  assert.equal(plain(['T1.1', 'P9']).exitCode, 2);
  assert.equal(plain(['pas-un-lot']).exitCode, 2);
  assert.equal(plain(['T1.1']).exitCode, 0);
  const check = plain(['--check']);
  assert.equal(check.exitCode, 0);
  assert.match(check.stdout, /^OK — 1 lots valides\./);
});

test('contrat : aucune valeur de compte ni de secret n’est ajoutée à la ligne finale', () => {
  const { stdout } = conductor(['T1.1', 'P1']);
  const line = stdout.trimEnd().split('\n').at(-1);
  assert.ok(!/token|secret|password|cookie/i.test(line));
});

// ── Branche d'exécution (mode Conductor) ──────────────────────────────────────────────────────
test('branche : conductor/<agent>/<exec> est acceptée', () => {
  const { json, exitCode } = conductor(['T1.1', 'P1'], { branch: 'conductor/agent-lot/abc123' });
  assert.equal(exitCode, 0);
  assert.equal(json.status, 'ready');
  assert.equal(json.branch.current, 'conductor/agent-lot/abc123');
});

test('branche : lot/<ID>-<slug> du MÊME lot est acceptée', () => {
  const { json } = conductor(['T1.1', 'P1'], { branch: 'lot/T1.1-essai' });
  assert.equal(json.status, 'ready');
  assert.equal(json.branch.current, 'lot/T1.1-essai');
});

test('branche : HEAD détaché = blocked, branch.current null, raison explicite, aucune consigne de code', () => {
  const { json, exitCode, stdout } = conductor(['T1.1', 'P1'], { branch: '' });
  assert.equal(exitCode, 3);
  assert.equal(json.status, 'blocked');
  assert.equal(json.branch.current, null);
  assert.match(json.reason, /HEAD détaché/);
  assert.match(json.reason, /branche/);
  assert.ok(!stdout.includes('## Fichiers'));
  assert.equal(json.action, null);
});

test('branche : main (et les branches d’intégration) ne sont jamais acceptées', () => {
  for (const branch of ['main', 'master', 'develop', 'dev', 'prd', 'production', 'staging']) {
    const { json, exitCode } = conductor(['T1.1', 'P1'], { branch });
    assert.equal(exitCode, 3, branch);
    assert.equal(json.status, 'blocked');
    assert.equal(json.branch.current, branch);
    assert.match(json.reason, /protégée/);
  }
});

test('branche : une branche non conforme, d’un autre lot ou différente de celle du lot est refusée', () => {
  for (const branch of ['chore/lot-correctifs', 'fix/quelque-chose', 'feat/x', 'conductor/seul', 'conductor/a/b/c', 'lot/T9.9-autre', 'lot/T1.1-', 'lot/T1.1-Autre-Slug', 'lot/T1.1-autre']) {
    const { json, exitCode } = conductor(['T1.1', 'P1'], { branch });
    assert.equal(exitCode, 3, branch);
    assert.equal(json.status, 'blocked', branch);
    assert.match(json.reason, /MAUVAISE BRANCHE/);
  }
});

test('branche : classifyBranch est pur et rend le type accepté', () => {
  const lot = lotFixture();
  assert.deepEqual(classifyBranch('conductor/agent-lot/x1', lot), { ok: true, kind: 'conductor' });
  assert.deepEqual(classifyBranch('lot/T1.1-essai', lot), { ok: true, kind: 'lot' });
  assert.equal(classifyBranch('', lot).ok, false);
  assert.equal(classifyBranch('main', lot).ok, false);
  assert.equal(classifyBranch('conductor/../x', lot).ok, false);
  assert.equal(classifyBranch('lot/T1.1-essai', lot, 'lot/T1.1-autre').ok, false);
  assert.equal(classifyBranch('conductor/agent/e1', lot, 'lot/T1.1-autre').ok, true);
});

test('branche : hors Conductor, la branche du lot reste exigée à l’identique', () => {
  assert.equal(plain(['T1.1', 'P1'], { branch: 'conductor/agent-lot/abc123' }).exitCode, 3);
  assert.equal(plain(['T1.1', 'P1'], { branch: 'lot/T1.1-essai' }).exitCode, 0);
});

test('compat : --depuis <ref> (Conductor antérieur au contrat) est accepté et sans effet', () => {
  const { json } = conductor(['T1.1', 'P1', '--depuis', 'origin/main'], { branch: 'conductor/agent-lot/abc123' });
  assert.equal(json.status, 'ready');
});

test('commit_message est fourni dès que le prompt est connu, même bloqué', () => {
  const { json } = conductor(['T1.1', 'P2'], { branch: 'main' });
  assert.equal(json.status, 'blocked');
  assert.equal(json.commit_message, '[T1.1] P2 — Deuxième prompt');
});

// ═════ Tests couplés au plan réel (remplacés par le commit « tests sur fixtures ») ═════
const plan = loadPlan();
const all = lotMap(plan);

test('le plan complet est valide', () => {
  assert.deepEqual(validatePlan(plan), []);
});
test('S2.2 reste bloqué tant que S2.1 n’est pas clos', () => {
  const states = dependencyStates(all.get('S2.2'), all);
  assert.equal(states[0].id, 'S2.1');
  assert.equal(dependenciesReady(states), false);
});

test('la date minimale de S2.1 est un verrou réel', () => {
  const lot = all.get('S2.1');
  assert.equal(dateGate(lot, new Date('2026-10-26T07:40:59Z')).ready, false);
  assert.equal(dateGate(lot, new Date('2026-10-26T07:41:00Z')).ready, true);
  assert.equal(statusGate(lot, dateGate(lot, new Date('2026-10-26T07:41:00Z'))).ready, true);
});

test('un backlog ou un lot terminé ne peut pas partir par accident', () => {
  assert.equal(statusGate(all.get('B0.2'), { ready: true }).ready, false);
  assert.equal(statusGate(all.get('P6.5'), { ready: true }).ready, false);
  assert.equal(statusGate(all.get('S2.2'), { ready: true }).ready, true);
});

test('Conductor distingue action humaine, prompt dépôt et clôture', () => {
  const s21 = parseDecoupage(readFileSync(join(process.cwd(), 'docs', 'pilotage', 'decoupe', 'S2.1.md'), 'utf8'));
  const s22 = parseDecoupage(readFileSync(join(process.cwd(), 'docs', 'pilotage', 'decoupe', 'S2.2.md'), 'utf8'));
  const action = conductorGate(all.get('S2.1'), 'P1', s21, () => false);
  assert.equal(action.ready, false);
  assert.equal(action.actionRequired, true);
  assert.equal(action.action.id, 'S2.1-A1');
  assert.equal(conductorGate(all.get('S2.1'), 'P1', s21, () => true).ready, true);
  assert.equal(conductorGate(all.get('S2.2'), 'P1', s22).ready, true);
  assert.equal(conductorGate(all.get('S2.2'), 'P99', s22).ready, false);
  assert.equal(conductorGate(all.get('S2.2'), 'CLOTURE', s22).ready, false);
});

test('un futur lot découpé est compatible sans liste blanche dédiée', () => {
  const decoupage = {
    steps: [{ prompts: [{ id: 'P1' }] }],
  };
  assert.equal(conductorGate({ id: 'B0.6', execution: {} }, 'P1', decoupage).ready, true);
});

test('le découpage S2.2 expose quatre prompts complets', () => {
  const path = join(process.cwd(), 'docs', 'pilotage', 'decoupe', 'S2.2.md');
  const parsed = parseDecoupage(readFileSync(path, 'utf8'));
  const prompts = parsed.steps.flatMap((step) => step.prompts);
  assert.deepEqual(prompts.map((prompt) => prompt.id), ['P1', 'P2', 'P3', 'P4']);
  assert.equal(commitMessage(all.get('S2.2'), parsed.steps[0], prompts[0]), '[S2.2] P1 — Retirer la promotion expirée sans inventer une nouvelle offre');
});

test('les commits exacts déterminent les prompts faits', () => {
  const done = completedPrompts(all.get('S2.2'), [
    '[S2.2] P1 — Retirer la promotion expirée sans inventer une nouvelle offre',
    'autre commit',
  ]);
  assert.deepEqual([...done], ['P1']);
});
