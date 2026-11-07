// api/webhook-whatsapp.js - Endpoint para recibir datos procesados por n8n e insertarlos en Neon
import { getDb } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getDb();
  const body = req.body || {};
  const { tipo, data } = body;

  if (!sql) {
    return res.status(200).json({ ok: true, mensaje: 'Simulación exitosa (sin DATABASE_URL configurada)' });
  }

  try {
    if (tipo === 'vale_asistencia') {
      // Registrar vale o asistencia
      await sql`
        INSERT INTO asistencias_vales (personal_id, obra_id, fecha, estado, vale_adelanto, observacion)
        VALUES (${data.personal_id}, ${data.obra_id}, CURRENT_DATE, ${data.estado || 'presente'}, ${data.vale || 0}, ${data.observacion || ''})
      `;
      return res.status(200).json({ ok: true, mensaje: 'Vale / asistencia registrada en Neon' });
    }

    if (tipo === 'reserva_bobcat') {
      // Registrar nueva reserva de Bobcat
      const total = (Number(data.horas || 4) * 250000) + 250000;
      await sql`
        INSERT INTO bobcat_servicios (cliente, telefono_cliente, zona_destino, fecha_servicio, horas_pactadas, tarifa_hora, costo_traslado, total_facturado, estado)
        VALUES (${data.cliente}, ${data.telefono || ''}, ${data.zona}, ${data.fecha || new Date().toISOString()}, ${data.horas || 4}, 250000, 250000, ${total}, 'agendado')
      `;
      return res.status(200).json({ ok: true, mensaje: 'Reserva Bobcat guardada en Neon' });
    }

    if (tipo === 'cierre_horas_ramon') {
      // Ramón reporta horas reales trabajadas
      const horasReales = Number(data.horas_reales);
      const totalFinal = (horasReales * 250000) + 250000;
      await sql`
        UPDATE bobcat_servicios
        SET horas_reales = ${horasReales}, total_facturado = ${totalFinal}, estado = 'finalizado_cobrado', notas_operador = ${data.notas || 'Cierre por WhatsApp'}
        WHERE id = ${data.servicio_id}
      `;
      return res.status(200).json({ ok: true, mensaje: 'Horas y liquidación de Ramón actualizadas en Neon' });
    }

    return res.status(400).json({ error: 'Tipo de operación no reconocido' });
  } catch (error) {
    console.error('Error insertando en Neon:', error);
    return res.status(500).json({ error: error.message });
  }
}
