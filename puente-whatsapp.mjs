// puente-whatsapp.mjs - Conexión directa a WhatsApp con Código QR (Baileys) + Neon DB
import makeWASocketPkg, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';

const makeWASocket = makeWASocketPkg.default || makeWASocketPkg;

// 1. Conexión a Neon PostgreSQL
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl && fs.existsSync('.env')) {
  const envText = fs.readFileSync('.env', 'utf8');
  const match = envText.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
  if (match) dbUrl = match[1];
}
const sql = dbUrl ? neon(dbUrl) : null;
const AUTH_DIR = './auth_info_baileys';

// Sincronización de credenciales con Neon PostgreSQL (Persistencia total en la nube)
async function restaurarSesionDesdeDB() {
  if (!sql) return;
  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    const archivosLocales = fs.readdirSync(AUTH_DIR);
    if (archivosLocales.length === 0) {
      console.log('🔄 Verificando sesión de WhatsApp guardada en Neon PostgreSQL...');
      const filas = await sql`SELECT clave, valor FROM whatsapp_sesion`;
      if (filas.length > 0) {
        console.log(`📦 Restaurando ${filas.length} credenciales desde Neon...`);
        for (const fila of filas) {
          fs.writeFileSync(path.join(AUTH_DIR, fila.clave), fila.valor, 'utf8');
        }
        console.log('✅ Sesión restaurada con éxito desde la nube.');
      }
    }
  } catch (err) {
    console.warn('Aviso al restaurar sesión desde DB:', err.message);
  }
}

async function respaldarSesionHaciaDB() {
  if (!sql) return;
  try {
    if (!fs.existsSync(AUTH_DIR)) return;
    const archivos = fs.readdirSync(AUTH_DIR);
    for (const arch of archivos) {
      const contenido = fs.readFileSync(path.join(AUTH_DIR, arch), 'utf8');
      await sql`
        INSERT INTO whatsapp_sesion (clave, valor, actualizado_en)
        VALUES (${arch}, ${contenido}, NOW())
        ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()
      `;
    }
  } catch (err) {
    console.warn('Aviso respaldando sesión en DB:', err.message);
  }
}

async function limpiarSesionEnDB() {
  if (!sql) return;
  try {
    await sql`TRUNCATE TABLE whatsapp_sesion`;
    console.log('🗑️ Sesión eliminada de Neon PostgreSQL');
  } catch (err) {
    console.warn('Error al limpiar sesión en DB:', err.message);
  }
}

// 2. Estado Global
let qrCodeRaw = null;
let qrCodeDataURL = null;
let sock = null;
let usuarioConectado = null;
let estadoConexion = 'iniciando'; // 'iniciando', 'esperando_qr', 'conectado', 'cerrado'
let historialEventos = [];

