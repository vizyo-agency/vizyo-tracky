import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXIT,
  HUMAN_ACTION_TYPES,
  acceptedBranches,
  classifyBranch,
  clotureAfterWork,
  commitMessage,
  completedPrompts,
  conductorBranch,
  conductorGate,
  dateGate,
  dependenciesReady,
  dependencyStates,
  formatDate,
  inspectEvidence,
  loadPlan,
  lotMap,
  parseDecoupage,
  parseNotBefore,
  promptsBefore,
  run,
  scrubLocalPaths,
  statusGate,
  validatePlan,
  validateRelativePath,
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
  assert.deepEqual(json.branch.accepted, ['conductor/agent-lot/T1.1', 'lot/T1.1-<slug>']);
  assert.deepEqual(json.branch.accepted, acceptedBranches('T1.1'));
  assert.equal(conductorBranch('T1.1'), 'conductor/agent-lot/T1.1');
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
test('branche : conductor/agent-lot/<ID> du lot demandé est acceptée', () => {
  const { json, exitCode, stdout } = conductor(['T1.1', 'P1'], { branch: 'conductor/agent-lot/T1.1' });
  assert.equal(exitCode, 0);
  assert.equal(json.status, 'ready');
  assert.equal(json.branch.current, 'conductor/agent-lot/T1.1');
  assert.ok(stdout.includes('· branche `conductor/agent-lot/T1.1`'), 'le brief annonce la branche unique du contrat');
});

test('branche : branch.accepted porte l’ID du lot rempli, et <ID> tant que le lot est inconnu', () => {
  assert.deepEqual(conductor(['T1.1', 'P1'], { branch: 'main' }).json.branch.accepted, ['conductor/agent-lot/T1.1', 'lot/T1.1-<slug>']);
  assert.deepEqual(conductor(['T9.9', 'P1']).json.branch.accepted, ['conductor/agent-lot/T9.9', 'lot/T9.9-<slug>']);
  const noLot = run(['--conductor'], fixtureEnv()).stdout.trimEnd().split('\n').at(-1);
  assert.deepEqual(JSON.parse(noLot.slice('CONDUCTOR_RESULT '.length)).branch.accepted, ['conductor/agent-lot/<ID>', 'lot/<ID>-<slug>']);
});

test('branche : tout autre conductor/* est refusé (autre lot, autre agent, ancien format <agent>/<exec>)', () => {
  const generic = 'seule conductor/agent-lot/T1.1 est acceptée';
  const refused = {
    'conductor/agent-lot/T9.9': 'appartient au lot T9.9, pas à T1.1',
    'conductor/agent-lot/T1.11': 'appartient au lot T1.11, pas à T1.1',
    'conductor/agent-lot/t1.1': generic,
    'conductor/agent-lot/T1.1-bis': generic,
    'conductor/agent-lot/T1.1/x': generic,
    'conductor/agent-lot/abc123': generic,
    'conductor/autre-agent/T1.1': generic,
    'conductor/agent-lot/exec-42': generic,
    'conductor/agent-lot': generic,
  };
  for (const [branch, expected] of Object.entries(refused)) {
    const { json, exitCode, stdout } = conductor(['T1.1', 'P1'], { branch });
    assert.equal(exitCode, 3, branch);
    assert.equal(json.status, 'blocked', branch);
    assert.equal(json.branch.current, branch);
    assert.ok(json.reason.startsWith('MAUVAISE BRANCHE'), json.reason);
    assert.ok(json.reason.includes(expected), `${branch} : ${json.reason}`);
    assert.ok(!stdout.includes('## Fichiers'), 'aucune consigne de code sur une branche refusée');
  }
});

test('branche : la branche d’un AUTRE lot ne sert jamais, même au bon format', () => {
  const other = lotFixture({ id: 'T2.1', asana_task_id: 'a2', branch: 'lot/T2.1-autre' });
  const decoupes = { 'T1.1': decoupageText(), 'T2.1': decoupageText({ lotId: 'T2.1', branch: 'lot/T2.1-autre' }) };
  const wrong = conductor(['T1.1', 'P1'], { lots: [lotFixture(), other], decoupes, branch: 'conductor/agent-lot/T2.1' });
  assert.equal(wrong.json.status, 'blocked');
  assert.ok(wrong.json.reason.includes('appartient au lot T2.1, pas à T1.1'));
  assert.equal(conductor(['T2.1', 'P1'], { lots: [other], decoupes, branch: 'conductor/agent-lot/T2.1' }).json.status, 'ready');
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
  assert.deepEqual(classifyBranch('conductor/agent-lot/T1.1', lot), { ok: true, kind: 'conductor' });
  assert.equal(classifyBranch('conductor/agent-lot/x1', lot).ok, false);
  assert.equal(classifyBranch('conductor/agent-lot/T9.9', lot).ok, false);
  assert.equal(classifyBranch('conductor/agent/T1.1', lot).ok, false);
  assert.ok(classifyBranch('', lot).reason.includes('HEAD détaché') && classifyBranch('', lot).reason.includes('conductor/agent-lot/T1.1'));
  assert.deepEqual(classifyBranch('lot/T1.1-essai', lot), { ok: true, kind: 'lot' });
  assert.equal(classifyBranch('', lot).ok, false);
  assert.equal(classifyBranch('main', lot).ok, false);
  assert.equal(classifyBranch('conductor/../x', lot).ok, false);
  assert.equal(classifyBranch('lot/T1.1-essai', lot, 'lot/T1.1-autre').ok, false);
  assert.equal(classifyBranch('conductor/agent-lot/T1.1', lot, 'lot/T1.1-autre').ok, true, 'la branche Conductor ne dépend pas du slug du plan');
});

test('branche : hors Conductor, la branche du lot reste exigée à l’identique', () => {
  assert.equal(plain(['T1.1', 'P1'], { branch: 'conductor/agent-lot/T1.1' }).exitCode, 3);
  assert.equal(plain(['T1.1', 'P1'], { branch: 'lot/T1.1-essai' }).exitCode, 0);
});

test('compat : --depuis <ref> (Conductor antérieur au contrat) est accepté et sans effet', () => {
  const { json } = conductor(['T1.1', 'P1', '--depuis', 'origin/main'], { branch: 'conductor/agent-lot/T1.1' });
  assert.equal(json.status, 'ready');
});

// Un chemin absolu local (Windows, UNC ou POSIX usuel) ne doit jamais apparaître dans une raison ni dans stderr.
const ABSOLUTE_LOCAL_PATH = /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|private|root|mnt|opt|etc|usr|srv|Volumes)\/)/;

function assertNoLocalPath(text, label) {
  assert.ok(!ABSOLUTE_LOCAL_PATH.test(text), `${label} : chemin absolu local dans « ${text} »`);
}

test('reason : un plan absent ou illisible ne révèle que son chemin relatif au dépôt', () => {
  const env = fixtureEnv();
  const missing = conductorWith(['T1.1', 'P1'], { ...env, planPath: join(env.repo, 'docs', 'pilotage', 'absent.json') });
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.json.reason, 'Plan illisible : docs/pilotage/absent.json (ENOENT)');
  assertNoLocalPath(missing.json.reason, 'plan absent');
  assertNoLocalPath(missing.stderr, 'stderr, plan absent');
  assert.ok(!missing.json.reason.includes(env.repo) && !missing.stdout.includes(env.repo));

  const broken = join(env.repo, 'plan-casse.json');
  writeFileSync(broken, '{ "lots": [');
  const invalid = conductorWith(['T1.1', 'P1'], { ...env, planPath: broken });
  assert.equal(invalid.exitCode, 2);
  assert.ok(invalid.json.reason.startsWith('Plan illisible : plan-casse.json (JSON invalide'), invalid.json.reason);
  assertNoLocalPath(invalid.json.reason, 'plan cassé');

  const outside = conductorWith(['T1.1', 'P1'], { ...env, planPath: join(tmpdir(), 'lot-inexistant-hors-depot', 'plan.json') });
  assert.equal(outside.json.reason, 'Plan illisible : plan.json (ENOENT)', 'hors dépôt : le nom du fichier seulement');
  assertNoLocalPath(outside.stderr, 'plan hors dépôt');
});

