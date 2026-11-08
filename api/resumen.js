// api/resumen.js - Endpoint de consulta completa y contabilidad para Vercel + Neon
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
    return res.status(500).json({ error: 'DATABASE_URL no configurada' });
  }

  try {
    // 1. Obras con conteo de operarios asignados
    const obras = await sql`
      SELECT o.*,
             COUNT(DISTINCT po.personal_id) as total_operarios_asignados
      FROM obras o
      LEFT JOIN personal_obras po ON po.obra_id = o.id
      GROUP BY o.id
      ORDER BY o.id ASC;
    `;

    // 2. Personales con múltiples obras asociadas (Muchos a Muchos)
    const personales = await sql`
      SELECT p.id, p.nombre, p.cargo, p.jornal_diario, p.telefono, p.activo,
             COALESCE(SUM(av.vale_adelanto), 0) as total_vales,
             COALESCE(
               json_agg(
                 json_build_object('id', o.id, 'nombre', o.nombre)
               ) FILTER (WHERE o.id IS NOT NULL),
               '[]'
             ) as obras_asignadas,
             COALESCE(
               array_agg(o.id) FILTER (WHERE o.id IS NOT NULL),
               '{}'
             ) as obras_ids
      FROM personales p
      LEFT JOIN personal_obras po ON po.personal_id = p.id
      LEFT JOIN obras o ON po.obra_id = o.id
      LEFT JOIN asistencias_vales av ON av.personal_id = p.id
      GROUP BY p.id, p.nombre, p.cargo, p.jornal_diario, p.telefono, p.activo
      ORDER BY p.id ASC;
    `;

    // 3. Vales detallados individuales
    const vales_detalle = await sql`
      SELECT av.id, av.personal_id, p.nombre as personal_nombre, av.obra_id, o.nombre as obra_nombre,
             av.fecha, av.vale_adelanto, av.observacion, av.estado
      FROM asistencias_vales av
      JOIN personales p ON av.personal_id = p.id
      LEFT JOIN obras o ON av.obra_id = o.id
      ORDER BY av.id DESC;
    `;

    // 4. Materiales y remisiones
    const materiales = await sql`
      SELECT m.*, o.nombre as obra
      FROM materiales m
      LEFT JOIN obras o ON m.obra_id = o.id
      ORDER BY m.fecha_entrega ASC;
    `;

    // 5. Servicios de Bobcat
    const bobcat = await sql`
      SELECT * FROM bobcat_servicios
      ORDER BY fecha_servicio DESC;
    `;

    // 6. Registro de Actividad
    let actividad = [];
    try {
      actividad = await sql`SELECT * FROM actividad_whatsapp ORDER BY fecha DESC LIMIT 20;`;
    } catch (e) {
      console.warn('Tabla actividad:', e.message);
    }

    // 7. Balance y Contabilidad Detallada
    let totalValesSemana = 0;
    let totalJornalesEstimados = 0;
    personales.forEach(p => {
      const val = Number(p.total_vales || 0);
      totalValesSemana += val;
      totalJornalesEstimados += (Number(p.jornal_diario || 150000) * 5); // 5 días de jornal
    });

    let totalBobcatCobrado = 0;
    let totalBobcatPendiente = 0;
    bobcat.forEach(b => {
      const fact = Number(b.total_facturado || 0);
      if (b.estado === 'finalizado_cobrado') {
        totalBobcatCobrado += fact;
      } else {
        totalBobcatPendiente += fact;
      }
    });

    const totalIngresos = totalBobcatCobrado + totalBobcatPendiente;
    const totalEgresos = totalJornalesEstimados; // Jornales brutos a liquidar
    const saldoNeto = totalIngresos - totalEgresos;

    return res.status(200).json({
      modo: 'neon_postgres_en_vivo',
      obras,
      personales,
      vales_detalle,
      materiales,
      bobcat,
      actividad,
      contabilidad: {
        total_ingresos: totalIngresos,
        total_bobcat_cobrado: totalBobcatCobrado,
        total_bobcat_pendiente: totalBobcatPendiente,
        total_egresos_jornales: totalJornalesEstimados,
        total_vales_adelantados: totalValesSemana,
        saldo_liquido_sabado: (totalJornalesEstimados - totalValesSemana),
        balance_neto_operativo: saldoNeto
      }
    });
  } catch (error) {
    console.error('Error consultando Neon:', error);
    return res.status(500).json({ error: error.message });
  }
}
