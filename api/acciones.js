// api/acciones.js - CRUD interactivo directo desde la plataforma web a Neon
import { getDb } from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getDb();
  if (!sql) {
    return res.status(500).json({ error: 'DATABASE_URL no configurada' });
  }

  const { accion, data } = req.body || {};

  try {
    // 1. Crear Obra
    if (accion === 'crear_obra') {
      const { nombre, ubicacion, etapa_actual, porcentaje_avance } = data;
      await sql`
        INSERT INTO obras (nombre, ubicacion, etapa_actual, porcentaje_avance, estado)
        VALUES (${nombre}, ${ubicacion}, ${etapa_actual || 'Inicio'}, ${porcentaje_avance || 0}, 'activa')
      `;
      // Registrar log de actividad
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES ('Sistema Web (Ingeniero)', 'crear_obra', ${`Nueva obra registrada: ${nombre}`}, ${`Obra ${nombre} dada de alta en ${ubicacion}`})
      `;
      return res.status(200).json({ ok: true, mensaje: 'Obra creada exitosamente' });
    }

    // 2. Crear Personal de Obra
    if (accion === 'crear_personal') {
      const { nombre, cargo, obra_id, jornal_diario, telefono } = data;
      await sql`
        INSERT INTO personales (nombre, cargo, obra_id, jornal_diario, telefono)
        VALUES (${nombre}, ${cargo}, ${obra_id || null}, ${jornal_diario || 150000}, ${telefono || ''})
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES ('Sistema Web (Ingeniero)', 'crear_personal', ${`Alta de personal: ${nombre} (${cargo})`}, ${`Registrado con jornal de ${Number(jornal_diario || 150000).toLocaleString('es-PY')} Gs.`})
      `;
      return res.status(200).json({ ok: true, mensaje: 'Personal registrado con éxito' });
    }

    // 3. Registrar Vale o Asistencia Manual
    if (accion === 'registrar_vale') {
      const { personal_id, obra_id, vale, observacion } = data;
      await sql`
        INSERT INTO asistencias_vales (personal_id, obra_id, fecha, estado, vale_adelanto, observacion)
        VALUES (${personal_id}, ${obra_id || null}, CURRENT_DATE, 'presente', ${vale || 0}, ${observacion || 'Vale cargado desde panel web'})
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES ('Sistema Web (Ingeniero)', 'asistencia_vale', ${`Vale de ${Number(vale).toLocaleString('es-PY')} Gs.`}, ${`Registrado a ID de personal #${personal_id} para liquidación del sábado`})
      `;
      return res.status(200).json({ ok: true, mensaje: 'Vale registrado y descontado para el sábado' });
    }

    // 4. Registrar Entrega de Material
    if (accion === 'registrar_material') {
      const { obra_id, material, cantidad, proveedor, fecha_entrega, responsable_recepcion } = data;
      await sql`
        INSERT INTO materiales (obra_id, material, cantidad, proveedor, fecha_entrega, responsable_recepcion, estado)
        VALUES (${obra_id || null}, ${material}, ${cantidad}, ${proveedor}, ${fecha_entrega || new Date().toISOString()}, ${responsable_recepcion || 'Encargado'}, 'programado')
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES ('Sistema Web (Ingeniero)', 'material_recepcion', ${`Carga de ${material} (${cantidad})`}, ${`Entrega agendada con proveedor ${proveedor}`})
      `;
      return res.status(200).json({ ok: true, mensaje: 'Material agendado en el sistema' });
    }

    // 5. Marcar Material como Recibido en Obra
    if (accion === 'marcar_material_recibido') {
      const { material_id, remision_nro } = data;
      await sql`
        UPDATE materiales
        SET estado = 'recibido', remision_nro = ${remision_nro || 'S/N'}
        WHERE id = ${material_id}
      `;
      return res.status(200).json({ ok: true, mensaje: 'Material marcado como recibido en obra' });
    }

    // 6. Agendar Alquiler de Bobcat
    if (accion === 'crear_bobcat') {
      const { cliente, telefono, zona, fecha, horas, operador } = data;
      const tarifaHora = 250000;
      const costoTraslado = 250000;
      const horasNum = Number(horas || 4);
      const totalEstimado = (horasNum * tarifaHora) + costoTraslado;

      await sql`
        INSERT INTO bobcat_servicios (
          cliente, telefono_cliente, zona_destino, fecha_servicio,
          horas_pactadas, horas_reales, tarifa_hora, costo_traslado, total_facturado, operador, estado
        ) VALUES (
          ${cliente}, ${telefono || ''}, ${zona}, ${fecha || new Date().toISOString()},
          ${horasNum}, 0, ${tarifaHora}, ${costoTraslado}, ${totalEstimado}, ${operador || 'Ramón'}, 'agendado'
        )
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES ('Sistema Web (Ingeniero)', 'reserva_bobcat', ${`Reserva Bobcat: ${cliente} en ${zona}`}, ${`Agendado ${horasNum} hs. Total estimado: ${totalEstimado.toLocaleString('es-PY')} Gs.`})
      `;
      return res.status(200).json({ ok: true, mensaje: 'Servicio de Bobcat agendado correctamente' });
    }

    // 7. Cerrar Horas Reales del Operador Ramón
    if (accion === 'cerrar_bobcat_ramon') {
      const { servicio_id, horas_reales, notas } = data;
      const horasNum = Number(horas_reales);
      const totalFinal = (horasNum * 250000) + 250000;

      await sql`
        UPDATE bobcat_servicios
        SET horas_reales = ${horasNum}, total_facturado = ${totalFinal}, estado = 'finalizado_cobrado', notas_operador = ${notas || 'Cierre de servicio verificado'}
        WHERE id = ${servicio_id}
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES ('Operador Ramón', 'horas_ramon', ${`Horómetro reportado: ${horasNum} hs`}, ${`Servicio #${servicio_id} liquidado. Total a cobrar: ${totalFinal.toLocaleString('es-PY')} Gs.`})
      `;
      return res.status(200).json({ ok: true, mensaje: 'Horas y facturación final del operador actualizadas' });
    }

    return res.status(400).json({ error: 'Acción no reconocida' });
  } catch (error) {
    console.error('Error ejecutando acción:', error);
    return res.status(500).json({ error: error.message });
  }
}
