'use strict';

require('dotenv').config();

const db = require('../src/db');

async function migrate() {
  console.log('Running migrations…');

  await db.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id              VARCHAR(36)          PRIMARY KEY,
      name            VARCHAR              NOT NULL UNIQUE,
      gender          VARCHAR              NOT NULL,
      gender_probability  FLOAT            NOT NULL,
      age             INT                  NOT NULL,
      age_group       VARCHAR              NOT NULL,
      country_id      VARCHAR(2)           NOT NULL,
      country_name    VARCHAR              NOT NULL,
      country_probability FLOAT            NOT NULL,
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Indexes for every filterable / sortable column — prevents full table scans
  const indexes = [
    ['idx_profiles_gender',               'gender'],
    ['idx_profiles_age',                  'age'],
    ['idx_profiles_age_group',            'age_group'],
    ['idx_profiles_country_id',           'country_id'],
    ['idx_profiles_gender_probability',   'gender_probability'],
    ['idx_profiles_country_probability',  'country_probability'],
    ['idx_profiles_created_at',           'created_at'],
  ];

  for (const [name, col] of indexes) {
    await db.query(
      `CREATE INDEX IF NOT EXISTS ${name} ON profiles(${col});`
    );
  }

  console.log('✅  Migrations complete.');
  await db.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
