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
  const { tipo, data, remitente, mensaje_original } = body;

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
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES (
          ${remitente || 'WhatsApp (Obra)'},
          'asistencia_vale',
          ${mensaje_original || `Vale de ${data.vale} Gs. registrado por WhatsApp`},
          ${`Registrado vale para personal #${data.personal_id} en obra #${data.obra_id}`}
        )
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
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES (
          ${remitente || 'WhatsApp (Cliente Bobcat)'},
          'reserva_bobcat',
          ${mensaje_original || `Pedido de Bobcat por WhatsApp: ${data.cliente}`},
          ${`Reserva agendada en ${data.zona}. ${data.horas || 4} hs.`}
        )
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
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES (
          'Operador Ramón (WhatsApp)',
          'horas_ramon',
          ${mensaje_original || `Ramón reportó ${horasReales} horas reales de horómetro`},
          ${`Servicio #${data.servicio_id} cobrado y finalizado: ${totalFinal.toLocaleString('es-PY')} Gs.`}
        )
      `;
      return res.status(200).json({ ok: true, mensaje: 'Horas y liquidación de Ramón actualizadas en Neon' });
    }

    if (tipo === 'recepcion_material') {
      await sql`
        INSERT INTO materiales (obra_id, material, cantidad, proveedor, fecha_entrega, responsable_recepcion, estado, remision_nro)
        VALUES (${data.obra_id || null}, ${data.material}, ${data.cantidad}, ${data.proveedor || 'Proveedor'}, ${data.fecha_entrega || new Date().toISOString()}, ${data.responsable || 'Encargado'}, ${data.estado || 'programado'}, ${data.remision_nro || ''})
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES (
          ${remitente || 'WhatsApp (Proveedor)'},
          'material_recepcion',
          ${mensaje_original || `Entrega de material reportada por WhatsApp`},
          ${`Agendada entrega de ${data.material} (${data.cantidad})`}
        )
      `;
      return res.status(200).json({ ok: true, mensaje: 'Material agendado desde WhatsApp en Neon' });
    }

    if (tipo === 'nota_bitacora') {
      await sql`
        INSERT INTO bitacora_obras (obra_id, categoria, nota, autor, foto_url, monto_imprevisto)
        VALUES (${data.obra_id || null}, ${data.categoria || 'general'}, ${data.nota}, ${remitente || data.autor || 'Ingeniero (WhatsApp)'}, ${data.foto_url || null}, ${data.monto_imprevisto || 0})
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES (
          ${remitente || 'WhatsApp (Bitácora)'},
          'nota_bitacora',
          ${mensaje_original || data.nota},
          ${`Nota en bitácora para obra #${data.obra_id || 'General'}: ${data.categoria || 'general'}`}
        )
      `;
      return res.status(200).json({ ok: true, mensaje: 'Nota agregada a la bitácora desde WhatsApp' });
    }

    return res.status(400).json({ error: 'Tipo de operación no reconocido' });
  } catch (error) {
    console.error('Error insertando en Neon:', error);
    return res.status(500).json({ error: error.message });
  }
}
