// api/resumen.js - Endpoint Serverless en Vercel conectado a Neon
import { getDb } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const sql = getDb();

  // Si no hay DATABASE_URL configurada en Vercel todavía, devuelve datos de muestra
  if (!sql) {
    return res.status(200).json({
      modo: 'demo_sin_db',
      mensaje: 'Configura DATABASE_URL en Vercel con la URL de tu base de datos Neon.',
      obras: [
        { id: 1, nombre: 'Edificio Residencial Km 8', ubicacion: 'Km 8 Acaray, CDE', porcentaje_avance: 65, etapa_actual: 'Losa 2do Piso' },
        { id: 2, nombre: 'Dúplex Modernos Km 10', ubicacion: 'Km 10 Monday, CDE', porcentaje_avance: 40, etapa_actual: 'Mampostería y revoque' },
        { id: 3, nombre: 'Galpón Industrial Hernandarias', ubicacion: 'Hernandarias', porcentaje_avance: 25, etapa_actual: 'Movimiento de suelo' }
      ],
      personales: [
        { id: 1, nombre: 'Pedro Benítez', cargo: 'Oficial Albañil', obra: 'Dúplex Km 10', dias_trabajados: 5, vales: 150000, a_cobrar: 850000 },
        { id: 2, nombre: 'Juan Almirón', cargo: 'Ayudante', obra: 'Dúplex Km 10', dias_trabajados: 5, vales: 0, a_cobrar: 600000 },
        { id: 3, nombre: 'Marcos Vera', cargo: 'Oficial Armador', obra: 'Dúplex Km 10', dias_trabajados: 5, vales: 100000, a_cobrar: 900000 },
        { id: 4, nombre: 'Carlos Cabrera', cargo: 'Capataz General', obra: 'Edificio Km 8', dias_trabajados: 5, vales: 300000, a_cobrar: 1200000 }
      ],
      bobcat: [
        { id: 1, cliente: 'Arq. Walter Benítez', zona: 'Hernandarias', horas_pactadas: 4, horas_reales: 5, total_facturado: 1500000, estado: 'finalizado_cobrado' },
        { id: 2, cliente: 'Don Gustavo Rojas', zona: 'CDE (Km 8 Acaray)', horas_pactadas: 4, horas_reales: 0, total_facturado: 1250000, estado: 'agendado' }
      ]
    });
  }

  try {
    const obras = await sql`SELECT * FROM obras ORDER BY id ASC`;
    const personales = await sql`
      SELECT p.id, p.nombre, p.cargo, o.nombre as obra, p.jornal_diario,
             COALESCE(SUM(av.vale_adelanto), 0) as total_vales
      FROM personales p
      LEFT JOIN obras o ON p.obra_id = o.id
      LEFT JOIN asistencias_vales av ON av.personal_id = p.id
      GROUP BY p.id, p.nombre, p.cargo, o.nombre, p.jornal_diario
      ORDER BY p.id ASC
    `;
    const materiales = await sql`
      SELECT m.*, o.nombre as obra
      FROM materiales m
      LEFT JOIN obras o ON m.obra_id = o.id
      ORDER BY m.fecha_entrega ASC
    `;
    const bobcat = await sql`SELECT * FROM bobcat_servicios ORDER BY fecha_servicio DESC`;

    return res.status(200).json({
      modo: 'neon_postgres_en_vivo',
      obras,
      personales,
      materiales,
      bobcat
    });
  } catch (error) {
    console.error('Error consultando Neon:', error);
    return res.status(500).json({ error: error.message });
  }
}
