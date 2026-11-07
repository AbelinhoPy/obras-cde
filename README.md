# Asistente de Agenda y Pendientes (Demo Local n8n)

Demo local de un asistente para coordinadores que recibe mensajes, audios simulados y notas internas, convirtiéndolos en eventos de agenda, tareas pendientes o solicitudes de revisión con respuestas sugeridas en la zona horaria `America/Asuncion`.

---

## 1. Archivos del Proyecto

- [agenda-demo.json](file:///C:/Users/abelk/.gemini/antigravity/scratch/asistente-agenda-n8n/agenda-demo.json): Workflow de n8n listo para importar (validado estructuralmente).
- [probar-demo.ps1](file:///C:/Users/abelk/.gemini/antigravity/scratch/asistente-agenda-n8n/probar-demo.ps1): Script de prueba en PowerShell que ejecuta los casos A a F.
- [simular-demo.mjs](file:///C:/Users/abelk/.gemini/antigravity/scratch/asistente-agenda-n8n/simular-demo.mjs): Motor de ejecución y validación local de lógica n8n con Node.js.
- [referencia-whatsapp/](file:///C:/Users/abelk/.gemini/antigravity/scratch/asistente-agenda-n8n/referencia-whatsapp): Repositorio de referencia clonado y validado.

---

## 2. Puesta en Marcha de n8n

### Requisito previo:
Para levantar el contenedor Docker de n8n, se requiere Docker Desktop instalado en Windows.
*(En este sistema, `docker version` no se encontró en el PATH, por lo que la validación se ejecutó de forma local inmediata).*

### Iniciar n8n cuando Docker esté disponible:
```powershell
docker volume create n8n_agenda_demo_data
docker run -d --name n8n-agenda-demo -p 127.0.0.1:5679:5678 -e GENERIC_TIMEZONE=America/Asuncion -e TZ=America/Asuncion -v n8n_agenda_demo_data:/home/node/.n8n n8nio/n8n
```

- **URL Local de n8n:** [http://localhost:5679](http://localhost:5679)
- Si es la primera vez que abres n8n, te pedirá crear una cuenta de usuario local administrativo.

---

## 3. Pasos de Importación en n8n

1. Abre el navegador en [http://localhost:5679](http://localhost:5679).
2. Ve a **Workflows** > **Import from File...** (o pulsa `Ctrl + O`).
3. Selecciona el archivo `agenda-demo.json`.
4. En la esquina superior derecha del flujo, haz clic en **Publish / Active** (o activa el toggle) para que los webhooks queden escuchando en modo producción.
5. Endpoints habilitados:
   - `POST http://localhost:5679/webhook/agenda-mensaje`
   - `GET http://localhost:5679/webhook/agenda-resumen`

---

## 4. Ejecución de Pruebas

Para ejecutar las pruebas:
```powershell
.\probar-demo.ps1
```
*Si n8n está encendido en el puerto 5679, el script enviará las peticiones HTTP directamente a los webhooks. Si no está encendido, ejecutará la simulación determinista local con Node.js.*

---

## 5. Resultados Comprobados (Casos A - F)

| Caso | Entrada | Resultado Obtenido | Estado |
|---|---|---|:---:|
| **A (Proveedor)** | "Confirmado, el material llega el 12 de noviembre de 2026 a las 09:00. Decime quién lo recibe" | Crea evento `Entrega de material` (2026-11-12 09:00), crea pendiente `Asignar responsable de recepción del material` y respuesta sugerida de acuse de recibo. | **PASSED** |
| **B (Funcionario)** | "Pasame la planilla firmada cuando puedas" | Crea pendiente sin fecha `Enviar planilla firmada a Funcionario` y respuesta sugerida. No crea evento. | **PASSED** |
| **C (Nota post-llamada)** | "Anotá llamar a Pedro el 13 de noviembre de 2026 a las 14:00 por la factura" (`nota_posllamada`) | Crea recordatorio en agenda (2026-11-13 14:00) y `respuesta_sugerida: null` (no responde a terceros). | **PASSED** |
| **D (Ambigua)** | "Nos vemos la semana que viene" | Marca `requiere_revision`, no inventa horarios ni crea eventos en falso. Sugiere pedir aclaración. | **PASSED** |
| **E (Duplicado A)** | Reenvío de mensaje A con el mismo ID (`msg-001`) | Detecta `duplicado: true`. Conserva un solo evento y un solo pendiente sin duplicar. | **PASSED** |
| **F (Resumen)** | Consulta de balance general | Retorna 2 eventos, 2 tareas pendientes y 1 ítem en revisión. | **PASSED** |

---

## 6. Piezas Simuladas y Pendientes

- **Docker:** Pendiente de iniciar cuando Docker Desktop esté instalado o en PATH en Windows.
- **WhatsApp Inbound/Outbound:** Simulado mediante Webhooks REST locales (POST y GET). En producción se conecta al nodo Meta Cloud API o Evolution API.
- **Transcripción de audios:** El flujo procesa el texto ya transcrito (`origen: audio_transcrito`). En producción se antepone un nodo de transcripción (Whisper o Gemini Flash).
