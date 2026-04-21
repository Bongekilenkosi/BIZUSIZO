'use strict';
/**
 * seed_admin.js — one-time admin account setup for Bizusizo clinical dashboard.
 *
 * Usage:
 *   node scripts/seed_admin.js
 *
 * Outputs a SQL INSERT you paste into Supabase SQL Editor.
 * Run ONCE before launch. Delete this script after use if desired.
 */

const bcrypt    = require('bcryptjs');
const readline  = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n=== Bizusizo Admin Seed ===\n');

  const username     = await ask('Admin username (e.g. admin):          ');
  const displayName  = await ask('Display name (e.g. System Admin):     ');
  const password     = await ask('Temporary password (change on login): ');
  const facilityName = await ask('Facility name (or press Enter for none): ');

  rl.close();

  if (!username || !password) {
    console.error('\nUsername and password are required.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password.trim(), 12);

  const facilityClause = facilityName.trim()
    ? `'${facilityName.trim().replace(/'/g, "''")}'`
    : 'NULL';

  console.log('\n--- Paste this into Supabase SQL Editor ---\n');
  console.log(`INSERT INTO facility_users
  (username, password_hash, display_name, role, facility_name, is_active)
VALUES
  (
    '${username.toLowerCase().trim()}',
    '${hash}',
    '${displayName.trim().replace(/'/g, "''")}',
    'admin',
    ${facilityClause},
    true
  );`);

  console.log('\n-------------------------------------------');
  console.log('After inserting, log in at /clinical/login');
  console.log('Change this password immediately via the dashboard.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
