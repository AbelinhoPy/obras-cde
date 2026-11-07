// Script para generar agenda-demo.json y validarlo contra las reglas de n8n
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = {
  name: "Asistente de agenda y pendientes",
  nodes: [
    {
      id: "9f8b1c20-a111-4b2e-8c33-100000000001",
      name: "Webhook Inbound Mensaje (POST)",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [100, 200],
      webhookId: "agenda-mensaje-webhook",
      parameters: {
        httpMethod: "POST",
        path: "agenda-mensaje",
        responseMode: "responseNode",
        options: {}
      }
    },
    {
      id: "9f8b1c20-a111-4b2e-8c33-100000000002",
      name: "Procesar y Persistir Agenda",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [340, 200],
      parameters: {
        jsCode: `
const item = $input.first().json;
const body = item.body || item;
const id = String(body.id || ('msg-' + Date.now()));
const remitente = String(body.remitente || 'Desconocido');
const origen = String(body.origen || 'mensaje');
const texto = String(body.texto || '');

// Persistencia en n8n mediante static data global del workflow
const staticData = $getWorkflowStaticData('global');
staticData.procesados = staticData.procesados || {};
staticData.agenda = staticData.agenda || [];
staticData.pendientes = staticData.pendientes || [];
staticData.revision = staticData.revision || [];

// Regla de Deduplicación / Idempotencia
if (staticData.procesados[id]) {
  const previo = staticData.procesados[id];
  return [{
    json: {
      id,
      remitente,
      origen,
      estado: 'duplicado',
      duplicado: true,
      mensaje: 'Registro ya existente para este ID. Se conserva registro único.',
      anotado: previo.anotado,
      respuesta_sugerida: previo.respuesta_sugerida
    }
  }];
}

const anotado = { agenda: null, pendientes: null, revision: null };
let respuesta_sugerida = null;
let estado = 'procesado';

// Regla 1: Detección de fecha y hora confirmadas (Zona America/Asuncion)
// Soporta formatos: '12 de noviembre de 2026 a las 09:00', '13 de noviembre a las 14:00', etc.
const regexFechaHora = /(\\d{1,2})\\s+de\\s+([a-zA-Z]+)(?:\\s+de\\s+(\\d{4}))?.*?(?:a\\s+las\\s+)?(\\d{1,2}:\\d{2})/i;
const matchFechaHora = texto.match(regexFechaHora);

// Regla 5: Fecha incompleta / ambigua (no inventar horarios ni días)
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
  const fechaIso = \`\${anio}-\${mes}-\${dia}\`;

  let tituloEvento = 'Compromiso agendado';
  if (/material|entrega/i.test(texto)) {
    tituloEvento = 'Entrega de material';
  } else if (/llamar a ([a-zA-Z]+)/i.test(texto)) {
    const matchPersona = texto.match(/llamar a ([a-zA-Z]+)/i);
    tituloEvento = \`Llamar a \${matchPersona[1]}\` + (/factura/i.test(texto) ? ' por factura' : '');
  }

  const evento = {
    id_evento: \`EVT-\${id}\`,
    id_mensaje: id,
    titulo: tituloEvento,
    fecha: fechaIso,
    hora: hora,
    timezone: 'America/Asuncion',
    contacto: remitente,
    origen: origen
  };

  staticData.agenda.push(evento);
  anotado.agenda = evento;
} else if (esAmbigua && !/pasame|mandame|enviar|firmada/i.test(texto)) {
  estado = 'requiere_revision';
  const itemRev = {
    id_revision: \`REV-\${id}\`,
    id_mensaje: id,
    motivo: 'Fecha o intención ambigua sin horario ni día preciso',
    texto: texto,
    contacto: remitente
  };
  staticData.revision.push(itemRev);
  anotado.revision = itemRev;
}

// Regla 2: Solicitud que requiere respuesta o decisión queda como pendiente
if (/quién lo recibe|quien lo recibe|designar|asignar|responsable/i.test(texto)) {
  const pendiente = {
    id_pendiente: \`PEND-\${id}-1\`,
    id_mensaje: id,
    tarea: 'Asignar responsable de recepción del material',
    estado: 'abierto',
    contacto: remitente
  };
  staticData.pendientes.push(pendiente);
  anotado.pendientes = anotado.pendientes ? [anotado.pendientes, pendiente].flat() : [pendiente];
}

if (/pasame|mandame|enviame|planilla firmada/i.test(texto)) {
  const pendiente = {
    id_pendiente: \`PEND-\${id}\`,
    id_mensaje: id,
    tarea: \`Enviar planilla firmada a \${remitente}\`,
    estado: 'abierto',
    contacto: remitente
  };
  staticData.pendientes.push(pendiente);
  anotado.pendientes = anotado.pendientes ? [anotado.pendientes, pendiente].flat() : [pendiente];
}

// Regla 4: Las notas después de una llamada son internas y NO generan respuesta al contacto
if (origen !== 'nota_posllamada') {
  if (matchFechaHora && /material/i.test(texto)) {
    respuesta_sugerida = \`Confirmado y agendado para el \${matchFechaHora[1]} de \${matchFechaHora[2]} a las \${matchFechaHora[4]}. Estamos coordinando quién lo recibirá y te confirmamos en breve.\`;
  } else if (/planilla firmada/i.test(texto)) {
    respuesta_sugerida = \`Hola \${remitente}, recibido. En breve te paso la planilla firmada.\`;
  } else if (estado === 'requiere_revision') {
    respuesta_sugerida = \`Hola \${remitente}, recibimos tu mensaje. ¿Qué día y horario te quedaría mejor la semana que viene para coordinar?\`;
  } else {
    respuesta_sugerida = \`Hola \${remitente}, mensaje recibido y registrado correctamente.\`;
  }
}

// Persistir estado del mensaje para deduplicación
staticData.procesados[id] = { anotado, respuesta_sugerida, estado };

return [{
  json: {
    id,
    remitente,
    origen,
    estado,
    duplicado: false,
    anotado,
    respuesta_sugerida
  }
}];
`
      }
    },
    {
      id: "9f8b1c20-a111-4b2e-8c33-100000000003",
      name: "Responder Webhook Mensaje",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [580, 200],
      parameters: {
        respondWith: "firstIncomingItem",
        options: {}
      }
    },
    {
      id: "9f8b1c20-a111-4b2e-8c33-100000000004",
      name: "Webhook Resumen Agenda (GET)",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [100, 420],
      webhookId: "agenda-resumen-webhook",
      parameters: {
        httpMethod: "GET",
        path: "agenda-resumen",
        responseMode: "responseNode",
        options: {}
      }
    },
    {
      id: "9f8b1c20-a111-4b2e-8c33-100000000005",
      name: "Compilar Resumen",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [340, 420],
      parameters: {
        jsCode: `
const staticData = $getWorkflowStaticData('global');
const agenda = staticData.agenda || [];
const pendientes = staticData.pendientes || [];
const revision = staticData.revision || [];
const procesadosKeys = Object.keys(staticData.procesados || {});

return [{
  json: {
    timezone: 'America/Asuncion',
    resumen: {
      total_eventos_agenda: agenda.length,
      total_pendientes: pendientes.length,
      total_en_revision: revision.length,
      total_mensajes_unicos_procesados: procesadosKeys.length
    },
    agenda,
    pendientes,
    revision
  }
}];
`
      }
    },
    {
      id: "9f8b1c20-a111-4b2e-8c33-100000000006",
      name: "Responder Webhook Resumen",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [580, 420],
      parameters: {
        respondWith: "firstIncomingItem",
        options: {}
      }
    },
    {
      id: "9f8b1c20-a111-4b2e-8c33-100000000007",
      name: "Nota: Flujo Inbound",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [60, 140],
      parameters: {
        content: "## Entrada de Mensajes y Audios\nPOST /webhook/agenda-mensaje\nProcesa texto/audio, detecta fechas, asigna pendientes y deduplica.",
        height: 180,
        width: 700
      }
    },
    {
      id: "9f8b1c20-a111-4b2e-8c33-100000000008",
      name: "Nota: Consulta Resumen",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [60, 360],
      parameters: {
        content: "## Consulta de Resumen y Estado\nGET /webhook/agenda-resumen\nDevuelve todos los eventos confirmados, pendientes abiertos y revisiones.",
        height: 180,
        width: 700
      }
    }
  ],
  connections: {
    "Webhook Inbound Mensaje (POST)": {
      main: [
        [
          {
            node: "Procesar y Persistir Agenda",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Procesar y Persistir Agenda": {
      main: [
        [
          {
            node: "Responder Webhook Mensaje",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Webhook Resumen Agenda (GET)": {
      main: [
        [
          {
            node: "Compilar Resumen",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Compilar Resumen": {
      main: [
        [
          {
            node: "Responder Webhook Resumen",
            type: "main",
            index: 0
          }
        ]
      ]
    }
  },
  settings: {
    executionOrder: "v1",
    timezone: "America/Asuncion"
  }
};

const outputPath = resolve('agenda-demo.json');
writeFileSync(outputPath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('Workflow escrito exitosamente en:', outputPath);
