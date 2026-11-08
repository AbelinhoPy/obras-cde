import { neon } from '@neondatabase/serverless';

const connectionString = "postgresql://neondb_owner:npg_If2PRSOzmn6G@ep-square-paper-bec2o6wa-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const sql = neon(connectionString);

async function migrate() {
  console.log('Creando tabla personal_obras en Neon...');
  await sql`
    CREATE TABLE IF NOT EXISTS personal_obras (
      id SERIAL PRIMARY KEY,
      personal_id INT NOT NULL REFERENCES personales(id) ON DELETE CASCADE,
      obra_id INT NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
      rol_en_obra VARCHAR(80),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(personal_id, obra_id)
    );
  `;

  console.log('Migrando obras asignadas actuales...');
  await sql`
    INSERT INTO personal_obras (personal_id, obra_id)
    SELECT id, obra_id FROM personales WHERE obra_id IS NOT NULL
    ON CONFLICT (personal_id, obra_id) DO NOTHING;
  `;

  // Asignar Carlos Cabrera a Edificio Km 8 y Dúplex Km 10 (múltiples obras)
  await sql`
    INSERT INTO personal_obras (personal_id, obra_id)
    VALUES (5, 2), (1, 1)
    ON CONFLICT (personal_id, obra_id) DO NOTHING;
  `;

  const rows = await sql`
    SELECT po.personal_id, p.nombre, string_agg(o.nombre, ' • ') as obras
    FROM personal_obras po
    JOIN personales p ON po.personal_id = p.id
    JOIN obras o ON po.obra_id = o.id
    GROUP BY po.personal_id, p.nombre
    ORDER BY po.personal_id ASC;
  `;
  console.log('Asociación Muchos a Muchos completada:', rows);
}

migrate().catch(console.error);