test('reason : une erreur interne ou git qui cite un chemin absolu est assainie (racine du dépôt, lecteur, POSIX, UNC)', () => {
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
  const thrown = (message) => ({ ...env, checkEvidence: () => { throw new Error(message); } });
  const inRepo = conductorWith(['T1.1', 'P1'], thrown(`EACCES: permission denied, open '${join(env.repo, 'docs', 'preuve', 'releve.md')}'`));
  assert.equal(inRepo.exitCode, 2);
  assert.equal(inRepo.json.status, 'error');
  assert.ok(inRepo.json.reason.includes(`open 'docs`), inRepo.json.reason);
  assert.ok(inRepo.json.reason.includes('preuve'), 'la partie relative au dépôt reste lisible');
  assertNoLocalPath(inRepo.json.reason, 'dans le dépôt');
  assert.ok(!inRepo.json.reason.includes(env.repo));
  for (const absolute of ['C:\\Users\\alice\\AppData\\x.json', 'D:/www/projet/x.json', '\\\\serveur\\partage\\x', '/Users/alice/x', '/home/alice/.ssh/x', '/tmp/lot-abc/x']) {
    const result = conductorWith(['T1.1', 'P1'], thrown(`ENOENT: no such file or directory, open '${absolute}'`));
    assert.equal(result.exitCode, 2, absolute);
    assert.ok(result.json.reason.includes('<chemin local>'), `${absolute} → ${result.json.reason}`);
    assertNoLocalPath(result.json.reason, absolute);
    assertNoLocalPath(result.stderr, `stderr ${absolute}`);
  }
  const git = conductor(['T1.1', 'P1'], { gitError: `fatal: detected dubious ownership in repository at '${env.repo}'` });
  assert.equal(git.exitCode, 2);
  assertNoLocalPath(git.json.reason, 'git');
});

test('reason : scrubLocalPaths ne touche ni les chemins relatifs ni les URL', () => {
  const repo = join(tmpdir(), 'lot-scrub-depot');
  assert.equal(scrubLocalPaths('docs/pilotage/plan.json absent', repo), 'docs/pilotage/plan.json absent');
  assert.equal(scrubLocalPaths('https://example.test/tmp/x et /lot S2.1 P1', repo), 'https://example.test/tmp/x et /lot S2.1 P1');
  assert.equal(scrubLocalPaths(`${repo}/scripts/lot.mjs`, repo), 'scripts/lot.mjs');
  assert.equal(scrubLocalPaths(`${repo.replaceAll('\\', '/')}/docs/a.md`, repo), 'docs/a.md');
  assert.equal(scrubLocalPaths(`erreur dans ${repo}`, repo), 'erreur dans .');
  assert.equal(scrubLocalPaths(null, repo), '');
});

test('reason : aucun statut du contrat ne laisse passer un chemin absolu local', () => {
  const absoluteBranch = 'conductor/agent-lot/T9.9';
  const cases = [
    conductor(['T1.1', 'P1']),
    conductor(['T1.1', 'P1'], { branch: absoluteBranch }),
    conductor(['T1.1', 'P1'], { branch: '' }),
    conductor(['T1.1', 'P3']),
    conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'waiting', not_before: '2999-01-01T00:00:00+01:00' })] }),
    conductor(['T9.9', 'P1']),
    conductor(['T1.1', 'banane']),
  ];
  for (const { json, stdout, stderr } of cases) {
    assertNoLocalPath(json.reason ?? '', json.status);
    assertNoLocalPath(stdout, `stdout ${json.status}`);
    assertNoLocalPath(stderr, `stderr ${json.status}`);
  }
  const real = run(['S2.1', 'P1', '--conductor'], { git: { branch: () => 'main', subjects: () => [] }, now: new Date('2026-10-26T05:00:00Z') });
  assertNoLocalPath(real.stdout, 'plan réel');
});

test('arguments : --depuis n’avale jamais l’option suivante, sa valeur est obligatoire', () => {
  // `--depuis --conductor` : erreur d'usage, ET --conductor est bien lu (la ligne finale est émise).
  const swallowed = run(['T1.1', 'P1', '--depuis', '--conductor'], fixtureEnv());
  assert.equal(swallowed.exitCode, 2);
  const last = swallowed.stdout.trimEnd().split('\n').at(-1);
  assert.ok(last.startsWith('CONDUCTOR_RESULT '), 'le mode Conductor survit à l’erreur');
  const json = JSON.parse(last.slice('CONDUCTOR_RESULT '.length));
  assert.equal(json.status, 'error');
  assert.ok(json.reason.includes('--depuis attend une référence git'));
  for (const args of [['T1.1', 'P1', '--depuis'], ['T1.1', 'P1', '--depuis', ''], ['T1.1', 'P1', '--depuis', '-x'], ['T1.1', 'P1', '--depuis', '--rejouer'], ['--depuis', 'T1.1', '--check']]) {
    for (const mode of [[], ['--conductor']]) {
      const result = run([...args, ...mode], fixtureEnv());
      assert.equal(result.exitCode, 2, [...args, ...mode].join(' '));
      assert.ok(!result.stdout.includes('## Fichiers'), 'rien n’est exécuté');
    }
  }
  assert.equal(run(['T1.1', 'P1', '--depuis', 'origin/main'], fixtureEnv()).exitCode, 0);
  assert.equal(run(['T1.1', 'P1', '--depuis', 'origin/main', '--rejouer'], fixtureEnv()).exitCode, 0);
  assert.equal(run(['--depuis', 'origin/main', 'T1.1', 'P1'], fixtureEnv()).exitCode, 0);
});

test('arguments : option inconnue, forme --depuis=<ref>, option courte et arguments en trop = exit 2 propre', () => {
  for (const args of [['T1.1', 'P1', '--nimporte'], ['T1.1', 'P1', '--depuis=origin/main'], ['T1.1', 'P1', '-x'], ['T1.1', 'P1', '-'], ['T1.1', 'P1', 'P2'], ['T1.1', 'P1', 'cloture'], ['T1.1', 'P1', 'x', 'y'], ['T1.1', '--check'], ['--check', 'T1.1'], ['--check', '--check']]) {
    const result = run(args, fixtureEnv());
    assert.equal(result.exitCode, 2, args.join(' '));
    assert.ok(result.stderr.length > 0, args.join(' '));
    assert.ok(!/at .*lot\.mjs/.test(result.stderr), 'pas de pile d’appels');
    assert.ok(!result.stdout.includes('CONDUCTOR_RESULT'), 'hors --conductor, jamais de ligne finale');
  }
  const unknown = run(['T1.1', 'P1', '--conductor', '--nimporte'], fixtureEnv());
  assert.equal(unknown.exitCode, 2);
  assert.match(unknown.stderr, /Option inconnue : --nimporte/);
  const extra = run(['T1.1', 'P1', 'P2', '--conductor'], fixtureEnv());
  assert.equal(extra.exitCode, 2);
  assert.match(extra.stderr, /Arguments en trop : P2/);
  assert.equal(JSON.parse(extra.stdout.trimEnd().split('\n').at(-1).slice('CONDUCTOR_RESULT '.length)).status, 'error');
});

test('commit_message est fourni dès que le prompt est connu, même bloqué', () => {
  const { json } = conductor(['T1.1', 'P2'], { branch: 'main' });
  assert.equal(json.status, 'blocked');
  assert.equal(json.commit_message, '[T1.1] P2 — Deuxième prompt');
});

// ── Clôture : débloquée après le dernier prompt, jamais pour un lot déjà fini avant les travaux ──
const ALL_THREE = [THIRD_SUBJECT, SECOND_SUBJECT, FIRST_SUBJECT];

test('clôture : un lot passé à done par ses propres commits peut se clôturer', () => {
  const done = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE });
  assert.equal(done.exitCode, 0);
  assert.match(done.stdout, /PRÊTE/);
  assert.match(done.stdout, /vient des commits de cette branche/);
  assert.ok(!done.stdout.includes('TERMINÉ'));
});

test('clôture : même résultat que pour un lot encore ready (le statut done ne change rien à l’éligibilité)', () => {
  const ready = plain(['T1.1', 'cloture'], { subjects: ALL_THREE });
  assert.equal(ready.exitCode, 0);
  assert.match(ready.stdout, /PRÊTE/);
});

test('clôture : un lot done AVANT le début des travaux (aucun commit de prompt) reste TERMINÉ', () => {
  const finished = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ['autre commit', 'docs: quelque chose'] });
  assert.equal(finished.exitCode, 3);
  assert.match(finished.stdout, /TERMINÉ/);
});

test('clôture : un lot done avec seulement une partie des prompts committés reste TERMINÉ', () => {
  const partial = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: [FIRST_SUBJECT, SECOND_SUBJECT] });
  assert.equal(partial.exitCode, 3);
  assert.match(partial.stdout, /TERMINÉ/);
});

test('clôture : done + tous les commits, mais mauvaise branche (main ou autre lot) = refusée', () => {
  for (const branch of ['main', 'lot/T9.9-autre', '']) {
    const wrong = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE, branch });
    assert.equal(wrong.exitCode, 3, branch);
    assert.match(wrong.stdout, /TERMINÉ/);
  }
});

