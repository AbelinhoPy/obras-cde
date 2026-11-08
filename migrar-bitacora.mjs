import { neon } from '@neondatabase/serverless';
import fs from 'fs';

let dbUrl = process.env.DATABASE_URL;
if (!dbUrl && fs.existsSync('.env')) {
  const envText = fs.readFileSync('.env', 'utf8');
  const match = envText.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
  if (match) dbUrl = match[1];
}

const sql = neon(dbUrl);

async function run() {
  console.log('Creando tabla bitacora_obras en Neon...');
  
  await sql('CREATE TABLE IF NOT EXISTS bitacora_obras (' +
    'id SERIAL PRIMARY KEY, ' +
    'obra_id INT REFERENCES obras(id) ON DELETE CASCADE, ' +
    'fecha TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, ' +
    'categoria VARCHAR(50) DEFAULT \'general\', ' +
    'nota TEXT NOT NULL, ' +
    'autor VARCHAR(100) DEFAULT \'Ingeniero\', ' +
    'foto_url TEXT, ' +
    'monto_imprevisto NUMERIC(12, 2) DEFAULT 0, ' +
    'created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP' +
  ')');

  const count = await sql('SELECT count(*) FROM bitacora_obras');
  if (Number(count[0].count) === 0) {
    await sql('INSERT INTO bitacora_obras (obra_id, categoria, nota, autor, monto_imprevisto, fecha) VALUES ' +
      '(1, \'clima\', \'Llovió torrencialmente desde las 10:30 hasta las 14:00. Se suspendió el cargamento de hormigón en losa del 2do piso por seguridad. Se retoma mañana.\', \'Ing. Residente\', 0, NOW() - INTERVAL \'1 day\'), ' +
      '(1, \'compra_imprevista\', \'Se compró de urgencia 15 discos de corte para amoladora y 2 cintas métricas en Ferretería Central.\', \'Carlos Cabrera (Capataz)\', 185000, NOW() - INTERVAL \'12 hours\'), ' +
      '(2, \'foto_pendiente\', \'Faltó registrar fotografía de la armadura de vigas antes de cerrar encofrado. Enviar a Ramón o capataz para sacar foto antes de las 16hs.\', \'Ingeniero\', 0, NOW() - INTERVAL \'5 hours\'), ' +
      '(3, \'incidencia\', \'Retraso de 2 horas en la llegada del camión volquete de arena lavada por corte sobre Ruta 02. Bobcat estuvo esperando.\', \'Ingeniero\', 0, NOW() - INTERVAL \'2 hours\')'
    );
    console.log('Notas de prueba insertadas con éxito.');
  }

  const result = await sql('SELECT b.*, o.nombre as obra_nombre FROM bitacora_obras b LEFT JOIN obras o ON b.obra_id = o.id ORDER BY b.fecha DESC');
  console.log('Notas actuales en bitácora:', result.length);
  result.forEach(r => console.log(`- [#${r.id}] ${r.obra_nombre} (${r.categoria}): ${r.nota.substring(0, 50)}...`));
}

run().catch(console.error);
