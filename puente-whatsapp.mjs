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
let qrTimestamp = null;
let sock = null;
let usuarioConectado = null;
let estadoConexion = 'iniciando'; // 'iniciando', 'esperando_qr', 'conectado', 'cerrado'
let historialEventos = [];
let reiniciandoSocket = false;

// Reiniciar socket limpiamente
async function resetearSocket(limpiarCredenciales = false) {
  if (reiniciandoSocket) return;
  reiniciandoSocket = true;
  try {
    if (sock) {
      try {
        sock.ev?.removeAllListeners();
        sock.end?.(undefined);
      } catch (e) {}
      sock = null;
    }
    if (limpiarCredenciales && !usuarioConectado) {
      try {
        if (fs.existsSync(AUTH_DIR)) {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        }
      } catch (e) {}
    }
    qrCodeRaw = null;
    qrCodeDataURL = null;
    qrTimestamp = null;
    estadoConexion = 'esperando_qr';
    await iniciarWhatsApp();
  } catch (err) {
    console.error('Error al resetear socket:', err.message);
  } finally {
    reiniciandoSocket = false;
  }
}

// 3. Servidor Web Local para ver el QR y Estado (Puerto 3000)
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  // Endpoint de ping / anti-hibernación (para Render 24/7)
  if (req.url === '/api/ping' || req.url === '/ping') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, bot: 'despierto_24_7', hora: new Date().toISOString() }));
  }

  // Forzar regeneración fresca de QR
  if (req.url === '/api/refrescar-qr') {
    res.setHeader('Content-Type', 'application/json');
    if (!usuarioConectado) {
      resetearSocket(true);
      return res.end(JSON.stringify({ ok: true, mensaje: 'Regenerando código QR limpio...' }));
    } else {
      return res.end(JSON.stringify({ ok: true, mensaje: 'Ya conectado', estado: 'conectado' }));
    }
  }

  // Vincular por código de 8 dígitos (Pairing Code) sin necesidad de cámara
  if (req.url === '/api/pairing-code' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { telefono } = JSON.parse(body);
        let num = (telefono || '').replace(/[^0-9]/g, '');
        if (num.startsWith('09')) {
          num = '595' + num.substring(1);
        } else if (num.startsWith('9') && num.length === 9) {
          num = '595' + num;
        }
        if (!num || num.length < 9) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: 'Número inválido. Ejemplo: 0983123456 o 595983123456' }));
        }

        if (!sock) {
          await resetearSocket(true);
          await new Promise(r => setTimeout(r, 1500));
        }

        if (usuarioConectado) {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ ok: false, error: 'El dispositivo ya está vinculado y activo.' }));
        }

        const codigo = await sock.requestPairingCode(num);
        console.log(`🔑 Código de vinculación generado para ${num}: ${codigo}`);
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ok: true, codigo }));
      } catch (e) {
        console.error('Error generando pairing code:', e.message);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API para consultar estado y QR desde el frontend del sistema web
  if (req.url === '/api/estado-qr' || req.url === '/api/estado') {
    // Si el QR tiene más de 45 segundos sin escanearse y no está conectado, auto-resetear para que no quede pegado
    if (qrTimestamp && (Date.now() - qrTimestamp > 45000) && !usuarioConectado) {
      console.log('⏰ QR expirado (>45s). Auto-refrescando socket para mantenerlo fresco...');
      qrCodeDataURL = null;
      qrTimestamp = null;
      resetearSocket(true);
    }

    const segundosRestantes = qrTimestamp ? Math.max(0, Math.round((45000 - (Date.now() - qrTimestamp)) / 1000)) : 0;

    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      estado: estadoConexion,
      qrDataURL: qrCodeDataURL,
      qrSegundosRestantes: segundosRestantes,
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
  const textoRaw = (textoOriginal || '').toLowerCase().trim();
  const texto = textoRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let resultado = null;

  console.log(`\n📩 Mensaje recibido de ${remitenteNombre} (${remitenteId}): "${textoOriginal}"`);

  // ========================================================
  // DETECCIÓN DE INTENCIÓN Y LENGUAJE NATURAL
  // ========================================================
  const esTransaccion = texto.includes('vale') || texto.includes('adelanto') || texto.includes('retiro') || texto.includes('anticipo') ||
                        texto.includes('bobcat') || texto.includes('pala') || texto.includes('maquinaria') || texto.includes('nivelar') ||
                        ((texto.includes('llego') || texto.includes('llegaron') || texto.includes('descarg') || texto.includes('recib') || texto.includes('vino')) && (texto.includes('cemento') || texto.includes('varilla') || texto.includes('hierro') || texto.includes('arena') || texto.includes('bolsa'))) ||
                        texto.includes('lluv') || texto.includes('llov') || texto.includes('compr') || texto.includes('ferret') || texto.includes('horometro') ||
                        texto.includes('cuanto') || texto.includes('saldo') || texto.includes('resumen') || texto.includes('como vamos');

  const esSaludoPuro = /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|que tal|como andas|como estas|mbaeichapa|epaa|que onda|hola amigo|buenas amigo)/i.test(texto) && !esTransaccion && texto.split(' ').length <= 4;

  const esCharlaCorta = /^(todo bien|bien|tranquilo|tranqui|aca andamos|bien bien|todo legal|todo en orden|por suerte bien|bien y vos|bien y tu|legalmente bien)/i.test(texto) && !esTransaccion && texto.split(' ').length <= 5;
  const esAgradecimiento = (texto.includes('gracias') || texto.includes('agradecido') || texto.includes('valeu')) && !esTransaccion;
  const esConfirmacion = /^(ok|dale|bueno|perfecto|impecable|excelente|de una|genial|listo|ta|entendido)[\s\!\?\.]*$/i.test(texto) && !esTransaccion;
  const esPreguntaIdentidad = (texto.includes('quien sos') || texto.includes('que sos') || texto.includes('que haces') || texto.includes('para que servis') || texto.includes('como te llamas'));

  // ========================================================
  // 1. SALUDOS NATURALES Y REACTIVOS (SIN MENÚS NI DISCURSOS)
  // ========================================================
  if (esSaludoPuro && !esTransaccion) {
    let resp = '';
    if (texto.includes('mbaeichapa')) {
      resp = `¡Iporã! ¿Mba'éichapa nde?`;
    } else if (texto.includes('buen dia') || texto.includes('buenos dias')) {
      resp = '¡Hola! Buen día, ¿qué tal?';
    } else if (texto.includes('buenas tardes')) {
      resp = '¡Buenas tardes! ¿Qué tal?';
    } else if (texto.includes('buenas noches')) {
      resp = '¡Buenas noches! ¿Qué tal?';
    } else {
      const hora = new Date().getHours();
      let saludoMomento = 'Buen día';
      if (hora >= 12 && hora < 19) saludoMomento = 'Buenas tardes';
      else if (hora >= 19 || hora < 5) saludoMomento = 'Buenas noches';
      resp = `¡Hola! ${saludoMomento}, ¿qué tal?`;
    }

    resultado = {
      tipo: 'conversacion_saludo',
      icono: '👋',
      titulo: 'Saludo',
      detalle: `${remitenteNombre}`,
      respuestaWhatsApp: resp
    };
  }

  // ========================================================
  // 2. RESPUESTAS DE CORTESÍA / CHARLA CASUAL
  // ========================================================
  else if (esCharlaCorta && !esTransaccion) {
    resultado = {
      tipo: 'conversacion_cortesia',
      icono: '😊',
      titulo: 'Cortesía',
      detalle: `${remitenteNombre}`,
      respuestaWhatsApp: '¡Qué bueno! Me alegro. Avisame cualquier cosa que necesites.'
    };
  }
  else if (esAgradecimiento && !esTransaccion) {
    resultado = {
      tipo: 'conversacion_agradecimiento',
      icono: '🙏',
      titulo: 'Agradecimiento',
      detalle: `${remitenteNombre}`,
      respuestaWhatsApp: '¡De nada! A las órdenes.'
    };
  }
  else if (esConfirmacion && !esTransaccion) {
    resultado = {
      tipo: 'conversacion_confirmacion',
      icono: '👍',
      titulo: 'Confirmación',
      detalle: `${remitenteNombre}`,
      respuestaWhatsApp: 'Dale, impecable.'
    };
  }
  else if (esPreguntaIdentidad && !esTransaccion) {
    resultado = {
      tipo: 'conversacion_identidad',
      icono: '🤖',
      titulo: 'Identidad',
      detalle: `${remitenteNombre}`,
      respuestaWhatsApp: 'Soy tu asistente para las obras. Te anoto los vales de la gente, horas de la Bobcat, materiales que llegan y notas de bitácora, o te paso saldos cuando me preguntes.'
    };
  }

  // ========================================================
  // 3. CONSULTAS DE SALDOS, PLANILLA Y RESUMEN GENERAL
  // ========================================================
  else if (texto.includes('cuanto') || texto.includes('saldo') || texto.includes('resumen') || texto.includes('como vamos') || texto.includes('quien') || texto.includes('quienes') || texto.includes('debo')) {
    let respuesta = 'Todo en orden por las obras.';
    try {
      if (sql) {
        // Buscar si pregunta por una persona en particular
        const pers = await sql`SELECT id, nombre, jornal_diario FROM personales`;
        const personaBuscada = pers.find(p => texto.includes(p.nombre.toLowerCase().split(' ')[0]));

        if (personaBuscada) {
          const valesRows = await sql`SELECT COALESCE(SUM(vale_adelanto), 0) as total_vales FROM asistencias_vales WHERE personal_id = ${personaBuscada.id}`;
          const valesTotal = Number(valesRows[0]?.total_vales || 0);
          const jornalEstimado = Number(personaBuscada.jornal_diario || 130000) * 6; // 6 días semana
          const neto = Math.max(0, jornalEstimado - valesTotal);

          respuesta = `${personaBuscada.nombre} tiene anotados ${valesTotal.toLocaleString('es-PY')} Gs. en vales esta semana. Su neto para el sábado queda en aprox. ${neto.toLocaleString('es-PY')} Gs.`;
        } else {
          // Resumen general de la semana
          const valesGen = await sql`SELECT COALESCE(SUM(vale_adelanto), 0) as total FROM asistencias_vales`;
          const bobcatGen = await sql`SELECT COALESCE(SUM(total_facturado), 0) as total FROM bobcat_servicios WHERE estado = 'finalizado_cobrado'`;
          const obrasActivas = await sql`SELECT COUNT(*) as total FROM obras`;

          const totalV = Number(valesGen[0]?.total || 0).toLocaleString('es-PY');
          const totalB = Number(bobcatGen[0]?.total || 0).toLocaleString('es-PY');
          const cantObras = obrasActivas[0]?.total || 0;

          respuesta = `Así viene la semana:\n• Vales a descontar: ${totalV} Gs.\n• Facturado Bobcat: ${totalB} Gs.\n• Frentes activos: ${cantObras}`;
        }
      }
    } catch (e) {
      respuesta = 'Hasta ahora tenemos los vales y servicios registrados al día en el sistema.';
    }

    resultado = {
      tipo: 'consulta_saldos',
      icono: '📊',
      titulo: 'Consulta de Saldos',
      detalle: `Respuesta de consulta para ${remitenteNombre}`,
      respuestaWhatsApp: respuesta
    };
  }

  // ========================================================
  // 4. VALES Y ADELANTOS (DIRECTO Y NATURAL)
  // ========================================================
  else if (texto.includes('vale') || texto.includes('adelanto') || texto.includes('retiro') || texto.includes('anticipo') || texto.includes('plata')) {
    let monto = 150000;
    const matchMil = texto.match(/(\d+)\s*(?:mil|k)/i);
    const matchGs = texto.match(/(\d[\d\.\,]*)\s*(?:gs|guaranies|\$)?/i);
    if (matchMil) {
      monto = parseInt(matchMil[1]) * 1000;
    } else if (matchGs && parseInt(matchGs[1].replace(/\./g, '')) > 1000) {
      monto = parseInt(matchGs[1].replace(/\./g, ''));
    }

    let personalId = null;
    let personalNombre = 'el personal';
    
    // Extracción inteligente de nombre del texto
    const matchPara = textoOriginal.match(/(?:para|a|de)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?)/i);
    if (matchPara && !['la', 'el', 'los', 'las', 'una', 'un', 'obra', 'km', 'mi'].includes(matchPara[1].toLowerCase())) {
      personalNombre = matchPara[1];
    }

    if (sql) {
      try {
        const pers = await sql`SELECT id, nombre FROM personales`;
        const encontrado = pers.find(p => texto.includes(p.nombre.toLowerCase().split(' ')[0]));
        if (encontrado) {
          personalId = encontrado.id;
          personalNombre = encontrado.nombre;
        } else if (pers.length > 0) {
          personalId = pers[0].id;
        }
      } catch (e) {
        console.warn('Error buscando personal:', e.message);
      }
    }

    if (sql && personalId) {
      try {
        await sql`
          INSERT INTO asistencias_vales (personal_id, obra_id, fecha, estado, vale_adelanto, observacion)
          VALUES (${personalId}, (SELECT id FROM obras ORDER BY id ASC LIMIT 1), CURRENT_DATE, 'presente', ${monto}, ${'WhatsApp: ' + textoOriginal})
        `;
        await sql`
          INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
          VALUES (${remitenteNombre || remitenteId}, 'asistencia_vale', ${textoOriginal}, ${'Vale anotado: ' + monto.toLocaleString('es-PY') + ' Gs. para ' + personalNombre})
        `;
      } catch (e) {
        console.warn('Aviso guardando vale en DB:', e.message);
      }
    }

    resultado = {
      tipo: 'vale_asistencia',
      icono: '💰',
      titulo: 'Vale Registrado',
      detalle: `${personalNombre}: ${monto.toLocaleString('es-PY')} Gs.`,
      respuestaWhatsApp: `Listo, ya le anoté el vale de ${monto.toLocaleString('es-PY')} Gs. a ${personalNombre}.`
    };
  }

  // ========================================================
  // 5. DESPACHO DE BOBCAT (AGENDAR SERVICIO)
  // ========================================================
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
      try {
        await sql`
          INSERT INTO bobcat_servicios (cliente, telefono_cliente, zona_destino, fecha_servicio, horas_pactadas, tarifa_hora, costo_traslado, total_facturado, estado)
          VALUES (${remitenteNombre || 'Cliente WhatsApp'}, ${remitenteId.replace(/[^0-9]/g, '')}, ${zona}, ${new Date().toISOString()}, ${horas}, ${tarifaHora}, ${flete}, ${total}, 'agendado')
        `;
        await sql`
          INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
          VALUES (${remitenteNombre || remitenteId}, 'reserva_bobcat', ${textoOriginal}, ${'Bobcat agendada en ' + zona + ' (' + horas + ' hs)'})
        `;
      } catch (e) {
        console.warn('Aviso guardando bobcat en DB:', e.message);
      }
    }

    resultado = {
      tipo: 'reserva_bobcat',
      icono: '🚜',
      titulo: 'Servicio Bobcat Agendado',
      detalle: `${zona} (${horas} hs) - Total: ${total.toLocaleString('es-PY')} Gs.`,
      respuestaWhatsApp: `Dale, agendé la Bobcat para ${zona} por ${horas} horas (total: ${total.toLocaleString('es-PY')} Gs. con flete). Ya le queda anotado a Ramón.`
    };
  }

  // ========================================================
  // 6. CIERRE DE HORÓMETRO DE RAMÓN (LIQUIDACIÓN)
  // ========================================================
  else if (texto.includes('horometro') || (texto.includes('ramon') && texto.includes('hora')) || (texto.includes('trabaje') && texto.includes('hora')) || (texto.includes('termino') && texto.includes('hora'))) {
    let horasReales = 5;
    const matchHs = texto.match(/(\d+)\s*(?:hs|hora|horas)/i);
    if (matchHs) horasReales = parseInt(matchHs[1]);

    const total = (horasReales * 250000) + 250000;

    if (sql) {
      try {
        await sql`
          UPDATE bobcat_servicios
          SET horas_reales = ${horasReales}, total_facturado = ${total}, estado = 'finalizado_cobrado', notas_operador = ${'Cierre por WhatsApp: ' + textoOriginal}
          WHERE id = (SELECT id FROM bobcat_servicios WHERE estado = 'agendado' ORDER BY id ASC LIMIT 1)
        `;
        await sql`
          INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
          VALUES (${remitenteNombre || 'Operador Ramón'}, 'horas_ramon', ${textoOriginal}, ${'Ramón cerró ' + horasReales + ' hs. Total cobrado: ' + total.toLocaleString('es-PY') + ' Gs.'})
        `;
      } catch (e) {
        console.warn('Aviso actualizando horas ramon en DB:', e.message);
      }
    }

    resultado = {
      tipo: 'cierre_horas_ramon',
      icono: '⏱️',
      titulo: 'Horas de Ramón Computadas',
      detalle: `${horasReales} horas reales trabajadas.`,
      respuestaWhatsApp: `Listo, le computé ${horasReales} horas a Ramón en la Bobcat (${total.toLocaleString('es-PY')} Gs.).`
    };
  }

  // ========================================================
  // 7. MATERIALES Y RECEPCIONES
  // ========================================================
  else if (texto.includes('cemento') || texto.includes('varilla') || texto.includes('hierro') || texto.includes('arena') || texto.includes('descargo') || texto.includes('descarg') || texto.includes('llego') || texto.includes('bolsa')) {
    let material = 'Materiales';
    if (texto.includes('cemento')) material = 'Cemento Yguazú';
    else if (texto.includes('varilla') || texto.includes('hierro')) material = 'Varillas de Hierro';
    else if (texto.includes('arena')) material = 'Arena Lavada';

    let cantidad = '1 carga';
    const matchCant = texto.match(/(\d+[\d\.\,]*)\s*(?:bolsas|kg|kilos|tn|toneladas|m3|metros)?/i);
    if (matchCant) cantidad = matchCant[0];

    if (sql) {
      try {
        await sql`
          INSERT INTO materiales (obra_id, material, cantidad, proveedor, fecha_entrega, responsable_recepcion, estado)
          VALUES ((SELECT id FROM obras ORDER BY id ASC LIMIT 1), ${material}, ${cantidad}, 'Distribuidora Alto Paraná', NOW(), ${remitenteNombre || 'Encargado'}, 'recibido')
        `;
        await sql`
          INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
          VALUES (${remitenteNombre || remitenteId}, 'material_recepcion', ${textoOriginal}, ${'Recepción confirmada: ' + cantidad + ' de ' + material})
        `;
      } catch (e) {
        console.warn('Aviso guardando material en DB:', e.message);
      }
    }

    resultado = {
      tipo: 'recepcion_material',
      icono: '🧱',
      titulo: 'Material Recibido',
      detalle: `${material} (${cantidad}) asentado.`,
      respuestaWhatsApp: `Recibido, ya cargué ${cantidad} de ${material} al inventario de la obra.`
    };
  }

  // ========================================================
  // 8. BITÁCORA DE CAMPO (LLUVIAS, COMPRAS, FOTOS)
  // ========================================================
  else if (texto.includes('lluv') || texto.includes('llov') || texto.includes('susp') || texto.includes('paro') || texto.includes('parada') || texto.includes('compr') || texto.includes('ferret') || texto.includes('foto') || texto.includes('retras') || texto.includes('inciden') || texto.includes('nota') || texto.includes('bitacor') || texto.includes('posterg')) {
    let categoria = 'general';
    let monto = 0;
    let resp = '';

    if (texto.includes('lluv') || texto.includes('llov') || texto.includes('susp') || texto.includes('paro') || texto.includes('parada') || texto.includes('clima')) {
      categoria = 'clima';
      resp = 'Entendido, ya dejé asentado en la bitácora que se paró por lluvia.';
    } else if (texto.includes('compr') || texto.includes('ferret')) {
      categoria = 'compra_imprevista';
      const matchMil = texto.match(/(\d+)\s*(?:mil|k)/i);
      const matchGs = texto.match(/(\d[\d\.\,]*)/);
      if (matchMil) monto = parseInt(matchMil[1]) * 1000;
      else if (matchGs && parseInt(matchGs[1].replace(/\./g, '')) > 1000) monto = parseInt(matchGs[1].replace(/\./g, ''));
      resp = `Anotado, registré el gasto de ferretería por ${monto > 0 ? monto.toLocaleString('es-PY') + ' Gs.' : 'el monto indicado'}.`;
    } else {
      categoria = 'incidencia';
      resp = 'Listo, ya guardé la novedad en el cuaderno de la obra.';
    }

    if (sql) {
      try {
        await sql`
          INSERT INTO bitacora_obras (obra_id, categoria, nota, autor, monto_imprevisto)
          VALUES ((SELECT id FROM obras ORDER BY id ASC LIMIT 1), ${categoria}, ${textoOriginal}, ${remitenteNombre || 'WhatsApp'}, ${monto})
        `;
        await sql`
          INSERT INTO actividad_whatsapp (remitente, tipo_evento, mensaje_original, resumen_accion)
          VALUES (${remitenteNombre || remitenteId}, 'nota_bitacora', ${textoOriginal}, ${'Bitácora (' + categoria + '): ' + textoOriginal.substring(0, 40)})
        `;
      } catch (e) {
        console.warn('Aviso guardando bitácora en DB:', e.message);
      }
    }

    resultado = {
      tipo: 'nota_bitacora',
      icono: '📝',
      titulo: 'Nota en Bitácora',
      detalle: `[${categoria}] ${textoOriginal}`,
      respuestaWhatsApp: resp
    };
  }

  // ========================================================
  // 9. CUALQUIER OTRO MENSAJE LIBRE (NATURAL, SIN TEXTOS LARGOS)
  // ========================================================
  else {
    resultado = {
      tipo: 'mensaje_libre',
      icono: '💬',
      titulo: 'Mensaje Recibido',
      detalle: `"${textoOriginal}"`,
      respuestaWhatsApp: 'Entendido. Decime nomás qué necesitás que te anote o te consulte.'
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
      printQRInTerminal: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      browser: ['Obras CDE Cloud', 'Chrome', '124.0.0']
    });

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      if (sock?.authState?.creds?.me) {
        await respaldarSesionHaciaDB();
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeRaw = qr;
        qrCodeDataURL = await QRCode.toDataURL(qr, { scale: 8 });
        qrTimestamp = Date.now();
        estadoConexion = 'esperando_qr';

        console.log('\n========================================================');
        console.log(`📲 NUEVO CÓDIGO QR GENERADO (${new Date().toLocaleTimeString('es-PY')})`);
        console.log('========================================================\n');
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error)?.output?.statusCode;
        console.log(`⚠️ Conexión cerrada (Código: ${statusCode}).`);
        qrCodeRaw = null;
        qrCodeDataURL = null;
        qrTimestamp = null;

        if (!usuarioConectado) {
          estadoConexion = 'esperando_qr';
          setTimeout(() => resetearSocket(true), 3000);
        } else {
          estadoConexion = 'cerrado';
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            setTimeout(() => resetearSocket(false), 3000);
          } else {
            usuarioConectado = null;
            await limpiarSesionEnDB();
            setTimeout(() => resetearSocket(true), 2000);
          }
        }
      } else if (connection === 'open') {
        estadoConexion = 'conectado';
        usuarioConectado = sock.user;
        qrCodeRaw = null;
        qrCodeDataURL = null;
        qrTimestamp = null;
        const num = (usuarioConectado?.id || '').split(':')[0];
        console.log('\n========================================================');
        console.log(`🎉 ¡WHATSAPP CONECTADO CON ÉXITO! (+${num})`);
        console.log('========================================================\n');
        await respaldarSesionHaciaDB();
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