test('clôture : un lot done sans découpage ne se clôture pas (aucun commit pour prouver le travail)', () => {
  const none = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done', execution: undefined })], decoupes: {}, subjects: ALL_THREE });
  assert.equal(none.exitCode, 3);
  assert.match(none.stdout, /TERMINÉ/);
});

test('clôture : un lot done reste non relançable pour un prompt, même avec des commits', () => {
  const relance = plain(['T1.1', 'P1'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE });
  assert.equal(relance.exitCode, 3);
  assert.match(relance.stdout, /TERMINÉ/);
});

test('clôture : un lot ready à qui il reste des prompts est « PAS PRÊTE » (3)', () => {
  const missing = plain(['T1.1', 'cloture'], { subjects: [SECOND_SUBJECT, FIRST_SUBJECT] });
  assert.equal(missing.exitCode, 3);
  assert.match(missing.stdout, /PAS PRÊTE — prompts sans commit : P3/);
});

test('clôture : refusée en mode Conductor même quand elle serait autorisée hors Conductor', () => {
  const { json, exitCode } = conductor(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE, branch: 'lot/T1.1-essai' });
  assert.equal(exitCode, 3);
  assert.equal(json.status, 'blocked');
});

test('clôture : hors Conductor, la branche unique conductor/agent-lot/<ID> est acceptée (contrat v1.1 § 2)', () => {
  const branch = 'conductor/agent-lot/T1.1';
  const ready = plain(['T1.1', 'cloture'], { subjects: ALL_THREE, branch });
  assert.equal(ready.exitCode, 0);
  assert.match(ready.stdout, /PRÊTE/);
  const done = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE, branch });
  assert.equal(done.exitCode, 0);
  assert.match(done.stdout, /vient des commits de cette branche/);
  const partial = plain(['T1.1', 'cloture'], { subjects: [FIRST_SUBJECT, SECOND_SUBJECT], branch });
  assert.equal(partial.exitCode, 3);
  assert.match(partial.stdout, /PAS PRÊTE — prompts sans commit : P3/);
  const unfinished = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: [FIRST_SUBJECT], branch });
  assert.equal(unfinished.exitCode, 3);
  assert.match(unfinished.stdout, /TERMINÉ/);
});

test('clôture : la branche Conductor d’un AUTRE lot, ou un autre conductor/*, ne clôture pas', () => {
  for (const branch of ['conductor/agent-lot/T9.9', 'conductor/agent-lot/exec-1', 'conductor/agent/T1.1', 'conductor/agent-lot/t1.1']) {
    const wrong = plain(['T1.1', 'cloture'], { subjects: ALL_THREE, branch });
    assert.equal(wrong.exitCode, 3, branch);
    assert.match(wrong.stdout, /MAUVAISE BRANCHE/);
    const done = plain(['T1.1', 'cloture'], { lots: [lotFixture({ status: 'done' })], subjects: ALL_THREE, branch });
    assert.equal(done.exitCode, 3, branch);
    assert.match(done.stdout, /TERMINÉ/);
  }
});

test('clôture : sur la branche unique, les prompts de TOUTES les étapes comptent, même déclarées sur d’autres branches', () => {
  const split = decoupageText().replace('## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-essai', '## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-suite');
  const branch = 'conductor/agent-lot/T1.1';
  const lot = lotFixture({ status: 'done' });
  const withP3Only = plain(['T1.1', 'cloture'], { lots: [lot], decoupes: { 'T1.1': split }, subjects: [THIRD_SUBJECT], branch });
  assert.equal(withP3Only.exitCode, 3, 'P1 et P2 manquent : la branche unique porte tout le lot');
  const parsed = parseDecoupage(split);
  assert.equal(clotureAfterWork(lot, parsed, branch, new Set(['P1', 'P2', 'P3'])), true);
  assert.equal(clotureAfterWork(lot, parsed, branch, new Set(['P1', 'P2'])), false);
  assert.equal(clotureAfterWork(lot, parsed, 'lot/T1.1-essai', new Set(['P1', 'P2'])), true, 'branche manuelle : seulement ses étapes');
});

test('ordre : sur la branche unique conductor/agent-lot/<ID>, tout prompt précédent est exigé, quelle que soit l’étape', () => {
  const split = decoupageText().replace('## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-essai', '## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-suite');
  const branch = 'conductor/agent-lot/T1.1';
  const noHistory = conductor(['T1.1', 'P3'], { decoupes: { 'T1.1': split }, branch });
  assert.equal(noHistory.json.status, 'blocked');
  assert.ok(noHistory.json.reason.includes('P3 exige d’abord P1, P2'), noHistory.json.reason);
  const ok = conductor(['T1.1', 'P3'], { decoupes: { 'T1.1': split }, branch, subjects: [SECOND_SUBJECT, FIRST_SUBJECT] });
  assert.equal(ok.json.status, 'ready');
  assert.deepEqual(promptsBefore(parseDecoupage(split), lotFixture(), 'P3', true), ['P1', 'P2']);
});

test('clôture : clotureAfterWork ne regarde que les prompts de la branche courante', () => {
  const twoBranches = parseDecoupage(
    decoupageText().replace('## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-essai', '## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-suite'),
  );
  const lot = lotFixture({ status: 'done' });
  assert.equal(clotureAfterWork(lot, twoBranches, 'lot/T1.1-essai', new Set(['P1', 'P2'])), true);
  assert.equal(clotureAfterWork({ ...lot, branch: 'lot/T1.1-suite' }, twoBranches, 'lot/T1.1-suite', new Set(['P3'])), true);
  assert.equal(clotureAfterWork(lot, twoBranches, 'lot/T1.1-essai', new Set(['P1'])), false);
  assert.equal(clotureAfterWork({ ...lot, status: 'ready' }, twoBranches, 'lot/T1.1-essai', new Set(['P1', 'P2'])), false);
  assert.equal(clotureAfterWork(lot, twoBranches, '', new Set(['P1', 'P2'])), false);
  assert.equal(clotureAfterWork(lot, null, 'lot/T1.1-essai', new Set()), false);
});

// ── Ordre et reprise des prompts ──────────────────────────────────────────────────────────────
test('ordre : un prompt exige que tous les précédents soient committés sur la branche', () => {
  const noHistory = plain(['T1.1', 'P2']);
  assert.equal(noHistory.exitCode, 3);
  assert.match(noHistory.stdout, /ORDRE DES PROMPTS — P2 exige d’abord P1/);
  const skipped = plain(['T1.1', 'P3'], { subjects: [FIRST_SUBJECT] });
  assert.equal(skipped.exitCode, 3);
  assert.match(skipped.stdout, /P3 exige d’abord P2/);
  const both = plain(['T1.1', 'P3']);
  assert.match(both.stdout, /P3 exige d’abord P1, P2/);
  assert.equal(plain(['T1.1', 'P2'], { subjects: [FIRST_SUBJECT] }).exitCode, 0);
  assert.equal(plain(['T1.1', 'P3'], { subjects: [SECOND_SUBJECT, FIRST_SUBJECT] }).exitCode, 0);
  assert.equal(plain(['T1.1', 'P1']).exitCode, 0);
});

