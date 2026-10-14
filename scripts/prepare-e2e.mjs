import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { products } from './fixtures.mjs';
const result = spawnSync('node', ['scripts/seed.mjs'], { stdio: 'inherit' });
if (result.status) process.exit(result.status);
const demoDrafts =
  'SELECT dr.id FROM social_post_drafts dr JOIN deals d ON d.id=dr.deal_id JOIN product_listings l ON l.id=d.listing_id WHERE l.demo=1';
const sql = [
  `DELETE FROM social_publishing_jobs WHERE draft_id IN (${demoDrafts});`,
  `DELETE FROM social_post_drafts WHERE id IN (${demoDrafts});`,
];
for (const [slug, , , , , , , , , status] of products)
  if (status !== 'collect')
    sql.push(
      `UPDATE deals SET status='${status}',published_at=${status === 'active' ? Date.now() - 1800000 : 'NULL'} WHERE id='demo-${slug}' AND listing_id IN (SELECT id FROM product_listings WHERE demo=1);`,
    );
writeFileSync('work/e2e-reset.sql', sql.join('\n'));
const reset = spawnSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'dealradar', '--local', '--file', 'work/e2e-reset.sql'],
  { encoding: 'utf8' },
);
if (reset.status) {
  console.error(reset.stderr || reset.stdout);
  process.exit(reset.status);
}
