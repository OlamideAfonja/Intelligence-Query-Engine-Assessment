'use strict';

/**
 * Usage:
 *   node scripts/seed.js [path/to/profiles.json]
 *
 * Defaults to ./data/profiles.json if no path is supplied.
 * Re-running is safe — duplicate names are silently skipped.
 */

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { uuidv7 } = require('uuidv7');
const db = require('../src/db');

const BATCH_SIZE = 100;

async function seed() {
  const filePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '../data/profiles.json');

  if (!fs.existsSync(filePath)) {
    console.error(`❌  File not found: ${filePath}`);
    console.error(
      'Usage: node scripts/seed.js [path/to/profiles.json]\n' +
      'Or place the file at data/profiles.json'
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  // Accept both a bare array and { "profiles": [...] } wrapper
  const profiles = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.profiles)
    ? parsed.profiles
    : null;

  if (!profiles) {
    console.error('❌  Expected a JSON array or { "profiles": [...] } object.');
    process.exit(1);
  }

  console.log(`Seeding ${profiles.length} profiles (batch size: ${BATCH_SIZE})…`);

  let inserted = 0;
  let skipped = 0;

  // Process in batches to avoid huge queries and excessive round-trips
  for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
    const batch = profiles.slice(i, i + BATCH_SIZE);

    // Build a single multi-row INSERT per batch
    // Values: (id, name, gender, gender_probability, age, age_group,
    //          country_id, country_name, country_probability)
    const valuePlaceholders = [];
    const params = [];
    let pIdx = 1;

    for (const p of batch) {
      valuePlaceholders.push(
        `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, ` +
        `$${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
      );
      params.push(
        uuidv7(),
        p.name,
        p.gender,
        p.gender_probability,
        p.age,
        p.age_group,
        p.country_id,
        p.country_name,
        p.country_probability
      );
    }

    const sql = `
      INSERT INTO profiles
        (id, name, gender, gender_probability, age, age_group,
         country_id, country_name, country_probability)
      VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT (name) DO NOTHING
    `;

    const result = await db.query(sql, params);
    inserted += result.rowCount;
    skipped  += batch.length - result.rowCount;

    process.stdout.write(
      `\r  Progress: ${Math.min(i + BATCH_SIZE, profiles.length)}/${profiles.length}`
    );
  }

  console.log(`\n✅  Done.  Inserted: ${inserted}  |  Skipped (duplicates): ${skipped}`);
  await db.end();
}

seed().catch((err) => {
  console.error('\n❌  Seed failed:', err);
  process.exit(1);
});
