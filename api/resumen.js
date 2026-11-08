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

  if (!sql) {
    return res.status(200).json({
      modo: 'demo_sin_db',
      mensaje: 'DATABASE_URL no configurada',
      obras: [],
      personales: [],
      materiales: [],
      bobcat: [],
      actividad: []
    });
  }

  try {
    const obras = await sql`SELECT * FROM obras ORDER BY id ASC`;
    
    const personales = await sql`
      SELECT p.id, p.nombre, p.cargo, p.obra_id, o.nombre as obra, p.jornal_diario,
             COALESCE(SUM(av.vale_adelanto), 0) as total_vales,
             COUNT(DISTINCT av.fecha) as dias_computados
      FROM personales p
      LEFT JOIN obras o ON p.obra_id = o.id
      LEFT JOIN asistencias_vales av ON av.personal_id = p.id
      GROUP BY p.id, p.nombre, p.cargo, p.obra_id, o.nombre, p.jornal_diario
      ORDER BY p.id ASC
    `;

    const materiales = await sql`
      SELECT m.*, o.nombre as obra
      FROM materiales m
      LEFT JOIN obras o ON m.obra_id = o.id
      ORDER BY m.fecha_entrega ASC
    `;

    const bobcat = await sql`SELECT * FROM bobcat_servicios ORDER BY fecha_servicio DESC`;

    let actividad = [];
    try {
      actividad = await sql`SELECT * FROM actividad_whatsapp ORDER BY fecha DESC LIMIT 15`;
    } catch (e) {
      console.warn('Tabla actividad_whatsapp aún no creada o vacía:', e.message);
    }

    // Calcular KPIs de gestión
    let totalValesSemana = 0;
    personales.forEach(p => {
      totalValesSemana += Number(p.total_vales || 0);
    });

    let totalFacturadoBobcat = 0;
    let horasBobcatTotales = 0;
    bobcat.forEach(b => {
      totalFacturadoBobcat += Number(b.total_facturado || 0);
      horasBobcatTotales += Number(b.horas_reales > 0 ? b.horas_reales : b.horas_pactadas);
    });

    return res.status(200).json({
      modo: 'neon_postgres_en_vivo',
      obras,
      personales,
      materiales,
      bobcat,
      actividad,
      kpis: {
        total_obras: obras.length,
        total_personales: personales.length,
        total_vales_semana: totalValesSemana,
        total_facturado_bobcat: totalFacturadoBobcat,
        horas_bobcat_totales: horasBobcatTotales,
        materiales_pendientes: materiales.filter(m => m.estado !== 'recibido').length
      }
    });
  } catch (error) {
    console.error('Error consultando Neon:', error);
    return res.status(500).json({ error: error.message });
  }
}
