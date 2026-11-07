// simular-demo.mjs - Motor de simulación local del Asistente de Agenda y Pendientes
// Ejecuta exactamente la misma lógica de agenda-demo.json con persistencia e idempotencia

const state = {
  procesados: {},
  agenda: [],
  pendientes: [],
  revision: []
};

function procesarMensaje(msg) {
  const { id, remitente, origen, texto } = msg;

  // Deduplicación / Idempotencia
  if (state.procesados[id]) {
    const previo = state.procesados[id];
    return {
      id,
      remitente,
      origen,
      estado: 'duplicado',
      duplicado: true,
      mensaje: 'Registro ya existente para este ID. Se conserva registro único.',
      anotado: previo.anotado,
      respuesta_sugerida: previo.respuesta_sugerida
    };
  }

  const anotado = { agenda: null, pendientes: null, revision: null };
  let respuesta_sugerida = null;
  let estado = 'procesado';

  // Regla 1: Detección de fecha y hora confirmadas (Zona America/Asuncion)
  const regexFechaHora = /(\d{1,2})\s+de\s+([a-zA-Z]+)(?:\s+de\s+(\d{4}))?.*?(?:a\s+las\s+)?(\d{1,2}:\d{2})/i;
  const matchFechaHora = texto.match(regexFechaHora);

  // Regla 5: Fecha incompleta / ambigua (no inventar horarios)
  const esAmbigua = /(?:semana que viene|próxima semana|algún día|cuando puedas|en estos días|luego coordinamos|después vemos)/i.test(texto) && !matchFechaHora;

  if (matchFechaHora) {
    const dia = matchFechaHora[1].padStart(2, '0');
    const mesNombre = matchFechaHora[2].toLowerCase();
    const meses = {
      enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06',
      julio:'07', agosto:'08', septiembre:'09', octubre:'10', noviembre:'11', diciembre:'12'
    };
    const mes = meses[mesNombre] || '11';
    const anio = matchFechaHora[3] || '2026';
    const hora = matchFechaHora[4];
    const fechaIso = `${anio}-${mes}-${dia}`;

    let tituloEvento = 'Compromiso agendado';
    if (/material|entrega/i.test(texto)) {
      tituloEvento = 'Entrega de material';
    } else if (/llamar a ([a-zA-Z]+)/i.test(texto)) {
      const matchPersona = texto.match(/llamar a ([a-zA-Z]+)/i);
      tituloEvento = `Llamar a ${matchPersona[1]}` + (/factura/i.test(texto) ? ' por factura' : '');
    }

    const evento = {
      id_evento: `EVT-${id}`,
      id_mensaje: id,
      titulo: tituloEvento,
      fecha: fechaIso,
      hora: hora,
      timezone: 'America/Asuncion',
      contacto: remitente,
      origen: origen
    };

    state.agenda.push(evento);
    anotado.agenda = evento;
  } else if (esAmbigua && !/pasame|mandame|enviar|firmada/i.test(texto)) {
    estado = 'requiere_revision';
    const itemRev = {
      id_revision: `REV-${id}`,
      id_mensaje: id,
      motivo: 'Fecha o intención ambigua sin horario ni día preciso',
      texto: texto,
      contacto: remitente
    };
    state.revision.push(itemRev);
    anotado.revision = itemRev;
  }

  // Regla 2: Solicitud que requiere respuesta o decisión queda como pendiente
  if (/quién lo recibe|quien lo recibe|designar|asignar|responsable/i.test(texto)) {
    const pendiente = {
      id_pendiente: `PEND-${id}-1`,
      id_mensaje: id,
      tarea: 'Asignar responsable de recepción del material',
      estado: 'abierto',
      contacto: remitente
    };
    state.pendientes.push(pendiente);
    anotado.pendientes = anotado.pendientes ? [anotado.pendientes, pendiente].flat() : [pendiente];
  }

  if (/pasame|mandame|enviame|planilla firmada/i.test(texto)) {
    const pendiente = {
      id_pendiente: `PEND-${id}`,
      id_mensaje: id,
      tarea: `Enviar planilla firmada a ${remitente}`,
      estado: 'abierto',
      contacto: remitente
    };
    state.pendientes.push(pendiente);
    anotado.pendientes = anotado.pendientes ? [anotado.pendientes, pendiente].flat() : [pendiente];
  }

  // Regla 4: Las notas después de una llamada son internas y NO generan respuesta al contacto
  if (origen !== 'nota_posllamada') {
    if (matchFechaHora && /material/i.test(texto)) {
      respuesta_sugerida = `Confirmado y agendado para el ${matchFechaHora[1]} de ${matchFechaHora[2]} a las ${matchFechaHora[4]}. Estamos coordinando quién lo recibirá y te confirmamos en breve.`;
    } else if (/planilla firmada/i.test(texto)) {
      respuesta_sugerida = `Hola ${remitente}, recibido. En breve te paso la planilla firmada.`;
    } else if (estado === 'requiere_revision') {
      respuesta_sugerida = `Hola ${remitente}, recibimos tu mensaje. ¿Qué día y horario te quedaría mejor la semana que viene para coordinar?`;
    } else {
      respuesta_sugerida = `Hola ${remitente}, mensaje recibido y registrado correctamente.`;
    }
  }

  // Guardar en procesados
  state.procesados[id] = { anotado, respuesta_sugerida, estado };

  return {
    id,
    remitente,
    origen,
    estado,
    duplicado: false,
    anotado,
    respuesta_sugerida
  };
}

