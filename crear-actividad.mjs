import { neon } from '@neondatabase/serverless';

const connectionString = "postgresql://neondb_owner:npg_If2PRSOzmn6G@ep-square-paper-bec2o6wa-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const sql = neon(connectionString);

async function run() {
  await sql`
    CREATE TABLE IF NOT EXISTS actividad_whatsapp (
      id SERIAL PRIMARY KEY,
      remitente VARCHAR(100) NOT NULL,
      tipo_evento VARCHAR(50) NOT NULL,
      mensaje_original TEXT,
      resumen_accion TEXT,
      fecha TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  console.log('Tabla actividad_whatsapp creada.');

  await sql`
    INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
    VALUES 
    ('Capataz Carlos (Audio WhatsApp)', 'asistencia_vale', 'Anota lista Dúplex Km 10: Vinieron Juan, Marcos y Pedro. Silvio faltó. A Pedro dale 150 mil de vale.', 'Registrados 3 obreros presentes y vale de 150.000 Gs. a Pedro Benítez.'),
    ('Operador Ramón (WhatsApp)', 'horas_ramon', 'Patrón ya terminé en Hernandarias, 5 horas clavadas marcó el horómetro.', 'Cierre de servicio Bobcat: 5 horas computadas. Total facturado 1.500.000 Gs. Cobrado.'),
    ('Distribuidora Alto Paraná', 'material_recepcion', 'Ingeniero mañana 8:30 van las 200 bolsas de cemento a Hernandarias.', 'Carga programada en agenda para mañana 08:30 hs.')
  `;
  console.log('Actividades de WhatsApp registradas exitosamente en Neon.');
}

run().catch(console.error);
