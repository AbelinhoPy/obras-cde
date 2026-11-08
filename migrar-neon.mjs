import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const connectionString = "postgresql://neondb_owner:npg_If2PRSOzmn6G@ep-square-paper-bec2o6wa-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const sql = neon(connectionString);

async function migrar() {
  console.log('Conectando a Neon PostgreSQL...');
  let rawSql = readFileSync('schema.sql', 'utf8');

  // Quitar comentarios
  rawSql = rawSql.replace(/--.*$/gm, '');
  rawSql = rawSql.replace(/\/\*[\s\S]*?\*\//gm, '');

  const statements = rawSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const st of statements) {
    const preview = st.replace(/\s+/g, ' ').substring(0, 50);
    console.log('Ejecutando:', preview + '...');
    try {
      await sql([st]);
      console.log('  -> OK');
    } catch (e) {
      console.error('  -> Error:', e.message);
    }
  }

  console.log('\n--- VERIFICACIÓN FINAL EN NEON ---');
  const tablas = await sql(['SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' ORDER BY table_name']);
  console.log('Tablas creadas en Neon:', tablas.map(t => t.table_name));

  const countObras = await sql(['SELECT count(*) FROM obras']);
  const countPersonales = await sql(['SELECT count(*) FROM personales']);
  const countBobcat = await sql(['SELECT count(*) FROM bobcat_servicios']);
  const countMateriales = await sql(['SELECT count(*) FROM materiales']);

  console.log(`Obras: ${countObras[0].count}`);
  console.log(`Personales: ${countPersonales[0].count}`);
  console.log(`Materiales: ${countMateriales[0].count}`);
  console.log(`Servicios Bobcat: ${countBobcat[0].count}`);
}

migrar().catch(err => {
  console.error('Fallo general:', err);
  process.exit(1);
});