// 3. Servidor Web Local para ver el QR y Estado (Puerto 3000)
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  // Endpoint de ping / anti-hibernación (para Render 24/7)
  if (req.url === '/api/ping' || req.url === '/ping') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, bot: 'despierto_24_7', hora: new Date().toISOString() }));
  }

  // API para consultar estado y QR desde el frontend del sistema web
  if (req.url === '/api/estado-qr' || req.url === '/api/estado') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') return res.end();
    return res.end(JSON.stringify({
      estado: estadoConexion,
      qrDataURL: qrCodeDataURL,
      usuario: usuarioConectado ? {
        id: (usuarioConectado.id || '').split(':')[0],
        name: usuarioConectado.name || 'WhatsApp Business'
      } : null,
      historial: historialEventos
    }));
  }

  // API interna para simular mensaje desde la web
  if (req.url.startsWith('/api/simular') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { texto, remitente } = JSON.parse(body);
        const resultado = await procesarMensaje(texto, '595983000111', remitente || 'Prueba Web');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, resultado }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API para desvincular
  if (req.url === '/api/desvincular' && req.method === 'POST') {
    if (sock) {
      await sock.logout();
    }
    await limpiarSesionEnDB();
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    estadoConexion = 'esperando_qr';
    usuarioConectado = null;
    qrCodeRaw = null;
    qrCodeDataURL = null;
    iniciarWhatsApp();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Página HTML Principal
  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Puente WhatsApp - Sistema Obras CDE</title>
  <style>
    :root {
      --bg: #090a0f;
      --card: #11141f;
      --border: #232938;
      --primary: #3b82f6;
      --green: #10b981;
      --amber: #f59e0b;
      --text: #f8fafc;
      --subtext: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
    }
    .header h1 { font-size: 22px; margin-bottom: 6px; }
    .header p { color: var(--subtext); font-size: 13px; }
    .container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      max-width: 900px;
      width: 100%;
    }
    @media (max-width: 768px) { .container { grid-template-columns: 1fr; } }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .badge-amber { background: rgba(245, 158, 11, 0.15); color: var(--amber); border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-green { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .qr-box {
      background: #fff;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }
    .qr-box img { width: 220px; height: 220px; display: block; }
    .steps {
      text-align: left;
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.6;
      background: #090a0f;
      padding: 14px;
      border-radius: 6px;
      width: 100%;
      margin-top: 10px;
      border: 1px solid #1a202c;
    }
    .steps ol { padding-left: 18px; }
    .btn {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    .btn-danger { background: #ef4444; }
    .btn:hover { opacity: 0.9; }
    .feed {
      width: 100%;
      text-align: left;
      font-size: 12px;
      max-height: 340px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .feed-item {
      background: #090a0f;
      border: 1px solid var(--border);
      padding: 10px;
      border-radius: 6px;
    }
    .feed-time { font-size: 10px; color: var(--subtext); margin-bottom: 3px; }
    .feed-title { font-weight: 600; color: #fff; }
    .feed-desc { color: #cbd5e1; margin-top: 2px; }
    .simulador-form {
      display: flex;
      gap: 6px;
      width: 100%;
      margin-top: 12px;
    }
    .simulador-input {
      flex: 1;
      background: #090a0f;
      border: 1px solid var(--border);
      color: #fff;
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 12px;
    }
  </style>
  ${estadoConexion === 'esperando_qr' ? '<script>setTimeout(() => location.reload(), 4000);</script>' : ''}
</head>
<body>

  <div class="header">
    <h1>Puente WhatsApp &amp; Base de Datos Neon</h1>
    <p>Conexión directa vía Código QR para obras de Ciudad del Este</p>
  </div>

  <div class="container">
    
    <!-- COLUMNA 1: ESTADO / QR -->
    <div class="card">
      ${estadoConexion === 'conectado' ? `
        <span class="badge badge-green">🟢 WHATSAPP VINCULADO &amp; ACTIVO</span>
        <h3 style="margin-bottom: 8px;">Conectado como:</h3>
        <p style="font-size: 18px; font-weight: 700; color: #10b981; font-family: monospace; margin-bottom: 6px;">
          +${(usuarioConectado?.id || '').split(':')[0]}
        </p>
        <p style="font-size: 12px; color: var(--subtext); margin-bottom: 20px;">
          Sesión guardada en <code>./auth_info_baileys/</code>
        </p>

        <div style="background: #090a0f; border: 1px solid #1a202c; border-radius: 6px; padding: 12px; width: 100%; text-align: left; font-size: 12px; margin-bottom: 16px;">
          <div style="color: #94a3b8; margin-bottom: 4px;">Base de Datos:</div>
          <div style="font-weight: 600; color: #38bdf8;">Neon PostgreSQL (En Vivo)</div>
          <div style="color: #94a3b8; margin-top: 8px; margin-bottom: 4px;">Sistema Web:</div>
          <a href="https://abelinhopy.github.io/obras-cde/" target="_blank" style="color: #3b82f6; text-decoration: none;">
            abelinhopy.github.io/obras-cde/ ↗
          </a>
        </div>

        <button class="btn btn-danger" onclick="desvincular()">Desvincular WhatsApp</button>
      ` : `
        <span class="badge badge-amber">🟡 ESPERANDO ESCANEO DE QR</span>
        
        ${qrCodeDataURL ? `
          <div class="qr-box">
            <img src="${qrCodeDataURL}" alt="Código QR WhatsApp">
          </div>
        ` : `
          <div style="padding: 40px; color: var(--subtext); font-size: 13px;">
            Generando código QR seguro...
          </div>
        `}

        <div class="steps">
          <strong>Pasos para vincular con tu celular:</strong>
          <ol>
            <li>Abre <strong>WhatsApp</strong> en tu teléfono</li>
            <li>Toca los <strong>3 puntos</strong> (o Ajustes) &gt; <strong>Dispositivos vinculados</strong></li>
            <li>Toca <strong>Vincular un dispositivo</strong> y apunta tu cámara a este código QR</li>
          </ol>
        </div>
      `}
    </div>

    <!-- COLUMNA 2: MONITOR DE MENSAJES Y ACCIONES -->
    <div class="card" style="align-items: stretch; text-align: left;">
      <h3 style="margin-bottom: 6px; font-size: 15px;">Registro de Actividad en Vivo</h3>
      <p style="font-size: 11px; color: var(--subtext); margin-bottom: 14px;">
        Mensajes recibidos por WhatsApp que disparan inserciones en Neon
      </p>

      <div class="feed" id="feedEventos">
        ${historialEventos.length === 0 ? `
          <div style="text-align: center; color: var(--subtext); padding: 30px 10px;">
            Sin actividad reciente aún.<br>Envía un WhatsApp o prueba el simulador abajo.
          </div>
        ` : historialEventos.map(ev => `
          <div class="feed-item">
            <div class="feed-time">${ev.hora} • ${ev.remitente}</div>
            <div class="feed-title">${ev.icono} ${ev.titulo}</div>
            <div class="feed-desc">${ev.detalle}</div>
          </div>
        `).join('')}
      </div>

      <div style="margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px;">
        <label style="font-size: 11px; color: var(--subtext);">Simulador de Mensaje (Prueba rápida):</label>
        <div class="simulador-form">
          <input type="text" id="txtSimular" class="simulador-input" placeholder="ej. Vale de 150 mil para Carlos Cabrera" value="Vale de 150 mil para Carlos Cabrera">
          <button class="btn" onclick="probarSimulacion()">Probar</button>
        </div>
      </div>
    </div>

  </div>

  <script>
    async function probarSimulacion() {
      const texto = document.getElementById('txtSimular').value;
      if (!texto) return;
      const res = await fetch('/api/simular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto, remitente: 'Simulador Local' })
      });
      location.reload();
    }

    async function desvincular() {
      if (!confirm('¿Deseas desvincular la sesión de WhatsApp actual?')) return;
      await fetch('/api/desvincular', { method: 'POST' });
      location.reload();
    }
  </script>
</body>
</html>
  `;

  res.end(html);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================================');
  console.log(`🚀 SERVIDOR DE WHATSAPP INICIADO EN PUERTO ${PORT}`);
  console.log(`👉 Abre en tu navegador: http://localhost:${PORT}`);
  console.log('========================================================');
});

// Mecanismo Anti-Hibernación Automático (Render / Cloud 24/7)
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
if (EXTERNAL_URL) {
  console.log(`⏰ Anti-hibernación activado: auto-ping a ${EXTERNAL_URL} cada 9 minutos`);
  setInterval(async () => {
    try {
      const pingUrl = EXTERNAL_URL.replace(/\/$/, '') + '/api/ping';
      const r = await fetch(pingUrl);
      console.log(`📡 [Keep-Alive] Señal enviada a ${pingUrl} - Status: ${r.status}`);
    } catch (e) {
      console.warn('Aviso en keep-alive ping:', e.message);
    }
  }, 9 * 60 * 1000); // Cada 9 minutos (antes de los 15 min de Render)
}

// 4. Procesamiento Inteligente de Mensajes hacia Neon
async function procesarMensaje(textoOriginal, remitenteId, remitenteNombre) {
  // Normalizar a minúsculas y sin tildes para máxima precisión
  const textoRaw = (textoOriginal || '').toLowerCase();
  const texto = textoRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let resultado = null;

  console.log(`\n📩 Mensaje recibido de ${remitenteNombre} (${remitenteId}): "${textoOriginal}"`);

  // ==========================================
  // CASO 1: Vales / Adelantos de Funcionarios
  // ==========================================
  if (texto.includes('vale') || texto.includes('adelanto') || texto.includes('retiró') || texto.includes('retiro') || texto.includes('anticipo')) {
    let monto = 150000;
    const matchMil = texto.match(/(\d+)\s*(?:mil|k)/i);
    const matchGs = texto.match(/(\d[\d\.\,]*)\s*(?:gs|guaranies|\$)?/i);
    if (matchMil) {
      monto = parseInt(matchMil[1]) * 1000;
    } else if (matchGs && parseInt(matchGs[1].replace(/\./g, '')) > 1000) {
      monto = parseInt(matchGs[1].replace(/\./g, ''));
    }

    // Buscar personal en Neon
    let personalId = 4; // Carlos Cabrera default
    let personalNombre = 'Carlos Cabrera';
    if (sql) {
      try {
        const pers = await sql`SELECT id, nombre FROM personales`;
        const encontrado = pers.find(p => texto.includes(p.nombre.toLowerCase().split(' ')[0]));
        if (encontrado) {
          personalId = encontrado.id;
          personalNombre = encontrado.nombre;
        }
      } catch (e) {
        console.warn('Error buscando personal:', e.message);
      }
    }

    if (sql) {
      await sql`
        INSERT INTO asistencias_vales (personal_id, obra_id, fecha, estado, vale_adelanto, observacion)
        VALUES (${personalId}, 1, CURRENT_DATE, 'presente', ${monto}, ${'WhatsApp: ' + textoOriginal})
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES (${remitenteNombre || remitenteId}, 'asistencia_vale', ${textoOriginal}, ${'Registrado vale de ' + monto.toLocaleString('es-PY') + ' Gs. para ' + personalNombre})
      `;
    }

    resultado = {
      tipo: 'vale_asistencia',
      icono: '💰',
      titulo: 'Vale de Personal Registrado',
      detalle: `${personalNombre}: ${monto.toLocaleString('es-PY')} Gs. a descontar el sábado.`,
      respuestaWhatsApp: `✅ *VALE REGISTRADO EN SISTEMA OBRAS CDE*\n\n👤 *Funcionario:* ${personalNombre}\n💵 *Monto:* ${monto.toLocaleString('es-PY')} Gs.\n📅 *Fecha:* ${new Date().toLocaleDateString('es-PY')}\n\nQuedó asentado en la base de datos para la liquidación del sábado.`
    };
  }

  // ==========================================
  // CASO 2: Reserva de Bobcat
  // ==========================================
  else if (texto.includes('bobcat') || texto.includes('pala') || texto.includes('nivelar') || texto.includes('limpieza de terreno') || texto.includes('maquinaria')) {
    let horas = 4;
    const matchHs = texto.match(/(\d+)\s*(?:hs|hora|horas)/i);
    if (matchHs) horas = parseInt(matchHs[1]);

    let zona = 'Ciudad del Este';
    if (texto.includes('km 8') || texto.includes('km8')) zona = 'Km 8 Acaray, CDE';
    else if (texto.includes('km 10') || texto.includes('km10')) zona = 'Km 10 Monday, CDE';
    else if (texto.includes('hernandarias')) zona = 'Hernandarias';
    else if (texto.includes('franco')) zona = 'Presidente Franco';
    else if (texto.includes('minga')) zona = 'Minga Guazú';

    const tarifaHora = 250000;
    const flete = 250000;
    const total = (horas * tarifaHora) + flete;

    if (sql) {
      await sql`
        INSERT INTO bobcat_servicios (cliente, telefono_cliente, zona_destino, fecha_servicio, horas_pactadas, tarifa_hora, costo_traslado, total_facturado, estado)
        VALUES (${remitenteNombre || 'Cliente WhatsApp'}, ${remitenteId.replace(/[^0-9]/g, '')}, ${zona}, ${new Date().toISOString()}, ${horas}, ${tarifaHora}, ${flete}, ${total}, 'agendado')
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES (${remitenteNombre || remitenteId}, 'reserva_bobcat', ${textoOriginal}, ${'Bobcat agendada en ' + zona + ' (' + horas + ' hs)'})
      `;
    }

    resultado = {
      tipo: 'reserva_bobcat',
      icono: '🚜',
      titulo: 'Servicio Bobcat Agendado',
      detalle: `${remitenteNombre || 'Cliente'} en ${zona} (${horas} hs pactadas). Total: ${total.toLocaleString('es-PY')} Gs.`,
      respuestaWhatsApp: `🚜 *RESERVA DE BOBCAT AGENDADA*\n\n📍 *Zona:* ${zona}\n⏱️ *Horas pactadas:* ${horas} horas\n🚛 *Flete traslado:* 250.000 Gs.\n💵 *Total estimado:* ${total.toLocaleString('es-PY')} Gs.\n👷 *Operador asignado:* Ramón\n\nEl servicio ya figura en la agenda del operador.`
    };
  }

  // ==========================================
  // CASO 3: Cierre de Horómetro Ramón
  // ==========================================
  else if (texto.includes('horometro') || texto.includes('horómetro') || (texto.includes('ramon') && texto.includes('hora')) || (texto.includes('trabajé') && texto.includes('hora'))) {
    let horasReales = 5;
    const matchHs = texto.match(/(\d+)\s*(?:hs|hora|horas)/i);
    if (matchHs) horasReales = parseInt(matchHs[1]);

    const total = (horasReales * 250000) + 250000;

    if (sql) {
      await sql`
        UPDATE bobcat_servicios
        SET horas_reales = ${horasReales}, total_facturado = ${total}, estado = 'finalizado_cobrado', notas_operador = ${'Cierre por WhatsApp: ' + textoOriginal}
        WHERE id = (SELECT id FROM bobcat_servicios WHERE estado = 'agendado' ORDER BY id ASC LIMIT 1)
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES (${remitenteNombre || 'Operador Ramón'}, 'horas_ramon', ${textoOriginal}, ${'Ramón cerró ' + horasReales + ' hs. Total cobrado: ' + total.toLocaleString('es-PY') + ' Gs.'})
      `;
    }

    resultado = {
      tipo: 'cierre_horas_ramon',
      icono: '⏱️',
      titulo: 'Horómetro de Ramón Liquidado',
      detalle: `${horasReales} horas reales trabajadas. Cobrado: ${total.toLocaleString('es-PY')} Gs.`,
      respuestaWhatsApp: `✅ *HORAS DE OPERADOR LIQUIDADAS*\n\n🚜 *Horómetro real:* ${horasReales} horas\n💰 *Total facturado y cobrado:* ${total.toLocaleString('es-PY')} Gs.\n\nEl servicio quedó asentado como finalizado y conciliado.`
    };
  }

  // ==========================================
  // CASO 4: Llegada de Materiales
  // ==========================================
  else if (texto.includes('cemento') || texto.includes('varilla') || texto.includes('hierro') || texto.includes('arena') || texto.includes('descargó') || texto.includes('llegó')) {
    let material = 'Materiales Varios';
    if (texto.includes('cemento')) material = 'Cemento Yguazú';
    else if (texto.includes('varilla') || texto.includes('hierro')) material = 'Varillas de Hierro';
    else if (texto.includes('arena')) material = 'Arena Lavada';

    let cantidad = '1 carga completa';
    const matchCant = texto.match(/(\d+[\d\.\,]*)\s*(?:bolsas|kg|kilos|tn|toneladas|m3|metros)?/i);
    if (matchCant) cantidad = matchCant[0];

    if (sql) {
      await sql`
        INSERT INTO materiales (obra_id, material, cantidad, proveedor, fecha_entrega, responsable_recepcion, estado)
        VALUES (1, ${material}, ${cantidad}, 'Distribuidora Alto Paraná', NOW(), ${remitenteNombre || 'Encargado'}, 'recibido')
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES (${remitenteNombre || remitenteId}, 'material_recepcion', ${textoOriginal}, ${'Recepción confirmada: ' + cantidad + ' de ' + material})
      `;
    }

    resultado = {
      tipo: 'recepcion_material',
      icono: '🧱',
      titulo: 'Carga de Material Recibida',
      detalle: `${material} (${cantidad}) asentado en Edificio Km 8.`,
      respuestaWhatsApp: `📦 *RECEPCIÓN DE MATERIAL CONFIRMADA*\n\n🧱 *Material:* ${material}\n⚖️ *Cantidad:* ${cantidad}\n📅 *Fecha y hora:* ${new Date().toLocaleTimeString('es-PY')}\n\nSe actualizó el inventario en el sistema.`
    };
  }

  // ==========================================
  // CASO 5: Bitácora de Campo (Clima, Fotos, Ferretería, Incidencias)
  // ==========================================
  else if (texto.includes('lluv') || texto.includes('llov') || texto.includes('susp') || texto.includes('paro') || texto.includes('parada') || texto.includes('compr') || texto.includes('ferret') || texto.includes('foto') || texto.includes('retras') || texto.includes('inciden') || texto.includes('nota') || texto.includes('bitacor') || texto.includes('posterg')) {
    let categoria = 'general';
    let monto = 0;
    if (texto.includes('lluv') || texto.includes('llov') || texto.includes('susp') || texto.includes('paro') || texto.includes('parada') || texto.includes('clima') || texto.includes('posterg')) {
      categoria = 'clima';
    } else if (texto.includes('compr') || texto.includes('ferret')) {
      categoria = 'compra_imprevista';
      const matchMil = texto.match(/(\d+)\s*(?:mil|k)/i);
      const matchGs = texto.match(/(\d[\d\.\,]*)/);
      if (matchMil) monto = parseInt(matchMil[1]) * 1000;
      else if (matchGs && parseInt(matchGs[1].replace(/\./g, '')) > 1000) monto = parseInt(matchGs[1].replace(/\./g, ''));
    } else if (texto.includes('foto')) {
      categoria = 'foto_pendiente';
    } else if (texto.includes('retraso') || texto.includes('incidencia') || texto.includes('problema')) {
      categoria = 'incidencia';
    }

    if (sql) {
      await sql`
        INSERT INTO bitacora_obras (obra_id, categoria, nota, autor, monto_imprevisto)
        VALUES (1, ${categoria}, ${textoOriginal}, ${remitenteNombre || 'WhatsApp'}, ${monto})
      `;
      await sql`
        INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
        VALUES (${remitenteNombre || remitenteId}, 'nota_bitacora', ${textoOriginal}, ${'Bitácora (' + categoria + '): ' + textoOriginal.substring(0, 40)})
      `;
    }

    resultado = {
      tipo: 'nota_bitacora',
      icono: '📝',
      titulo: 'Nota en Bitácora de Obra',
      detalle: `[${categoria}] ${textoOriginal} ${monto > 0 ? `(${monto.toLocaleString('es-PY')} Gs.)` : ''}`,
      respuestaWhatsApp: `📝 *REGISTRO EN BITÁCORA DE CAMPO*\n\n📌 *Categoría:* ${categoria.toUpperCase()}\n📄 *Novedad:* ${textoOriginal}\n${monto > 0 ? `💵 *Gasto Imprevisto:* ${monto.toLocaleString('es-PY')} Gs.\n` : ''}👤 *Reportado por:* ${remitenteNombre || 'WhatsApp'}\n\nEl Ingeniero ya tiene la novedad en su pantalla y agenda.`
    };
  }

  // ==========================================
  // CASO 6: Mensaje de Ayuda / Menú
  // ==========================================
  else {
    resultado = {
      tipo: 'ayuda',
      icono: '💬',
      titulo: 'Consulta / Ayuda',
      detalle: `Mensaje: "${textoOriginal}"`,
      respuestaWhatsApp: `👋 *¡Hola! Soy el Asistente Digital de Obras CDE.*\n\nPuedes reportarme novedades escribiendo normalmente:\n\n1️⃣ *Vales:* "Vale de 150 mil para Carlos Cabrera"\n2️⃣ *Bobcat:* "Agendar Bobcat para 4 horas en Km 10"\n3️⃣ *Horómetro:* "Ramón trabajó 5 horas hoy"\n4️⃣ *Materiales:* "Llegaron 200 bolsas de cemento"\n5️⃣ *Bitácora:* "Llovió mucho, se suspendió la losa" o "Se compró 10 discos de corte (180 mil)"\n\nTodo se guarda automáticamente en la base de datos.`
    };
  }

  if (resultado) {
    historialEventos.unshift({
      hora: new Date().toLocaleTimeString('es-PY'),
      remitente: remitenteNombre || remitenteId,
      icono: resultado.icono,
      titulo: resultado.titulo,
      detalle: resultado.detalle
    });
    if (historialEventos.length > 20) historialEventos.pop();
  }

  return resultado;
}

// 5. Motor de Baileys para Conexión con WhatsApp
async function iniciarWhatsApp() {
  try {
    await restaurarSesionDesdeDB();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false
    });

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      await respaldarSesionHaciaDB();
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeRaw = qr;
        qrCodeDataURL = await QRCode.toDataURL(qr, { scale: 8 });
        estadoConexion = 'esperando_qr';

        console.log('\n========================================================');
        console.log('📲 CÓDIGO QR GENERADO. ESCANÉALO CON TU WHATSAPP:');
        console.log('👉 O abre http://localhost:3000 para verlo en pantalla');
        console.log('========================================================\n');
        qrcodeTerminal.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`⚠️ Conexión cerrada (Código: ${statusCode}). Reconectando: ${shouldReconnect}`);
        estadoConexion = 'cerrado';
        if (shouldReconnect) {
          setTimeout(iniciarWhatsApp, 3000);
        } else {
          estadoConexion = 'esperando_qr';
        }
      } else if (connection === 'open') {
        estadoConexion = 'conectado';
        usuarioConectado = sock.user;
        const num = (usuarioConectado?.id || '').split(':')[0];
        console.log('\n========================================================');
        console.log(`🎉 ¡WHATSAPP CONECTADO CON ÉXITO!`);
        console.log(`📱 Número activo: +${num}`);
        console.log(`💻 Monitor web en vivo: http://localhost:3000`);
        console.log('========================================================\n');
      }
    });

    // Escuchar mensajes entrantes
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue; // No procesar mensajes propios

        const remitenteId = msg.key.remoteJid;
        if (!remitenteId || remitenteId.includes('@g.us')) continue; // Ignorar grupos por ahora

        const remitenteNombre = msg.pushName || 'Contacto WhatsApp';
        const textoOriginal = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              '';

        if (!textoOriginal.trim()) continue;

        // Procesar e insertar en Neon
        const resultado = await procesarMensaje(textoOriginal, remitenteId, remitenteNombre);

        // Responder automáticamente por WhatsApp
        if (resultado && resultado.respuestaWhatsApp) {
          try {
            await sock.sendMessage(remitenteId, { text: resultado.respuestaWhatsApp });
            console.log(`📤 Respuesta automática enviada a ${remitenteNombre}`);
          } catch (err) {
            console.error('Error enviando respuesta WhatsApp:', err.message);
          }
        }
      }
    });

  } catch (err) {
    console.error('Error inicializando Baileys:', err);
    setTimeout(iniciarWhatsApp, 5000);
  }
}

// Iniciar WhatsApp
iniciarWhatsApp();
