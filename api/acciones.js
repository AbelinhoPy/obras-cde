// api/acciones.js - CRUD interactivo integral (Crear, Editar, Eliminar) conectado a Neon
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
    // ==========================================
    // 1. MÓDULO OBRAS
    // ==========================================
    if (accion === 'crear_obra') {
      const { nombre, ubicacion, etapa_actual, porcentaje_avance } = data;
      await sql`
        INSERT INTO obras (nombre, ubicacion, etapa_actual, porcentaje_avance, estado)
        VALUES (${nombre}, ${ubicacion}, ${etapa_actual || 'Inicio'}, ${porcentaje_avance || 0}, 'activa')
      `;
      return res.status(200).json({ ok: true, mensaje: 'Obra creada exitosamente' });
    }

    if (accion === 'editar_obra') {
      const { id, nombre, ubicacion, etapa_actual, porcentaje_avance, estado } = data;
      await sql`
        UPDATE obras
        SET nombre = ${nombre}, ubicacion = ${ubicacion}, etapa_actual = ${etapa_actual},
            porcentaje_avance = ${porcentaje_avance}, estado = ${estado || 'activa'}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, mensaje: 'Obra actualizada correctamente' });
    }

    if (accion === 'eliminar_obra') {
      const { id } = data;
      await sql`DELETE FROM obras WHERE id = ${id}`;
      return res.status(200).json({ ok: true, mensaje: 'Obra eliminada del sistema' });
    }

    // ==========================================
    // 2. MÓDULO PERSONALES (Con N a N Obras)
    // ==========================================
    if (accion === 'crear_personal') {
      const { nombre, cargo, jornal_diario, telefono, obras_ids } = data;
      const result = await sql`
        INSERT INTO personales (nombre, cargo, jornal_diario, telefono, activo)
        VALUES (${nombre}, ${cargo}, ${jornal_diario || 150000}, ${telefono || ''}, true)
        RETURNING id;
      `;
      const personalId = result[0].id;

      // Asignar en personal_obras
      if (Array.isArray(obras_ids) && obras_ids.length > 0) {
        for (const oId of obras_ids) {
          await sql`
            INSERT INTO personal_obras (personal_id, obra_id)
            VALUES (${personalId}, ${oId})
            ON CONFLICT DO NOTHING;
          `;
        }
      }
      return res.status(200).json({ ok: true, mensaje: 'Personal registrado y asignado a obras' });
    }

    if (accion === 'editar_personal') {
      const { id, nombre, cargo, jornal_diario, telefono, activo, obras_ids } = data;
      await sql`
        UPDATE personales
        SET nombre = ${nombre}, cargo = ${cargo}, jornal_diario = ${jornal_diario},
            telefono = ${telefono || ''}, activo = ${activo !== false}
        WHERE id = ${id}
      `;

      // Sincronizar obras asignadas
      await sql`DELETE FROM personal_obras WHERE personal_id = ${id}`;
      if (Array.isArray(obras_ids) && obras_ids.length > 0) {
        for (const oId of obras_ids) {
          await sql`
            INSERT INTO personal_obras (personal_id, obra_id)
            VALUES (${id}, ${oId})
            ON CONFLICT DO NOTHING;
          `;
        }
      }
      return res.status(200).json({ ok: true, mensaje: 'Personal y asignación de obras actualizados' });
    }

    if (accion === 'eliminar_personal') {
      const { id } = data;
      await sql`DELETE FROM personales WHERE id = ${id}`;
      return res.status(200).json({ ok: true, mensaje: 'Personal eliminado' });
    }

    // ==========================================
    // 3. MÓDULO VALES / ASISTENCIAS
    // ==========================================
    if (accion === 'registrar_vale') {
      const { personal_id, obra_id, vale, observacion } = data;
      await sql`
        INSERT INTO asistencias_vales (personal_id, obra_id, fecha, estado, vale_adelanto, observacion)
        VALUES (${personal_id}, ${obra_id || null}, CURRENT_DATE, 'presente', ${vale || 0}, ${observacion || 'Vale manual'})
      `;
      return res.status(200).json({ ok: true, mensaje: 'Vale registrado en Neon' });
    }

    if (accion === 'editar_vale') {
      const { id, vale_adelanto, observacion } = data;
      await sql`
        UPDATE asistencias_vales
        SET vale_adelanto = ${vale_adelanto}, observacion = ${observacion || ''}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, mensaje: 'Vale modificado' });
    }

    if (accion === 'eliminar_vale') {
      const { id } = data;
      await sql`DELETE FROM asistencias_vales WHERE id = ${id}`;
      return res.status(200).json({ ok: true, mensaje: 'Vale eliminado y restituido a la liquidación' });
    }

    // ==========================================
    // 4. MÓDULO BOBCAT
    // ==========================================
    if (accion === 'crear_bobcat') {
      const { cliente, telefono, zona, fecha, horas, tarifa_hora, costo_traslado, operador } = data;
      const tarifa = Number(tarifa_hora || 250000);
      const flete = Number(costo_traslado || 250000);
      const horasNum = Number(horas || 4);
      const total = (horasNum * tarifa) + flete;

      await sql`
        INSERT INTO bobcat_servicios (
          cliente, telefono_cliente, zona_destino, fecha_servicio,
          horas_pactadas, horas_reales, tarifa_hora, costo_traslado, total_facturado, operador, estado
        ) VALUES (
          ${cliente}, ${telefono || ''}, ${zona}, ${fecha || new Date().toISOString()},
          ${horasNum}, 0, ${tarifa}, ${flete}, ${total}, ${operador || 'Ramón'}, 'agendado'
        )
      `;
      return res.status(200).json({ ok: true, mensaje: 'Servicio Bobcat agendado' });
    }

    if (accion === 'editar_bobcat') {
      const { id, cliente, telefono, zona, fecha, horas_pactadas, horas_reales, tarifa_hora, costo_traslado, estado, notas } = data;
      const horasFinales = Number(horas_reales > 0 ? horas_reales : horas_pactadas);
      const tarifa = Number(tarifa_hora || 250000);
      const flete = Number(costo_traslado || 250000);
      const total = (horasFinales * tarifa) + flete;

      await sql`
        UPDATE bobcat_servicios
        SET cliente = ${cliente}, telefono_cliente = ${telefono || ''}, zona_destino = ${zona},
            fecha_servicio = ${fecha}, horas_pactadas = ${horas_pactadas}, horas_reales = ${horas_reales || 0},
            tarifa_hora = ${tarifa}, costo_traslado = ${flete}, total_facturado = ${total},
            estado = ${estado || 'agendado'}, notas_operador = ${notas || ''}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, mensaje: 'Servicio Bobcat actualizado' });
    }

    if (accion === 'cerrar_bobcat_ramon') {
      const { servicio_id, horas_reales, notas } = data;
      const horasNum = Number(horas_reales);
      const totalFinal = (horasNum * 250000) + 250000;

      await sql`
        UPDATE bobcat_servicios
        SET horas_reales = ${horasNum}, total_facturado = ${totalFinal}, estado = 'finalizado_cobrado', notas_operador = ${notas || 'Cierre verificado'}
        WHERE id = ${servicio_id}
      `;
      return res.status(200).json({ ok: true, mensaje: 'Horómetro de Ramón liquidado exitosamente' });
    }

    if (accion === 'eliminar_bobcat') {
      const { id } = data;
      await sql`DELETE FROM bobcat_servicios WHERE id = ${id}`;
      return res.status(200).json({ ok: true, mensaje: 'Servicio de Bobcat eliminado' });
    }

    // ==========================================
    // 5. MÓDULO MATERIALES
    // ==========================================
    if (accion === 'registrar_material') {
      const { obra_id, material, cantidad, proveedor, fecha_entrega, responsable_recepcion } = data;
      await sql`
        INSERT INTO materiales (obra_id, material, cantidad, proveedor, fecha_entrega, responsable_recepcion, estado)
        VALUES (${obra_id || null}, ${material}, ${cantidad}, ${proveedor}, ${fecha_entrega || new Date().toISOString()}, ${responsable_recepcion || 'Encargado'}, 'programado')
      `;
      return res.status(200).json({ ok: true, mensaje: 'Material agendado' });
    }

    if (accion === 'editar_material') {
      const { id, obra_id, material, cantidad, proveedor, fecha_entrega, responsable_recepcion, estado, remision_nro } = data;
      await sql`
        UPDATE materiales
        SET obra_id = ${obra_id || null}, material = ${material}, cantidad = ${cantidad},
            proveedor = ${proveedor}, fecha_entrega = ${fecha_entrega}, responsable_recepcion = ${responsable_recepcion},
            estado = ${estado || 'programado'}, remision_nro = ${remision_nro || ''}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, mensaje: 'Material actualizado' });
    }

    if (accion === 'marcar_material_recibido') {
      const { material_id, remision_nro } = data;
      await sql`
        UPDATE materiales
        SET estado = 'recibido', remision_nro = ${remision_nro || 'S/N'}
        WHERE id = ${material_id}
      `;
      return res.status(200).json({ ok: true, mensaje: 'Material marcado como recibido' });
    }

    if (accion === 'eliminar_material') {
      const { id } = data;
      await sql`DELETE FROM materiales WHERE id = ${id}`;
      return res.status(200).json({ ok: true, mensaje: 'Registro de material eliminado' });
    }

    // ==========================================
    // 6. MÓDULO BITÁCORA DE OBRAS (NOTAS DE CAMPO)
    // ==========================================
    if (accion === 'crear_bitacora') {
      const { obra_id, categoria, nota, autor, foto_url, monto_imprevisto } = data;
      await sql`
        INSERT INTO bitacora_obras (obra_id, categoria, nota, autor, foto_url, monto_imprevisto)
        VALUES (${obra_id || null}, ${categoria || 'general'}, ${nota}, ${autor || 'Ingeniero'}, ${foto_url || null}, ${monto_imprevisto || 0})
      `;
      return res.status(200).json({ ok: true, mensaje: 'Nota registrada en la bitácora de obra' });
    }

    if (accion === 'editar_bitacora') {
      const { id, obra_id, categoria, nota, autor, foto_url, monto_imprevisto } = data;
      await sql`
        UPDATE bitacora_obras
        SET obra_id = ${obra_id || null}, categoria = ${categoria || 'general'},
            nota = ${nota}, autor = ${autor || 'Ingeniero'}, foto_url = ${foto_url || null},
            monto_imprevisto = ${monto_imprevisto || 0}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, mensaje: 'Nota de bitácora actualizada' });
    }

    if (accion === 'eliminar_bitacora') {
      const { id } = data;
      await sql`DELETE FROM bitacora_obras WHERE id = ${id}`;
      return res.status(200).json({ ok: true, mensaje: 'Nota de bitácora eliminada' });
    }

    return res.status(400).json({ error: 'Acción no reconocida' });
  } catch (error) {
    console.error('Error ejecutando acción:', error);
    return res.status(500).json({ error: error.message });
  }
}