test('ordre : en mode Conductor, blocked (3) avec la raison et le commit_message du prompt demandé', () => {
  const { json, exitCode, stdout } = conductor(['T1.1', 'P3'], { subjects: [FIRST_SUBJECT], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(exitCode, 3);
  assert.equal(json.status, 'blocked');
  assert.match(json.reason, /ORDRE DES PROMPTS/);
  assert.equal(json.commit_message, THIRD_SUBJECT);
  assert.ok(!stdout.includes('## Fichiers'));
});

test('reprise : un prompt déjà committé est REFUSÉ (3), il ne part pas avec un simple avertissement', () => {
  const again = plain(['T1.1', 'P1'], { subjects: [FIRST_SUBJECT] });
  assert.equal(again.exitCode, 3);
  assert.match(again.stdout, /DÉJÀ FAIT/);
  assert.ok(!again.stdout.includes('## Fichiers'));
  const viaConductor = conductor(['T1.1', 'P1'], { subjects: [FIRST_SUBJECT], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(viaConductor.exitCode, 3);
  assert.equal(viaConductor.json.status, 'blocked');
  assert.match(viaConductor.json.reason, /déjà committé/);
  assert.equal(viaConductor.json.commit_message, FIRST_SUBJECT);
});

test('reprise : --rejouer reprend volontairement un prompt committé, avec avertissement', () => {
  const replay = plain(['T1.1', 'P1', '--rejouer'], { subjects: [FIRST_SUBJECT] });
  assert.equal(replay.exitCode, 0);
  assert.match(replay.stdout, /a déjà un commit \(--rejouer\)/);
  assert.match(replay.stdout, /## Commit\n\[T1\.1\] P1/);
});

test('reprise : --rejouer ne lève pas l’ordre des prompts', () => {
  const stillBlocked = plain(['T1.1', 'P3', '--rejouer'], { subjects: [THIRD_SUBJECT] });
  assert.equal(stillBlocked.exitCode, 3);
  assert.match(stillBlocked.stdout, /ORDRE DES PROMPTS/);
});

test('reprise : --rejouer est interdit en mode Conductor (error, 2)', () => {
  const { json, exitCode } = conductor(['T1.1', 'P1', '--rejouer'], { subjects: [FIRST_SUBJECT], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(exitCode, 2);
  assert.equal(json.status, 'error');
});

test('historique : completedPrompts reconnaît un préfixe, jamais un autre lot ni un identifiant voisin', () => {
  const lot = lotFixture();
  const done = completedPrompts(lot, [
    'contrat: [T1.1] P1 — repris par un développeur',
    '[T1.1] P2 - tiret simple',
    '[T1.11] P3 — autre lot',
    '[T1x1] P4 — pas le même identifiant',
    '[T1.1] P5 sans tiret',
    'Revert "[T1.1] P6" sans séparateur',
    'autre commit',
  ]);
  assert.deepEqual([...done].sort(), ['P1', 'P2']);
});

test('ordre : promptsBefore ignore les prompts d’une autre branche et suit l’ordre du découpage', () => {
  const split = parseDecoupage(decoupageText().replace('## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-essai', '## Étape 2 · Fin\nResponsable : Alice\nBranche : lot/T1.1-suite'));
  const lot = lotFixture();
  assert.deepEqual(promptsBefore(split, lot, 'P1'), []);
  assert.deepEqual(promptsBefore(split, lot, 'P2'), ['P1']);
  assert.deepEqual(promptsBefore(split, lot, 'P3'), []);
  assert.deepEqual(promptsBefore(parseDecoupage(decoupageText()), lot, 'P3'), ['P1', 'P2']);
  assert.deepEqual(promptsBefore(parseDecoupage(decoupageText()), lot, 'P9'), []);
});

// ── Preuve d'action humaine, chemins et dates ─────────────────────────────────────────────────
const EVIDENCE = 'docs/preuve/releve.md';
const ACTION = {
  id: 'T1.1-A1',
  before_prompt: 'P1',
  type: 'authenticated-browser',
  title: 'Relever les chiffres dans un outil connecté',
  owner: 'Alice',
  url: 'https://example.test/outil',
  output: EVIDENCE,
  resume_prompt: 'P1',
  instructions: ['Relever les chiffres', 'Déposer le fichier'],
  forbidden: ['Copier un cookie'],
};

function actionLot(overrides = {}) {
  return lotFixture({
    status: 'waiting',
    not_before: '2026-05-01T09:00:00+02:00',
    execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [ACTION] },
    ...overrides,
  });
}

function conductorWith(args, env) {
  const result = run([...args, '--conductor'], env);
  const last = result.stdout.trimEnd().split('\n').at(-1);
  assert.ok(last.startsWith('CONDUCTOR_RESULT '), `dernière ligne inattendue : ${last}`);
  return { ...result, json: JSON.parse(last.slice('CONDUCTOR_RESULT '.length)) };
}

function writeEvidence(env, content, path = EVIDENCE) {
  const full = join(env.repo, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
  return full;
}

test('action humaine : preuve absente = action_required (4), payload complet, rien de secret', () => {
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
  const { json, exitCode, stdout } = conductorWith(['T1.1', 'P1'], env);
  assert.equal(exitCode, 4);
  assert.equal(json.status, 'action_required');
  assert.equal(json.exit_code, 4);
  assert.match(json.reason, /T1\.1-A1 doit être réalisée avant P1/);
  assert.deepEqual(json.action, {
    id: 'T1.1-A1',
    type: 'authenticated-browser',
    responsible: 'Alice',
    url: 'https://example.test/outil',
    instructions: ['Relever les chiffres', 'Déposer le fichier'],
    forbidden: ['Copier un cookie'],
    evidence_path: EVIDENCE,
    evidence_rule: 'file_exists_nonempty',
    resume_command: '/lot T1.1 P1',
    not_before: '2026-05-01T09:00:00+02:00',
  });
  assert.equal(json.commit_message, FIRST_SUBJECT);
  assert.match(stdout, /## ACTION HUMAINE REQUISE — T1\.1-A1/);
  assert.ok(!/\*\*PRÊT\*\*/.test(stdout), 'le brief ne doit pas dire PRÊT quand une action est requise');
});

test('action humaine : le code 4 vaut aussi hors --conductor ? non — la porte ne s’applique qu’en mode Conductor', () => {
  const env = fixtureEnv({ lots: [actionLot()] });
  assert.equal(run(['T1.1', 'P1'], env).exitCode, 0);
});

test('action humaine : preuve non vide dans le dépôt = ready', () => {
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
  writeEvidence(env, '| Pages indexées | 0 |\n');
  const { json, exitCode } = conductorWith(['T1.1', 'P1'], env);
  assert.equal(exitCode, 0);
  assert.equal(json.status, 'ready');
  assert.equal(json.action, null);
});

test('action humaine : un fichier de preuve VIDE ou fait de blancs ne passe pas', () => {
  for (const content of ['', '   \n\t\n']) {
    const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
    writeEvidence(env, content);
    const { json, exitCode } = conductorWith(['T1.1', 'P1'], env);
    assert.equal(exitCode, 4, JSON.stringify(content));
    assert.equal(json.status, 'action_required');
    assert.match(json.reason, /vide/);
  }
});

test('action humaine : un dossier à la place du fichier ne passe pas', () => {
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
  mkdirSync(join(env.repo, EVIDENCE), { recursive: true });
  assert.equal(conductorWith(['T1.1', 'P1'], env).exitCode, 4);
});

test('action humaine : un lien symbolique qui sort du dépôt ne passe pas, un lien interne oui', (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'lot-outside-'));
  tempDirs.push(outside);
  writeFileSync(join(outside, 'secret.md'), 'contenu hors dépôt');
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1' });
  const full = join(env.repo, EVIDENCE);
  mkdirSync(join(full, '..'), { recursive: true });
  try {
    symlinkSync(join(outside, 'secret.md'), full);
  } catch {
    t.skip('création de lien symbolique non permise sur ce poste');
    return;
  }
  const refused = conductorWith(['T1.1', 'P1'], env);
  assert.equal(refused.exitCode, 4);
  assert.match(refused.json.reason, /sort du dépôt/);
  rmSync(full);
  writeFileSync(join(env.repo, 'reel.md'), 'preuve réelle');
  symlinkSync(join(env.repo, 'reel.md'), full);
  assert.equal(conductorWith(['T1.1', 'P1'], env).exitCode, 0);
});

test('action humaine : l’ordre des portes — dépendance et date avant l’action, branche avant la preuve', () => {
  const early = conductor(['T1.1', 'P1'], { lots: [actionLot({ not_before: '2999-01-01T00:00:00+01:00' })], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(early.json.status, 'too_early');
  const detached = conductor(['T1.1', 'P1'], { lots: [actionLot()], branch: '' });
  assert.equal(detached.json.status, 'blocked');
  assert.equal(detached.json.action, null);
});

test('action humaine : le prompt suivant sans action déclarée n’est pas arrêté', () => {
  const env = fixtureEnv({ lots: [actionLot()], branch: 'conductor/agent-lot/T1.1', subjects: [FIRST_SUBJECT] });
  assert.equal(conductorWith(['T1.1', 'P2'], env).json.status, 'ready');
});

test('action humaine : conductorGate accepte un verdict booléen ou détaillé (tests et appelants historiques)', () => {
  const lot = actionLot();
  const decoupage = parseDecoupage(decoupageText());
  assert.equal(conductorGate(lot, 'P1', decoupage, () => false).actionRequired, true);
  assert.equal(conductorGate(lot, 'P1', decoupage, () => true).ready, true);
  assert.equal(conductorGate(lot, 'P1', decoupage, () => ({ ok: false, reason: 'vide' })).reason.includes('vide'), true);
  assert.equal(conductorGate(lot, 'P1', decoupage, (path) => ({ ok: path === EVIDENCE })).ready, true);
});

test('chemins : validateRelativePath rejette absolu, .., antislash, lecteur, flux NTFS, segments vides', () => {
  assert.equal(validateRelativePath('docs/a/preuve.md'), null);
  assert.equal(validateRelativePath('a.md'), null);
  for (const bad of ['', '  ', '/etc/hosts', '../x', 'a/../../x', 'a/..', 'C:\\x', 'C:/x', '\\\\serveur\\partage', 'a\\b', 'a//b', './a', 'a/./b', 'a/', 'fichier.md:flux', 'a\0b', ' a.md', 'a?.md']) {
    assert.notEqual(validateRelativePath(bad), null, JSON.stringify(bad));
  }
  assert.notEqual(validateRelativePath(undefined), null);
  assert.notEqual(validateRelativePath(42), null);
});

test('chemins : inspectEvidence rejette un chemin invalide avant tout accès disque', () => {
  const repo = mkdtempSync(join(tmpdir(), 'lot-repo-'));
  tempDirs.push(repo);
  for (const bad of ['../hors.md', '/tmp/x', 'a/../../b']) {
    const verdict = inspectEvidence(repo, bad);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /chemin de preuve invalide/);
  }
  assert.equal(inspectEvidence(repo, 'absent.md').reason, 'fichier de preuve absent');
});

test('validation (--check) : un champ output avec .. ou absolu est rejeté', () => {
  for (const output of ['../../../etc/hosts', '/etc/hosts', 'C:\\Windows\\x', 'a\\b.md', 'docs/../../x']) {
    const lot = lotFixture({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [{ ...ACTION, output }] } });
    const errors = validatePlan({ statuses: STATUSES, lots: [lot] }, { decoupeDir: join(fixtureEnv().repo, 'decoupe') });
    assert.ok(errors.some((message) => /preuve de sortie invalide/.test(message)), output);
    const check = run(['--check'], fixtureEnv({ lots: [lot] }));
    assert.equal(check.exitCode, 2, output);
    assert.match(check.stderr, /preuve de sortie invalide/);
  }
});

test('validation : action de type inconnu, prompt hors liste, doublon d’identifiant, url non https, not_before invalide', () => {
  const decoupeDir = join(fixtureEnv().repo, 'decoupe');
  const check = (action) => validatePlan({ statuses: STATUSES, lots: [lotFixture({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [action] } })] }, { decoupeDir });
  assert.ok(check({ ...ACTION, type: 'magie' }).some((message) => /type inconnu/.test(message)));
  assert.ok(check({ ...ACTION, before_prompt: 'P7' }).some((message) => /absent des prompts Conductor/.test(message)));
  assert.ok(check({ ...ACTION, url: 'javascript:alert(1)' }).some((message) => /url non https/.test(message)));
  assert.ok(check({ ...ACTION, not_before: 'bientôt' }).some((message) => /not_before invalide/.test(message)));
  assert.ok(check({ ...ACTION, resume_prompt: 'reprendre' }).some((message) => /prompt de reprise invalide/.test(message)));
  const twice = validatePlan({ statuses: STATUSES, lots: [lotFixture({ execution: { mode: 'conductor-assisted', prompts: ['P1', 'P2', 'P3'], actions: [ACTION, { ...ACTION, before_prompt: 'P2' }] } })] }, { decoupeDir });
  assert.ok(twice.some((message) => /dupliquée/.test(message)));
  assert.deepEqual(check(ACTION), []);
});

test('validation : un cycle de dépendances est détecté', () => {
  const lots = [
    lotFixture({ id: 'T2.1', depends: ['T2.2'], asana_task_id: 'a1', execution: undefined, branch: undefined }),
    lotFixture({ id: 'T2.2', depends: ['T2.1'], asana_task_id: 'a2', execution: undefined, branch: undefined }),
  ];
  const errors = validatePlan({ statuses: STATUSES, lots }, { decoupeDir: join(fixtureEnv().repo, 'decoupe') });
  assert.ok(errors.some((message) => /cycle de dépendances T2\.1 → T2\.2 → T2\.1/.test(message)), errors.join(' | '));
});

test('dates : parseNotBefore exige ISO 8601 avec fuseau et une date réelle', () => {
  assert.equal(parseNotBefore('2026-10-26T08:41:00+01:00').toISOString(), '2026-10-26T07:41:00.000Z');
  assert.equal(parseNotBefore('2026-10-26T07:41Z').toISOString(), '2026-10-26T07:41:00.000Z');
  assert.equal(parseNotBefore('2026-10-26T07:41:00.500Z').getUTCMilliseconds(), 500);
  for (const bad of ['demain', '2026-10-26', '2026-10-26 08:41:00+01:00', '2026-10-26T08:41:00', '2026-02-30T10:00:00+01:00', '2026-13-01T10:00:00Z', '2026-10-26T25:00:00+01:00', '2026-10-26T10:61:00Z', '', null, undefined, 42]) {
    assert.throws(() => parseNotBefore(bad), /not_before invalide/, String(bad));
  }
});

test('dates : un not_before invalide donne une erreur propre (2), jamais une trace ni un crash', () => {
  const lots = [lotFixture({ status: 'waiting', not_before: 'demain' })];
  const check = run(['--check'], fixtureEnv({ lots }));
  assert.equal(check.exitCode, 2);
  assert.match(check.stderr, /not_before invalide « demain »/);
  const plainRun = run(['T1.1', 'P1'], fixtureEnv({ lots }));
  assert.equal(plainRun.exitCode, 2);
  assert.ok(!/at .*lot\.mjs/.test(plainRun.stderr), 'pas de pile d’appels');
  const viaConductor = conductor(['T1.1', 'P1'], { lots });
  assert.equal(viaConductor.exitCode, 2);
  assert.equal(viaConductor.json.status, 'error');
  const gate = dateGate(lots[0], NOW);
  assert.equal(gate.ready, false);
  assert.match(gate.invalid, /not_before invalide/);
});

// ── Statuts, dépendances ──────────────────────────────────────────────────────────────────────
test('statuts : seul ready (ou waiting daté et échu) laisse partir un lot', () => {
  const open = { ready: true, date: null };
  assert.equal(statusGate(lotFixture({ status: 'ready' }), open).ready, true);
  assert.equal(statusGate(lotFixture({ status: 'waiting', not_before: '2026-05-01T09:00:00+02:00' }), open).ready, true);
  assert.equal(statusGate(lotFixture({ status: 'waiting', not_before: '2026-05-01T09:00:00+02:00' }), { ready: false }).ready, false);
  const expected = { done: /TERMINÉ/, partial: /PARTIEL/, decision: /DÉCISION REQUISE/, backlog: /BACKLOG/, waiting: /EN ATTENTE/ };
  for (const [status, pattern] of Object.entries(expected)) {
    const verdict = statusGate(lotFixture({ status }), open);
    assert.equal(verdict.ready, false, status);
    assert.match(verdict.reason, pattern);
  }
  assert.match(statusGate(lotFixture({ status: 'inconnu' }), open).reason, /STATUT BLOQUANT/);
});

test('statuts : chaque statut bloquant donne blocked (3) en mode Conductor, avec la raison', () => {
  for (const status of ['done', 'partial', 'decision', 'backlog', 'waiting']) {
    const { json, exitCode } = conductor(['T1.1', 'P1'], { lots: [lotFixture({ status })], branch: 'conductor/agent-lot/T1.1' });
    assert.equal(exitCode, 3, status);
    assert.equal(json.status, 'blocked', status);
    assert.ok(json.reason.length > 5);
  }
});

test('dépendances : tous les états sont rapportés, seul done lève le verrou, une inconnue bloque', () => {
  const all = lotMap({
    lots: [
      lotFixture({ id: 'T0.1', status: 'done' }),
      lotFixture({ id: 'T0.2', status: 'ready' }),
      lotFixture({ id: 'T0.3', status: 'partial' }),
      lotFixture({ id: 'T1.1', depends: ['T0.1', 'T0.2', 'T0.9'] }),
    ],
  });
  const states = dependencyStates(all.get('T1.1'), all);
  assert.deepEqual(states.map(({ id, status }) => [id, status]), [['T0.1', 'done'], ['T0.2', 'ready'], ['T0.9', 'unknown']]);
  assert.equal(dependenciesReady(states), false);
  assert.equal(dependenciesReady(states.filter(({ id }) => id === 'T0.1')), true);
  assert.equal(dependenciesReady([]), true);
  assert.equal(dependenciesReady([{ id: 'x', status: 'partial' }]), false);
});

test('dépendances : une dépendance ouverte bloque même un lot ready, et la raison la nomme', () => {
  const lots = [lotFixture({ depends: ['T0.1'] }), lotFixture({ id: 'T0.1', status: 'ready', asana_task_id: 'a0', execution: undefined, branch: undefined })];
  const { json, exitCode, stdout } = conductor(['T1.1', 'P1'], { lots, branch: 'conductor/agent-lot/T1.1' });
  assert.equal(exitCode, 3);
  assert.equal(json.status, 'blocked');
  assert.match(json.reason, /T0\.1 \(ready\)/);
  assert.match(stdout, /PAS PRÊT/);
  const closed = [lotFixture({ depends: ['T0.1'] }), lotFixture({ id: 'T0.1', status: 'done', asana_task_id: 'a0', execution: undefined, branch: undefined })];
  assert.equal(conductor(['T1.1', 'P1'], { lots: closed, branch: 'conductor/agent-lot/T1.1' }).json.status, 'ready');
});

// ── Dates : fuseau Europe/Paris, heure d'été et d'hiver ───────────────────────────────────────
test('dates : le verrou 26/10 08:41 Paris (heure d’hiver, +01:00) s’ouvre à 07:41:00Z exactement', () => {
  const lot = lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00+01:00' });
  assert.equal(dateGate(lot, new Date('2026-10-26T07:40:59Z')).ready, false);
  assert.equal(dateGate(lot, new Date('2026-10-26T07:41:00Z')).ready, true);
  assert.equal(statusGate(lot, dateGate(lot, new Date('2026-10-26T07:41:00Z'))).ready, true);
  assert.equal(statusGate(lot, dateGate(lot, new Date('2026-10-26T07:40:59Z'))).ready, false);
});

test('dates : le même 08:41 Paris en heure d’été (+02:00) s’ouvre à 06:41:00Z', () => {
  const lot = lotFixture({ status: 'waiting', not_before: '2026-07-01T08:41:00+02:00' });
  assert.equal(dateGate(lot, new Date('2026-07-01T06:40:59Z')).ready, false);
  assert.equal(dateGate(lot, new Date('2026-07-01T06:41:00Z')).ready, true);
});

test('dates : changement d’heure — 29/03 (été) et 25/10 (hiver) se lisent par leur décalage explicite', () => {
  const spring = parseNotBefore('2026-03-29T03:00:00+02:00');
  assert.equal(spring.toISOString(), '2026-03-29T01:00:00.000Z');
  assert.equal(parseNotBefore('2026-03-29T01:59:00+01:00').getTime() + 60_000, spring.getTime());
  const autumnFirst = parseNotBefore('2026-10-25T02:30:00+02:00');
  const autumnSecond = parseNotBefore('2026-10-25T02:30:00+01:00');
  assert.equal(autumnSecond.getTime() - autumnFirst.getTime(), 3_600_000);
});

test('dates : le décalage du not_before décale le verrou (un fuseau d’écart = une heure)', () => {
  const now = new Date('2026-10-26T07:41:00Z');
  const paris = lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00+01:00' });
  const sameInstant = lotFixture({ status: 'waiting', not_before: '2026-10-26T07:41:00Z' });
  const oneHourLater = lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00Z' });
  const summerOffset = lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00+02:00' });
  assert.equal(dateGate(paris, now).ready, true);
  assert.equal(dateGate(sameInstant, now).ready, true);
  assert.equal(dateGate(oneHourLater, now).ready, false);
  assert.equal(dateGate(oneHourLater, new Date('2026-10-26T08:41:00Z')).ready, true);
  // +02:00 au lieu de +01:00 : le même « 08:41 » s'ouvre une heure plus tôt (06:41Z).
  assert.equal(dateGate(summerOffset, new Date('2026-10-26T06:40:59Z')).ready, false);
  assert.equal(dateGate(summerOffset, new Date('2026-10-26T06:41:00Z')).ready, true);
  assert.equal(dateGate(summerOffset, now).ready, true);
  assert.equal(dateGate(lotFixture(), now).ready, true);
  assert.equal(dateGate(lotFixture(), now).date, null);
});

test('dates : TROP TÔT est affiché à l’heure de Paris, en été comme en hiver', () => {
  assert.match(formatDate(new Date('2026-10-26T07:41:00Z')), /08:41/);
  assert.match(formatDate(new Date('2026-07-01T06:41:00Z')), /08:41/);
  assert.match(formatDate(new Date('2026-10-26T07:41:00Z')), /lundi 26 octobre 2026/);
  const early = conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00+01:00' })], now: new Date('2026-10-26T07:40:59Z') });
  assert.equal(early.json.status, 'too_early');
  assert.match(early.json.reason, /lundi 26 octobre 2026 à 08:41/);
  const open = conductor(['T1.1', 'P1'], { lots: [lotFixture({ status: 'waiting', not_before: '2026-10-26T08:41:00+01:00' })], now: new Date('2026-10-26T07:41:00Z'), branch: 'conductor/agent-lot/T1.1' });
  assert.equal(open.json.status, 'ready');
});

// ── parseDecoupage ────────────────────────────────────────────────────────────────────────────
test('découpage : la structure est la même en LF et en CRLF', () => {
  const lf = parseDecoupage(decoupageText());
  const crlf = parseDecoupage(decoupageText({ eol: '\r\n' }));
  assert.deepEqual(crlf, lf);
  assert.deepEqual(lf.steps.flatMap((step) => step.prompts.map((prompt) => prompt.id)), ['P1', 'P2', 'P3']);
  assert.equal(lf.steps[0].branch, 'lot/T1.1-essai');
  assert.equal(lf.steps[0].responsible, 'Alice');
  assert.deepEqual(lf.steps[0].prompts[0].files, ['a.txt', 'b.txt']);
  assert.deepEqual(lf.steps[0].prompts[0].actions, ['geste 1']);
  assert.equal(lf.steps[0].prompts[0].duration, 20);
  assert.equal(lf.steps[0].prompts[0].test, '`node -v`');
  assert.equal(lf.etat_au, '2026-06-01');
});

test('découpage : accents, ligatures et saisie décomposée (NFD) donnent le même résultat', () => {
  const text = decoupageText().replace('Premier prompt', 'Été à l’œuvre — déjà prêt');
  const composed = parseDecoupage(text.normalize('NFC'));
  const decomposed = parseDecoupage(text.normalize('NFD'));
  assert.equal(composed.steps[0].prompts[0].title, 'Été à l’œuvre — déjà prêt');
  assert.deepEqual(decomposed, composed);
  assert.equal(commitMessage(lotFixture(), composed.steps[0], composed.steps[0].prompts[0]), '[T1.1] P1 — Été à l’œuvre — déjà prêt');
});

test('découpage : « Branche Conductor » est lue à part de « Branche » et doit valoir conductor/agent-lot/<ID>', () => {
  const withLine = decoupageText().replaceAll('Branche : lot/T1.1-essai', 'Branche : lot/T1.1-essai\nBranche Conductor : conductor/agent-lot/T1.1');
  const parsed = parseDecoupage(withLine);
  assert.deepEqual(parsed.steps.map((step) => [step.branch, step.conductorBranch]), [
    ['lot/T1.1-essai', 'conductor/agent-lot/T1.1'],
    ['lot/T1.1-essai', 'conductor/agent-lot/T1.1'],
  ]);
  assert.equal(parseDecoupage(decoupageText()).steps[0].conductorBranch, null);
  const decoupeDir = join(fixtureEnv({ decoupes: { 'T1.1': withLine } }).repo, 'decoupe');
  assert.deepEqual(validatePlan({ statuses: STATUSES, lots: [lotFixture()] }, { decoupeDir }), []);
  const wrong = withLine.replace('conductor/agent-lot/T1.1', 'conductor/agent-lot/T9.9');
  const wrongDir = join(fixtureEnv({ decoupes: { 'T1.1': wrong } }).repo, 'decoupe');
  const errors = validatePlan({ statuses: STATUSES, lots: [lotFixture()] }, { decoupeDir: wrongDir });
  assert.ok(errors.some((message) => message.includes('« Branche Conductor » de l\'étape 1 = conductor/agent-lot/T9.9')), errors.join(' | '));
});

test('plan réel : S2.1 et S2.2 annoncent la branche Conductor unique et gardent la branche manuelle', () => {
  const plan = loadPlan();
  const all = lotMap(plan);
  for (const id of ['S2.1', 'S2.2']) {
    const parsed = parseDecoupage(readFileSync(new URL(`../docs/pilotage/decoupe/${id}.md`, import.meta.url), 'utf8'));
    assert.ok(parsed.steps.length > 0);
    for (const step of parsed.steps) {
      assert.equal(step.conductorBranch, conductorBranch(id), `${id} étape ${step.number}`);
      assert.equal(step.branch, all.get(id).branch, `${id} étape ${step.number}`);
      assert.ok(step.branch.startsWith(`lot/${id}-`));
    }
  }
});

test('découpage : en-tête manquant, ligne d’en-tête invalide et lot sans étape', () => {
  assert.throws(() => parseDecoupage('# sans en-tête\n'), /en-tête YAML manquant/);
  assert.throws(() => parseDecoupage('---\nlot T1.1\n---\n'), /ligne d'en-tête invalide/);
  assert.deepEqual(parseDecoupage('---\nlot: T1.1\n---\n\n# vide\n').steps, []);
});

test('découpage : un prompt absent est inconnu (2) ; un lot sans prompt connu ne part pas', () => {
  assert.equal(plain(['T1.1', 'P4']).exitCode, 2);
  assert.match(plain(['T1.1', 'P4']).stderr, /Prompt inconnu : T1\.1 P4/);
  assert.equal(conductor(['T1.1', 'P4'], { branch: 'conductor/agent-lot/T1.1' }).json.status, 'error');
  const sansPrompt = decoupageText().replace(/### P3[\s\S]*$/, '');
  assert.deepEqual(parseDecoupage(sansPrompt).steps.at(-1).prompts, []);
  assert.equal(plain(['T1.1', 'P3'], { decoupes: { 'T1.1': sansPrompt } }).exitCode, 2);
});

test('découpage : la validation signale durée hors bornes, champs vides, prompt dupliqué, en-tête de lot faux', () => {
  const check = (text) => validatePlan({ statuses: STATUSES, lots: [lotFixture({ execution: undefined })] }, { decoupeDir: join(fixtureEnv({ decoupes: { 'T1.1': text } }).repo, 'decoupe') });
  assert.deepEqual(check(decoupageText()), []);
  assert.ok(check(decoupageText().replace('Durée : 20 min', 'Durée : 45 min')).some((message) => /durée hors 15–30 min/.test(message)));
  assert.ok(check(decoupageText().replace('Fichiers : a.txt · b.txt', 'Fichiers : ')).some((message) => /files vide/.test(message)));
  assert.ok(check(decoupageText().replace('Hors périmètre : le reste', 'Hors périmètre : ')).some((message) => /out vide/.test(message)));
  assert.ok(check(decoupageText().replace('### P2', '### P1')).some((message) => /prompt dupliqué P1/.test(message)));
  assert.ok(check(decoupageText({ lotId: 'T9.9' })).some((message) => /en-tête du découpage = T9\.9/.test(message)));
  assert.ok(check(decoupageText().replace('Responsable : Alice', 'Branche-seule : x')).some((message) => /responsable manquant/.test(message)));
});

// ── Validation du plan ────────────────────────────────────────────────────────────────────────
test('plan : doublons, statut inconnu, done_when vide, dépendance inconnue ou circulaire sur soi-même', () => {
  const decoupeDir = join(fixtureEnv().repo, 'decoupe');
  const errors = validatePlan(
    {
      statuses: STATUSES,
      lots: [
        lotFixture({ id: 'T3.1', execution: undefined, branch: undefined, asana_task_id: 'x' }),
        lotFixture({ id: 'T3.1', execution: undefined, branch: undefined, asana_task_id: 'x', status: 'zzz', done_when: [], depends: ['T3.1', 'T3.9'] }),
        lotFixture({ id: 'mauvais', execution: undefined, branch: undefined, asana_task_id: 'y' }),
      ],
    },
    { decoupeDir },
  );
  for (const pattern of [/T3\.1: doublon/, /statut zzz inconnu/, /done_when vide/, /dépendance inconnue T3\.9/, /dépend de lui-même/, /tâche Asana dupliquée/, /mauvais: identifiant invalide/]) {
    assert.ok(errors.some((message) => pattern.test(message)), `${pattern} dans ${errors.join(' | ')}`);
  }
});

test('plan : un lot Conductor exige branche, prompts valides et découpage', () => {
  const decoupeDir = join(fixtureEnv({ decoupes: {} }).repo, 'decoupe');
  const errors = validatePlan({ statuses: STATUSES, lots: [lotFixture({ branch: undefined, execution: { mode: 'conductor-agent-lot', prompts: ['P1', 'Px'] } })] }, { decoupeDir });
  for (const pattern of [/branche requise pour Conductor/, /prompt Conductor invalide Px/, /découpage requis pour Conductor/]) {
    assert.ok(errors.some((message) => pattern.test(message)), String(pattern));
  }
  const missingPrompt = validatePlan({ statuses: STATUSES, lots: [lotFixture({ execution: { mode: 'conductor-agent-lot', prompts: ['P1', 'P8'] } })] }, { decoupeDir: join(fixtureEnv().repo, 'decoupe') });
  assert.ok(missingPrompt.some((message) => /prompt Conductor absent du découpage P8/.test(message)));
});

test('plan : un lot Conductor non listé dans execution.prompts est refusé (blocked)', () => {
  const lots = [lotFixture({ execution: { mode: 'conductor-agent-lot', prompts: ['P1'] } })];
  const { json } = conductor(['T1.1', 'P2'], { lots, branch: 'conductor/agent-lot/T1.1', subjects: [FIRST_SUBJECT] });
  assert.equal(json.status, 'blocked');
  assert.match(json.reason, /n’est pas autorisé dans Conductor/);
});

test('plan réel : valide, et chaque découpage du dépôt se lit sans erreur', () => {
  const plan = loadPlan();
  assert.deepEqual(validatePlan(plan), []);
  assert.ok(plan.lots.length > 0);
  for (const lot of plan.lots) {
    for (const action of lot.execution?.actions ?? []) {
      assert.equal(validateRelativePath(action.output), null, `${lot.id} ${action.id}`);
      assert.ok(HUMAN_ACTION_TYPES.includes(action.type), `${lot.id} ${action.id}`);
    }
  }
});

// ── Commandes complètes sur un vrai dépôt git jetable (git réel, processus réel, cwd ≠ racine) ──
function gitIn(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepo({ lots = [lotFixture()], branch = 'conductor/agent-lot/T1.1', origin = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lot-repo-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'pilotage', 'decoupe'), { recursive: true });
  copyFileSync(fileURLToPath(new URL('./lot.mjs', import.meta.url)), join(dir, 'scripts', 'lot.mjs'));
  writeFileSync(join(dir, 'docs', 'pilotage', 'plan.json'), JSON.stringify({ version: 2, statuses: STATUSES, lots }));
  writeFileSync(join(dir, 'docs', 'pilotage', 'decoupe', 'T1.1.md'), decoupageText());
  gitIn(dir, 'init', '-q');
  gitIn(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  gitIn(dir, 'add', 'scripts/lot.mjs', 'docs/pilotage/plan.json', 'docs/pilotage/decoupe/T1.1.md');
  gitIn(dir, 'commit', '-q', '-m', 'init');
  // `origin/main` = l'état de la base : les prompts « faits » sont les commits de HEAD qui n'y sont pas.
  if (origin) gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  if (branch === 'detached') gitIn(dir, 'checkout', '-q', '--detach');
  else if (branch !== 'main') gitIn(dir, 'checkout', '-q', '-b', branch);
  return dir;
}

function cli(dir, args) {
  // cwd volontairement différent de la racine du dépôt jetable ; git ne remonte pas au-dessus du dossier jetable.
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir) };
  const result = spawnSync(process.execPath, [join(dir, 'scripts', 'lot.mjs'), ...args], { cwd: tmpdir(), encoding: 'utf8', env });
  const last = result.stdout.trimEnd().split('\n').at(-1);
  return { ...result, json: last.startsWith('CONDUCTOR_RESULT ') ? JSON.parse(last.slice(17)) : null };
}

test('CLI réelle : branche conductor/*, prompt prêt, puis P1 refusé une fois committé et P2 autorisé', () => {
  const dir = makeRepo();
  const first = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.json.status, 'ready');
  assert.equal(first.json.branch.current, 'conductor/agent-lot/T1.1');
  writeFileSync(join(dir, 'a.txt'), 'travail');
  gitIn(dir, 'add', 'a.txt');
  gitIn(dir, 'commit', '-q', '-m', first.json.commit_message);
  const again = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(again.status, 3);
  assert.match(again.json.reason, /déjà committé/);
  assert.equal(cli(dir, ['T1.1', 'P3', '--conductor']).status, 3);
  assert.equal(cli(dir, ['T1.1', 'P2', '--conductor']).json.status, 'ready');
  assert.equal(cli(dir, ['T1.1', 'P2']).status, 3, 'hors Conductor, la branche du lot reste exigée');
});

test('CLI réelle : HEAD détaché et main sont refusés, avec la ligne finale', () => {
  const detached = cli(makeRepo({ branch: 'detached' }), ['T1.1', 'P1', '--conductor']);
  assert.equal(detached.status, 3);
  assert.equal(detached.json.status, 'blocked');
  assert.equal(detached.json.branch.current, null);
  assert.match(detached.json.reason, /HEAD détaché/);
  const onMain = cli(makeRepo({ branch: 'main' }), ['T1.1', 'P1', '--conductor']);
  assert.equal(onMain.status, 3);
  assert.equal(onMain.json.branch.current, 'main');
});

test('CLI réelle : clôture sur la branche du lot après les trois prompts, lot passé à done par le dernier', () => {
  const dir = makeRepo({ branch: 'lot/T1.1-essai' });
  for (const [index, subject] of [FIRST_SUBJECT, SECOND_SUBJECT, THIRD_SUBJECT].entries()) {
    writeFileSync(join(dir, `f${index}.txt`), String(index));
    gitIn(dir, 'add', `f${index}.txt`);
    gitIn(dir, 'commit', '-q', '-m', subject);
  }
  const planFile = join(dir, 'docs', 'pilotage', 'plan.json');
  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  plan.lots[0].status = 'done';
  writeFileSync(planFile, JSON.stringify(plan));
  gitIn(dir, 'add', 'docs/pilotage/plan.json');
  gitIn(dir, 'commit', '-q', '-m', 'unrelated: plan');
  const closing = cli(dir, ['T1.1', 'cloture']);
  assert.equal(closing.status, 0, closing.stdout);
  assert.match(closing.stdout, /PRÊTE/);
  assert.equal(cli(dir, ['T1.1', 'cloture', '--conductor']).status, 3);
});

test('CLI réelle : un lot done sans aucun commit de prompt reste TERMINÉ à la clôture', () => {
  const dir = makeRepo({ lots: [lotFixture({ status: 'done' })], branch: 'lot/T1.1-essai' });
  const finished = cli(dir, ['T1.1', 'cloture']);
  assert.equal(finished.status, 3);
  assert.match(finished.stdout, /TERMINÉ/);
});

test('CLI réelle : sans git (pas un dépôt) = erreur 2 et ligne finale, pas « aucun commit »', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lot-nogit-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'pilotage', 'decoupe'), { recursive: true });
  copyFileSync(fileURLToPath(new URL('./lot.mjs', import.meta.url)), join(dir, 'scripts', 'lot.mjs'));
  writeFileSync(join(dir, 'docs', 'pilotage', 'plan.json'), JSON.stringify({ version: 2, statuses: STATUSES, lots: [lotFixture()] }));
  writeFileSync(join(dir, 'docs', 'pilotage', 'decoupe', 'T1.1.md'), decoupageText());
  const result = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(result.status, 2);
  assert.equal(result.json.status, 'error');
  assert.match(result.json.reason, /git indisponible/);
});

// ── Historique : origin/main..HEAD, sans fenêtre, sans « Revert » (contrat v1.1 § 3) ────────────
function commitFile(dir, name, subject) {
  writeFileSync(join(dir, name), subject);
  gitIn(dir, 'add', name);
  gitIn(dir, 'commit', '-q', '-m', subject);
}

/** Des commits sans fichier, en un seul processus (git fast-import) : de quoi dépasser 2000 commits en une seconde. */
function fastImport(dir, ref, from, subjects) {
  const lines = [];
  subjects.forEach((subject, index) => {
    lines.push(`commit ${ref}`, `committer Test <test@example.test> ${1_700_000_000 + index} +0000`, `data ${Buffer.byteLength(subject)}`, subject);
    if (index === 0) lines.push(`from ${from}`);
    lines.push('');
  });
  execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: `${lines.join('\n')}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
}

test('historique : « Revert … » ne compte jamais comme prompt fait (unitaire et run)', () => {
  const lot = lotFixture();
  assert.deepEqual([...completedPrompts(lot, ['Revert "[T1.1] P1 — Premier prompt"'])], []);
  assert.deepEqual([...completedPrompts(lot, ['Revert [T1.1] P2 — x', FIRST_SUBJECT])], ['P1']);
  assert.deepEqual([...completedPrompts(lot, ['revert: [T1.1] P3 — minuscule, autre convention'])], ['P3'], 'seul le « Revert » de git est exclu');
  const reverted = ['Revert "[T1.1] P1 — Premier prompt"'];
  assert.equal(plain(['T1.1', 'P1'], { subjects: reverted }).exitCode, 0, 'P1 reste à faire');
  const second = plain(['T1.1', 'P2'], { subjects: reverted });
  assert.equal(second.exitCode, 3);
  assert.match(second.stdout, /ORDRE DES PROMPTS — P2 exige d’abord P1/);
});

test('historique (git réel) : seuls les commits absents de origin/main comptent, et un Revert ne compte pas', () => {
  const dir = makeRepo({ branch: 'main' });
  commitFile(dir, 'a.txt', FIRST_SUBJECT);
  gitIn(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); // P1 est déjà dans la base
  gitIn(dir, 'checkout', '-q', '-b', 'conductor/agent-lot/T1.1');
  assert.equal(cli(dir, ['T1.1', 'P1', '--conductor']).json.status, 'ready', 'P1 est dans origin/main : pas un prompt de cette branche');
  assert.match(cli(dir, ['T1.1', 'P2', '--conductor']).json.reason, /ORDRE DES PROMPTS — P2 exige d’abord P1/);
  commitFile(dir, 'b.txt', FIRST_SUBJECT);
  assert.match(cli(dir, ['T1.1', 'P1', '--conductor']).json.reason, /déjà committé/);
  assert.equal(cli(dir, ['T1.1', 'P2', '--conductor']).json.status, 'ready');
  commitFile(dir, 'c.txt', `Revert "${FIRST_SUBJECT}"`);
  assert.match(cli(dir, ['T1.1', 'P1', '--conductor']).json.reason, /déjà committé/, 'le commit d’origine compte toujours (limite connue : voir CONDUCTOR.md)');
  const onlyRevert = makeRepo();
  commitFile(onlyRevert, 'a.txt', `Revert "${FIRST_SUBJECT}"`);
  assert.equal(cli(onlyRevert, ['T1.1', 'P1', '--conductor']).json.status, 'ready');
});

test('historique (git réel) : aucune fenêtre — un prompt committé il y a plus de 2000 commits est toujours vu', () => {
  const dir = makeRepo({ branch: 'main' });
  const base = gitIn(dir, 'rev-parse', 'HEAD');
  const filler = Array.from({ length: 2100 }, (_, index) => `chore: remplissage ${index}`);
  fastImport(dir, 'refs/heads/conductor/agent-lot/T1.1', base, [FIRST_SUBJECT, ...filler]);
  gitIn(dir, 'checkout', '-q', 'conductor/agent-lot/T1.1');
  assert.equal(Number(gitIn(dir, 'rev-list', '--count', 'origin/main..HEAD')), 2101);
  const again = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(again.status, 3, again.stdout);
  assert.match(again.json.reason, /déjà committé/);
  assert.equal(cli(dir, ['T1.1', 'P2', '--conductor']).json.status, 'ready', 'P1 est vu : P2 est autorisé');
});

test('historique (git réel) : sans origin/main, erreur (2) qui dit quoi faire — jamais un historique deviné', () => {
  const dir = makeRepo({ origin: false });
  const result = cli(dir, ['T1.1', 'P1', '--conductor']);
  assert.equal(result.status, 2);
  assert.equal(result.json.status, 'error');
  assert.ok(result.json.reason.includes('origin/main..HEAD'), result.json.reason);
  assert.ok(result.json.reason.includes('git fetch origin'), result.json.reason);
});

test('CLI réelle : la clôture se lance sur conductor/agent-lot/<ID> une fois les trois prompts committés', () => {
  const dir = makeRepo({ lots: [lotFixture({ status: 'done' })], branch: 'conductor/agent-lot/T1.1' });
  assert.equal(cli(dir, ['T1.1', 'cloture']).status, 3, 'rien de committé : TERMINÉ');
  for (const [index, subject] of [FIRST_SUBJECT, SECOND_SUBJECT, THIRD_SUBJECT].entries()) commitFile(dir, `f${index}.txt`, subject);
  const closing = cli(dir, ['T1.1', 'cloture']);
  assert.equal(closing.status, 0, closing.stdout);
  assert.match(closing.stdout, /PRÊTE/);
  assert.equal(cli(dir, ['T1.1', 'cloture', '--conductor']).status, 3, 'jamais depuis Conductor');
});

