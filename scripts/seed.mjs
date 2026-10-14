import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { categories, products } from './fixtures.mjs';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
const now = Date.now(),
  DAY = 86400000;
const q = (v) =>
  v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const insert = (table, columns, values) =>
  `INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${values.map(q).join(',')});`;
const sql = [];
for (const [id, name] of categories) sql.push(insert('categories', 'id,name', [id, name]));
for (const [
  slug,
  name,
  brand,
  model,
  variant,
  category,
  current,
  baseline,
  art,
  status,
] of products) {
  const id = `demo-${slug}`,
    identity = [id, brand, model, variant, 'new', 'USD'].join('|'),
    available = status !== 'expired';
  sql.push(
    insert('products', 'id,name,brand,model,variant,category_id,specs', [
      id,
      name,
      brand,
      model,
      variant,
      category,
      JSON.stringify({
        Model: model,
        Variant: variant,
        Condition: 'New',
        Source: 'Simulated demonstration fixture',
      }),
    ]),
  );
  sql.push(
    insert(
      'product_listings',
      'id,product_id,external_id,provider_id,retailer_id,condition,currency,price_cents,shipping_cents,original_url,image_url,image_permitted,available,demo,checked_at,next_check_at,seller_confidence,identity_key',
      [
        id,
        id,
        id,
        'mock',
        'demo',
        'new',
        'USD',
        current,
        0,
        `https://example.com/demo/${slug}`,
        `/art/${art}.svg`,
        1,
        +available,
        1,
        now,
        now + 1800000,
        1,
        identity,
      ],
    ),
  );
  // Reseeding only refreshes demonstration fixtures. History is idempotent on listing+date.
  sql.push(
    `UPDATE product_listings SET checked_at=${now},next_check_at=${now + 1800000},available=${+available} WHERE id=${q(id)} AND demo=1;`,
  );
  for (let d = status === 'collect' ? 3 : 35; d >= 1; d--) {
    const at = Math.floor((now - d * DAY) / DAY) * DAY + 12 * 3600000;
    sql.push(
      insert(
        'price_observations',
        'listing_id,price_cents,shipping_cents,currency,observed_at,source,identity_key',
        [id, baseline, 0, 'USD', at, 'mock', identity],
      ),
    );
  }
  sql.push(
    insert(
      'price_observations',
      'listing_id,price_cents,shipping_cents,currency,observed_at,source,identity_key',
      [id, current, 0, 'USD', now, 'mock', identity],
    ),
  );
  const discount = ((baseline - current) / baseline) * 100;
  const score = Math.min(
    100,
    Math.round(
      30 * Math.min(1, discount / 30) +
        15 * Math.min(1, (baseline - current) / 5000) +
        25 +
        15 +
        10 +
        5,
    ),
  );
  if (status !== 'collect') {
    sql.push(
      insert(
        'deals',
        'id,listing_id,slug,baseline_cents,current_cents,savings_cents,discount,score,status,featured,detected_at,published_at,fingerprint',
        [
          id,
          id,
          slug,
          baseline,
          current,
          baseline - current,
          Math.round(discount * 10) / 10,
          score,
          status,
          +(slug === 'aster-g7' || slug === 'atlas-2tb'),
          now - 1800000,
          status === 'active' ? now - 1800000 : null,
          `${id}:seed`,
        ],
      ),
    );
    sql.push(`UPDATE deals SET detected_at=${now - 1800000} WHERE id=${q(id)};`);
    sql.push(
      insert('deal_scores', 'deal_id,components,reasons,scored_at', [
        id,
        JSON.stringify({
          discount: Math.min(1, discount / 30),
          savings: Math.min(1, (baseline - current) / 5000),
          history: 1,
          freshness: 1,
          availability: +available,
          seller: 1,
        }),
        '[]',
        now,
      ]),
    );
  }
}
sql.push(
  insert('scheduled_job_runs', 'id,kind,started_at,finished_at,checked,status', [
    'demo-seed',
    'demo import',
    now,
    now,
    products.length,
    'success',
  ]),
);
mkdirSync('work', { recursive: true });
writeFileSync('work/demo.sql', sql.join('\n'));
const result = spawnSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'dealradar', '--local', '--file', 'work/demo.sql'],
  { encoding: 'utf8' },
);
if (result.status) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status);
}
if (!existsSync('.dev.vars'))
  writeFileSync('.dev.vars', `LOCAL_ADMIN_TOKEN=${randomBytes(32).toString('hex')}\n`, {
    mode: 0o600,
  });
console.log(
  'Seeded labeled demo data. Local admin token is in ignored .dev.vars; keep it private.',
);
