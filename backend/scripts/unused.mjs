/**
 * Which of the schema is dead weight.
 *
 * Reads every model and scalar field out of `schema.prisma`, then looks for
 * each one across the backend source, the SQL migrations and the two web
 * clients — and reports what is defined but never touched.
 *
 * The care is all in what counts as a *use*:
 *
 *  - `CREATE TABLE` and `CREATE INDEX` are stripped out of the SQL first. They
 *    name every table and column that exists, so leaving them in makes the
 *    whole schema look used and the report comes back empty.
 *  - Triggers and functions are kept. A column written only by a trigger —
 *    `last_message_at`, `available_count` — is in use, and dropping it because
 *    no TypeScript mentions it would break the database.
 *  - Seed `INSERT`s are counted separately. A column that only ever appears in
 *    seed data has rows in it but nothing that reads them, which is a different
 *    problem from a column that does not exist anywhere.
 *  - Relation fields are skipped. They are not columns, and Prisma names them
 *    after the *other* table, so counting them would hide real findings.
 *
 * It still cannot see a column reached only through `SELECT *`, so treat the
 * output as a list to check rather than a list to delete.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const repo = path.join(root, '..');

function collect(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/**
 * Removes the statements that merely declare the schema, leaving the ones that
 * do something with it.
 */
function usageOnly(sql) {
  return sql
    .replace(/CREATE\s+TABLE[\s\S]*?\n\s*\);/gi, '')
    .replace(/CREATE\s+(UNIQUE\s+)?INDEX[^;]*;/gi, '')
    .replace(/ALTER\s+TABLE[^;]*ADD\s+CONSTRAINT[^;]*;/gi, '')
    .replace(/COMMENT\s+ON[^;]*;/gi, '');
}

const backend = [
  ...collect(path.join(root, 'src'), ['.ts']),
  ...collect(path.join(root, 'scripts'), ['.mjs']),
];
const clients = [
  ...collect(path.join(repo, 'webadmin', 'src'), ['.ts', '.tsx']),
  ...collect(path.join(repo, 'webapp', 'src'), ['.ts', '.tsx']),
];
const sqlFiles = collect(path.join(root, 'prisma', 'migrations-v2'), ['.sql']);

const corpus = [
  ...backend.map((f) => ({ kind: 'code', text: fs.readFileSync(f, 'utf8') })),
  ...clients.map((f) => ({ kind: 'client', text: fs.readFileSync(f, 'utf8') })),
];

// Trigger and function bodies versus seed inserts, kept apart.
for (const f of sqlFiles) {
  const body = usageOnly(fs.readFileSync(f, 'utf8'));
  const inserts = body.match(/INSERT\s+INTO[\s\S]*?;/gi)?.join('\n') ?? '';
  const rest = body.replace(/INSERT\s+INTO[\s\S]*?;/gi, '');
  corpus.push({ kind: 'seed', text: inserts });
  corpus.push({ kind: 'trigger', text: rest });
}

const seenIn = (name) => {
  const re = new RegExp(`\\b${name}\\b`);
  const kinds = new Set();
  for (const c of corpus) if (re.test(c.text)) kinds.add(c.kind);
  return kinds;
};

// ── the schema ──────────────────────────────────────────────────────────────
const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
const models = [];
for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, name, body] = m;
  const fields = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('@@')) continue;
    const [field, type] = t.split(/\s+/);
    if (!field || !type) continue;
    const bare = type.replace(/[[\]?]/g, '');
    if (/^[a-z_]+$/.test(bare) && schema.includes(`model ${bare} {`)) continue; // relation
    // A primary key is structural. Code that reaches a row through a relation
    // never names it, which makes every one of them look dead and buries the
    // findings that matter.
    if (t.includes('@id')) continue;
    fields.push(field);
  }
  models.push({ name, fields });
}

const ours = models.filter((m) => m.name !== 'spatial_ref_sys');

// ── report ──────────────────────────────────────────────────────────────────
const dead = [];         // nothing anywhere
const seedOnly = [];     // rows exist, nothing reads them
const withDeadCols = [];

for (const { name, fields } of ours) {
  const where = seenIn(name);
  const live = where.has('code') || where.has('client') || where.has('trigger');

  if (!live) {
    (where.has('seed') ? seedOnly : dead).push({ name, columns: fields.length });
    continue;
  }

  const deadCols = fields.filter((f) => {
    if (ours.some((m) => m.name === f)) return false; // shares a table's name
    const w = seenIn(f);
    return !w.has('code') && !w.has('client') && !w.has('trigger');
  });
  if (deadCols.length) withDeadCols.push({ name, deadCols, total: fields.length });
}

const pad = (s, n) => String(s).padEnd(n);
const columns = ours.reduce((n, m) => n + m.fields.length, 0);

console.log(`\n  ${ours.length} tables · ${columns} columns\n`);

console.log(`\n══ Tables nothing touches — ${dead.length}\n`);
for (const t of dead.sort((a, b) => b.columns - a.columns)) {
  console.log(`  ${pad(t.name, 26)} ${t.columns} columns`);
}

if (seedOnly.length) {
  console.log(`\n\n══ Tables with seeded rows but no code — ${seedOnly.length}\n`);
  for (const t of seedOnly) console.log(`  ${pad(t.name, 26)} ${t.columns} columns`);
}

const n = withDeadCols.reduce((a, t) => a + t.deadCols.length, 0);
console.log(`\n\n══ Unused columns in tables that are used — ${n}\n`);
for (const t of withDeadCols.sort((a, b) => b.deadCols.length - a.deadCols.length)) {
  console.log(`  ${pad(t.name, 26)} ${t.deadCols.length}/${t.total}   ${t.deadCols.join(', ')}`);
}
console.log('');