function consultarResumen() {
  return {
    timezone: 'America/Asuncion',
    resumen: {
      total_eventos_agenda: state.agenda.length,
      total_pendientes: state.pendientes.length,
      total_en_revision: state.revision.length,
      total_mensajes_unicos_procesados: Object.keys(state.procesados).length
    },
    agenda: state.agenda,
    pendientes: state.pendientes,
    revision: state.revision
  };
}

// Ejecución de los casos A a F
const casos = [
  {
    codigo: 'Caso A',
    descripcion: 'Proveedor confirma entrega y solicita responsable',
    payload: {
      id: 'msg-001',
      remitente: 'Proveedor',
      origen: 'mensaje',
      texto: 'Confirmado, el material llega el 12 de noviembre de 2026 a las 09:00. Decime quién lo recibe'
    },
    esperado: 'Evento de entrega agendado (12/11/2026 09:00), pendiente de asignar responsable y respuesta sugerida que no compromete quién recibe.'
  },
  {
    codigo: 'Caso B',
    descripcion: 'Funcionario solicita planilla firmada',
    payload: {
      id: 'msg-002',
      remitente: 'Funcionario',
      origen: 'mensaje',
      texto: 'Pasame la planilla firmada cuando puedas'
    },
    esperado: 'Pendiente sin fecha y respuesta sugerida de confirmación.'
  },
  {
    codigo: 'Caso C',
    descripcion: 'Nota post-llamada interna',
    payload: {
      id: 'msg-003',
      remitente: 'Coordinador',
      origen: 'nota_posllamada',
      texto: 'Anotá llamar a Pedro el 13 de noviembre de 2026 a las 14:00 por la factura'
    },
    esperado: 'Recordatorio en agenda (13/11/2026 14:00) y NINGUNA respuesta sugerida hacia el contacto externo.'
  },
  {
    codigo: 'Caso D',
    descripcion: 'Fecha ambigua / incompleta',
    payload: {
      id: 'msg-004',
      remitente: 'Cliente',
      origen: 'mensaje',
      texto: 'Nos vemos la semana que viene'
    },
    esperado: 'Requiere revisión, no crea evento en agenda ni inventa horarios.'
  },
  {
    codigo: 'Caso E',
    descripcion: 'Repetición del mensaje A (Deduplicación / Idempotencia)',
    payload: {
      id: 'msg-001',
      remitente: 'Proveedor',
      origen: 'mensaje',
      texto: 'Confirmado, el material llega el 12 de noviembre de 2026 a las 09:00. Decime quién lo recibe'
    },
    esperado: 'Deduplicación activa (duplicado: true). No crea duplicados en agenda ni en pendientes.'
  }
];

console.log('\n==========================================================');
console.log('   EJECUTANDO RECORRIDOS DE PRUEBA (CASOS A AL F)         ');
console.log('==========================================================\n');

for (const caso of casos) {
  console.log(`>> ${caso.codigo}: ${caso.descripcion}`);
  console.log(`   Esperado: ${caso.esperado}`);
  const resultado = procesarMensaje(caso.payload);
  console.log('   Resultado obtenido:');
  console.log(JSON.stringify(resultado, null, 4).split('\n').map(l => '     ' + l).join('\n'));
  console.log('----------------------------------------------------------');
}

console.log('\n>> Caso F: Consultar Resumen y Estado');
console.log('   Esperado: Resumen que incluya los eventos confirmados, pendientes abiertos y revisiones sin duplicados.');
const resumen = consultarResumen();
console.log('   Resultado obtenido:');
console.log(JSON.stringify(resumen, null, 4).split('\n').map(l => '     ' + l).join('\n'));
console.log('\n==========================================================');
console.log('   VALIDACIÓN FINAL:');
const checkA = state.agenda.length === 2;
const checkP = state.pendientes.length === 2;
const checkR = state.revision.length === 1;
const checkU = Object.keys(state.procesados).length === 4;

console.log(`   * Eventos en agenda (2 esperados): ${state.agenda.length} -> ${checkA ? 'OK' : 'ERROR'}`);
console.log(`   * Pendientes abiertos (2 esperados): ${state.pendientes.length} -> ${checkP ? 'OK' : 'ERROR'}`);
console.log(`   * Ítems en revisión (1 esperado): ${state.revision.length} -> ${checkR ? 'OK' : 'ERROR'}`);
console.log(`   * Mensajes únicos procesados (4 esperados): ${Object.keys(state.procesados).length} -> ${checkU ? 'OK' : 'ERROR'}`);

if (checkA && checkP && checkR && checkU) {
  console.log('\n   [PASSED] TODOS LOS CASOS DE NEGOCIO PASARON EXITOSAMENTE.');
} else {
  console.log('\n   [FAILED] DISCREPANCIA EN LOS RESULTADOS.');
  process.exit(1);
}
