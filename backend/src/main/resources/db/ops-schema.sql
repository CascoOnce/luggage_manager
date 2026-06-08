-- Ops Schema for Luggage Manager "Operaciones Día a Día" Mode
-- Separate MySQL schema (luggage_ops) for operational data

CREATE SCHEMA IF NOT EXISTS luggage_ops
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE luggage_ops;

-- Table: envios
-- Stores baggage shipment records with full routing state
-- Columns mirror EnvioEntity (com.tasf.backend.entity.EnvioEntity)
CREATE TABLE IF NOT EXISTS envios (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    id_pedido VARCHAR(50) NOT NULL,
    id_cliente VARCHAR(50),
    codigo_aerolinea VARCHAR(10),
    iata_origen VARCHAR(4) NOT NULL,
    iata_destino VARCHAR(4) NOT NULL,
    cantidad_maletas INT NOT NULL,
    fecha_hora_ingreso DATETIME NOT NULL,
    sla INT NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',

    -- Indexes for query optimization
    INDEX idx_envio_estado (estado),
    INDEX idx_envio_origen_destino (iata_origen, iata_destino),
    INDEX idx_envio_fecha (fecha_hora_ingreso)
) ENGINE=InnoDB
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;
