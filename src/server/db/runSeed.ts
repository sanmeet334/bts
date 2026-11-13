import { getDb, closeDb } from './connection.js';
import { seedDatabase } from './seed.js';

const db = getDb();
const count = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
if (count === 0) {
  seedDatabase(db);
  console.log('TRAFFIX database seeded successfully.');
} else {
  console.log(`TRAFFIX database already initialized (${count} users present).`);
}
closeDb();
