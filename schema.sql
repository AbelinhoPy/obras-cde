-- ==============================================================================
-- SCHEMA OFICIAL PARA NEON POSTGRESQL
-- SISTEMA DE GESTIÓN DE OBRAS, ASISTENCIA Y ALQUILER BOBCAT (CDE / ALTO PARANÁ)
-- ==============================================================================

-- 1. Tabla de Obras Activas
CREATE TABLE IF NOT EXISTS obras (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    ubicacion VARCHAR(255) NOT NULL,
    etapa_actual VARCHAR(100) DEFAULT 'En inicio',
    porcentaje_avance INT DEFAULT 0,
    estado VARCHAR(50) DEFAULT 'activa',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Personales de Obra (Albañiles, Oficiales, Ayudantes, Capataces)
CREATE TABLE IF NOT EXISTS personales (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    cargo VARCHAR(80) NOT NULL,
    obra_id INT REFERENCES obras(id) ON DELETE SET NULL,
    jornal_diario NUMERIC(12, 2) NOT NULL DEFAULT 150000, -- En Guaraníes
    telefono VARCHAR(50),
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla de Asistencia Diaria y Vales (Para la liquidación del sábado)
CREATE TABLE IF NOT EXISTS asistencias_vales (
    id SERIAL PRIMARY KEY,
    personal_id INT NOT NULL REFERENCES personales(id) ON DELETE CASCADE,
    obra_id INT REFERENCES obras(id) ON DELETE SET NULL,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    estado VARCHAR(30) NOT NULL DEFAULT 'presente', -- 'presente', 'falta', 'medio_jornal'
    vale_adelanto NUMERIC(12, 2) DEFAULT 0, -- Monto del vale en Gs.
    semana_ano VARCHAR(20), -- ej. '2026-W45'
    pagado_sabado BOOLEAN DEFAULT FALSE,
    observacion TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabla de Materiales y Recepción de Cargas
CREATE TABLE IF NOT EXISTS materiales (
    id SERIAL PRIMARY KEY,
    obra_id INT REFERENCES obras(id) ON DELETE SET NULL,
    material VARCHAR(200) NOT NULL,
    cantidad VARCHAR(100),
    proveedor VARCHAR(150),
    fecha_entrega TIMESTAMP WITH TIME ZONE NOT NULL,
    responsable_recepcion VARCHAR(120),
    estado VARCHAR(50) DEFAULT 'programado', -- 'programado', 'recibido', 'pendiente_responsable'
    remision_nro VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tabla de Alquiler de Maquinaria (Bobcat)
CREATE TABLE IF NOT EXISTS bobcat_servicios (
    id SERIAL PRIMARY KEY,
    cliente VARCHAR(150) NOT NULL,
    telefono_cliente VARCHAR(50),
    zona_destino VARCHAR(150) NOT NULL, -- 'Km 8 Acaray', 'Minga Km 16', 'Pte Franco', etc.
    fecha_servicio TIMESTAMP WITH TIME ZONE NOT NULL,
    horas_pactadas NUMERIC(5, 2) NOT NULL DEFAULT 4,
    horas_reales NUMERIC(5, 2) DEFAULT 0, -- Horas anotadas por Ramón al terminar
    tarifa_hora NUMERIC(12, 2) DEFAULT 250000, -- 250.000 Gs/h
    costo_traslado NUMERIC(12, 2) DEFAULT 250000, -- 250.000 Gs traslado CDE
    total_facturado NUMERIC(12, 2) DEFAULT 0,
    operador VARCHAR(100) DEFAULT 'Ramón',
    estado VARCHAR(50) DEFAULT 'agendado', -- 'agendado', 'en_curso', 'finalizado_cobrado'
    notas_operador TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- DATOS INICIALES REALES DE EJEMPLO (SEED DATA CDE)
-- ==============================================================================

-- Insertar Obras
INSERT INTO obras (nombre, ubicacion, etapa_actual, porcentaje_avance) VALUES
('Edificio Residencial Km 8', 'Km 8 Acaray c/ San José, CDE', 'Losa 2do Piso', 65),
('Dúplex Modernos Km 10', 'Km 10 Monday, CDE', 'Mampostería y revoque', 40),
('Galpón Industrial Hernandarias', 'Hernandarias - Parque Industrial', 'Movimiento de suelo', 25)
ON CONFLICT DO NOTHING;

-- Insertar Personales
INSERT INTO personales (nombre, cargo, obra_id, jornal_diario) VALUES
('Pedro Benítez', 'Oficial Albañil', 2, 170000),
('Juan Almirón', 'Ayudante', 2, 120000),
('Marcos Vera', 'Oficial Armador', 2, 180000),
('Silvio Duarte', 'Ayudante', 2, 120000),
('Carlos Cabrera', 'Capataz General', 1, 240000),
('Wilson Silva', 'Oficial Albañil', 3, 170000),
('Marcelo Ríos', 'Ayudante', 3, 120000)
ON CONFLICT DO NOTHING;

-- Insertar Vales Registrados en la semana
INSERT INTO asistencias_vales (personal_id, obra_id, fecha, estado, vale_adelanto, observacion) VALUES
(1, 2, CURRENT_DATE, 'presente', 150000, 'Vale pedido el miércoles'),
(3, 2, CURRENT_DATE, 'presente', 100000, 'Vale pedido el jueves'),
(5, 1, CURRENT_DATE, 'presente', 300000, 'Adelanto combustible y gastos'),
(6, 3, CURRENT_DATE, 'presente', 100000, 'Vale de urgencia')
ON CONFLICT DO NOTHING;

-- Insertar Materiales Programados
INSERT INTO materiales (obra_id, material, cantidad, proveedor, fecha_entrega, responsable_recepcion, estado) VALUES
(3, 'Cemento Yguazú', '200 bolsas', 'Distribuidora Alto Paraná', NOW() + INTERVAL '1 day', 'Capataz Ramón', 'programado'),
(2, 'Arena Lavada', '12 m³', 'Cantera San Miguel', NOW() + INTERVAL '2 days', 'Oficial Pedro', 'programado'),
(1, 'Varillas de Hierro 10mm y 12mm', '2.000 kg', 'Aceros CDE', NOW() - INTERVAL '3 hours', 'Ingeniero', 'recibido')
ON CONFLICT DO NOTHING;

-- Insertar Servicios de Bobcat
INSERT INTO bobcat_servicios (cliente, telefono_cliente, zona_destino, fecha_servicio, horas_pactadas, horas_reales, tarifa_hora, costo_traslado, total_facturado, operador, estado) VALUES
('Arq. Walter Benítez', '0983-112-233', 'Hernandarias (B° Las Mercedes)', NOW() - INTERVAL '1 day', 4, 5.0, 250000, 250000, 1500000, 'Ramón', 'finalizado_cobrado'),
('Don Gustavo Rojas', '0983-445-566', 'CDE (Km 8 Acaray)', NOW() + INTERVAL '1 day', 4, 0, 250000, 250000, 1250000, 'Ramón', 'agendado'),
('Don Celso (Minga)', '0981-998-877', 'Minga Guazú (Km 16)', NOW() + INTERVAL '2 days', 4, 0, 250000, 250000, 1250000, 'Ramón', 'agendado')
ON CONFLICT DO NOTHING;
