// api/db.js - Conexión oficial a Neon PostgreSQL Serverless
import { neon } from '@neondatabase/serverless';

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('DATABASE_URL no configurada. Usando modo demostración.');
    return null;
  }
  return neon(databaseUrl);
}
