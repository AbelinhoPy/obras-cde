import { neon } from '@neondatabase/serverless';
import fs from 'fs';

let dbUrl = process.env.DATABASE_URL;
if (!dbUrl && fs.existsSync('.env')) {
  const envText = fs.readFileSync('.env', 'utf8');
  const match = envText.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
  if (match) dbUrl = match[1];
}

const sql = neon(dbUrl);

async function limpiar() {
  console.log('--- INICIANDO LIMPIEZA COMPLETA DE DATOS DE PRUEBA EN NEON ---');
  
  await sql`
    TRUNCATE TABLE 
      personal_obras, 
      asistencias_vales, 
      materiales, 
      bobcat_servicios, 
      bitacora_obras, 
      actividad_whatsapp, 
      personales, 
      obras 
    RESTART IDENTITY CASCADE;
  `;

  console.log('✅ Todas las tablas truncadas e identidades reiniciadas a 1.');

  const tables = ['obras', 'personales', 'personal_obras', 'asistencias_vales', 'materiales', 'bobcat_servicios', 'bitacora_obras', 'actividad_whatsapp'];
  for (const t of tables) {
    const c = await sql(`SELECT count(*) FROM ${t}`);
    console.log(`- ${t}: ${c[0].count} registros`);
  }
}

limpiar().catch(console.error);
