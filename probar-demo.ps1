param (
    [string]$BaseUrl = "http://127.0.0.1:5679",
    [switch]$Simular
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  PRUEBA AUTOMATIZADA: ASISTENTE DE AGENDA Y PENDIENTES  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Zona horaria configurada: America/Asuncion" -ForegroundColor Gray

# Verificar si n8n está respondiendo en el puerto configurado
$n8nOnline = $false
if (-not $Simular) {
    try {
        $null = Invoke-RestMethod -Uri "$BaseUrl/healthz" -TimeoutSec 5 -ErrorAction Stop
        $n8nOnline = $true
        Write-Host "[OK] n8n detectado activo en $BaseUrl" -ForegroundColor Green
    } catch {
        Write-Host "[INFO] n8n no está respondiendo en $BaseUrl (Docker / n8n no iniciado)." -ForegroundColor Yellow
        Write-Host "[INFO] Ejecutando simulación local directa para validar los casos de negocio..." -ForegroundColor Yellow
        $n8nOnline = $false
    }
}

$casos = @(
    @{
        Nombre = "Caso A: Proveedor confirma entrega y solicita responsable"
        Payload = @{
            id = "msg-001"
            remitente = "Proveedor"
            origen = "mensaje"
            texto = "Confirmado, el material llega el 12 de noviembre de 2026 a las 09:00. Decime quién lo recibe"
        }
        Esperado = "Evento de entrega agendado (12/11/2026 09:00), pendiente de asignar responsable y respuesta sugerida que no compromete quién recibe."
    },
    @{
        Nombre = "Caso B: Funcionario solicita planilla firmada"
        Payload = @{
            id = "msg-002"
            remitente = "Funcionario"
            origen = "mensaje"
            texto = "Pasame la planilla firmada cuando puedas"
        }
        Esperado = "Pendiente sin fecha ('Enviar planilla firmada a Funcionario') y respuesta sugerida de confirmación."
    },
    @{
        Nombre = "Caso C: Nota post-llamada interna"
        Payload = @{
            id = "msg-003"
            remitente = "Coordinador"
            origen = "nota_posllamada"
            texto = "Anotá llamar a Pedro el 13 de noviembre de 2026 a las 14:00 por la factura"
        }
        Esperado = "Recordatorio en agenda (13/11/2026 14:00) y NINGUNA respuesta sugerida hacia el contacto externo."
    },
    @{
        Nombre = "Caso D: Fecha ambigua / incompleta"
        Payload = @{
            id = "msg-004"
            remitente = "Cliente"
            origen = "mensaje"
            texto = "Nos vemos la semana que viene"
        }
        Esperado = "Estado 'requiere_revision', no crea evento en agenda ni inventa horarios."
    },
    @{
        Nombre = "Caso E: Repetición del mensaje A (Deduplicación / Idempotencia)"
        Payload = @{
            id = "msg-001"
            remitente = "Proveedor"
            origen = "mensaje"
            texto = "Confirmado, el material llega el 12 de noviembre de 2026 a las 09:00. Decime quién lo recibe"
        }
        Esperado = "Deduplicación activa ('duplicado: true'). No crea duplicados en agenda ni en pendientes."
    }
)

if ($n8nOnline) {
    # Ejecución vía Webhooks reales de n8n
    $mensajeUrl = "$BaseUrl/webhook/agenda-mensaje"
    $resumenUrl = "$BaseUrl/webhook/agenda-resumen"

    foreach ($caso in $casos) {
        Write-Host "`n----------------------------------------------------------" -ForegroundColor DarkCyan
        Write-Host ">> $($caso.Nombre)" -ForegroundColor White
        Write-Host "Esperado: $($caso.Esperado)" -ForegroundColor Gray

        $jsonBody = $caso.Payload | ConvertTo-Json -Compress
        $res = Invoke-RestMethod -Uri $mensajeUrl -Method Post -Body $jsonBody -ContentType "application/json"
        
        Write-Host "Respuesta obtenida:" -ForegroundColor Green
        $res | ConvertTo-Json -Depth 5 | Write-Host
    }

    Write-Host "`n----------------------------------------------------------" -ForegroundColor DarkCyan
    Write-Host ">> Caso F: Consultar Resumen Final" -ForegroundColor White
    $resumen = Invoke-RestMethod -Uri $resumenUrl -Method Get
    Write-Host "Resumen obtenido:" -ForegroundColor Green
    $resumen | ConvertTo-Json -Depth 5 | Write-Host
} else {
    # Ejecución a través del motor Node.js local
    $nodeScript = Join-Path $PSScriptRoot "simular-demo.mjs"
    node $nodeScript
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  PRUEBAS COMPLETADAS                                     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
