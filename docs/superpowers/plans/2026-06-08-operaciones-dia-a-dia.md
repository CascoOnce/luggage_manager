# Operaciones Día a Día — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un modo "Operaciones Día a Día" donde operadores ingresan envíos en tiempo real (manual o TXT), SA planifica rutas al instante, y el mapa/dashboard se actualiza en vivo — completamente aislado del modo simulación mediante un schema MySQL separado.

**Architecture:** El backend usa dual datasource: el datasource primario (sim) ya existe; se añade uno secundario (ops) apuntando a un schema MySQL con solo la tabla `envios`. Aeropuertos y vuelos se sirven del DataLoaderService ya en memoria. SA corre sobre los envíos pendientes del schema ops; los planes resultantes se guardan en memoria en `OpsService`. El frontend extiende `ConfigScreen` con un selector de modo y un layout de 3 paneles para ops; `LiveScreen` se convierte en `OpsScreen` añadiendo un tab de ingreso de envíos.

**Tech Stack:** Spring Boot 3 (JPA dual datasource, EntityManagerFactoryBuilder), MySQL (schema separado `luggage_ops`), React 18 + Vite, api.js fetch wrapper existente.

---

## Convenciones del proyecto

- Backend base package: `com.tasf.backend`
- Frontend src: `src/`
- Backend run: `cd backend && ./mvnw spring-boot:run -Dspring-boot.run.profiles=local`
- Frontend run: `npm run dev`
- Commit frecuente, un commit por task

---

## Archivos que se crean o modifican

### Backend — nuevos
| Archivo | Responsabilidad |
|---|---|
| `backend/src/main/resources/db/ops-schema.sql` | DDL del schema `luggage_ops` (solo tabla `envios`) |
| `backend/src/main/java/.../config/SimDataSourceConfig.java` | DataSource primario explícito + EMF sim + TX sim |
| `backend/src/main/java/.../config/OpsDataSourceConfig.java` | DataSource secundario ops + EMF ops + TX ops |
| `backend/src/main/java/.../repository/ops/OpsEnvioRepository.java` | JPA repo del schema ops |
| `backend/src/main/java/.../dto/OpsEnvioRequestDTO.java` | DTO para ingreso manual de un envío |
| `backend/src/main/java/.../dto/OpsReporteDTO.java` | DTO para reporte KPI del día |
| `backend/src/main/java/.../service/OpsService.java` | Estado ops (aeropuertos+vuelos+envíos), addEnvio, planificar, reporte |
| `backend/src/main/java/.../controller/OpsController.java` | /api/ops/* endpoints |

### Backend — modificados
| Archivo | Cambio |
|---|---|
| `backend/src/main/resources/application.properties` | Añadir propiedades `ops.datasource.*` |
| `backend/src/main/java/.../controller/UploadController.java` | Añadir `POST /api/ops/upload/envios` |
| `backend/src/main/java/.../service/EnvioUploadService.java` | Añadir `processOpsUpload(file)` usando `OpsEnvioRepository` |

### Frontend — nuevos
| Archivo | Responsabilidad |
|---|---|
| `src/components/OpsEnviosIngress.jsx` | Panel de ingreso: formulario manual + upload TXT + preview tabla |
| `src/screens/OpsScreen.jsx` | Pantalla principal ops: mapa + panel ingreso tab (copia/evolución de LiveScreen) |

### Frontend — modificados
| Archivo | Cambio |
|---|---|
| `src/services/api.js` | Añadir funciones ops: `getOpsState`, `addOpsEnvio`, `uploadOpsEnvios`, `planificarOps`, `getOpsEnvios`, `getOpsReporte` |
| `src/screens/ConfigScreen.jsx` | Selector de modo top + layout ops (3 paneles: archivos | form | preview) |
| `src/App.jsx` | Añadir `screen='ops'`, `startOps()`/`stopOps()`, routing a `OpsScreen` y pantallas ops |

---

## Task 1: Schema SQL para ops

**Files:**
- Create: `backend/src/main/resources/db/ops-schema.sql`

- [ ] **Step 1: Crear el SQL de schema ops**

```sql
-- backend/src/main/resources/db/ops-schema.sql
-- Ejecutar manualmente en MySQL antes del primer arranque en modo ops.
-- Crea el schema luggage_ops con solo la tabla envios (misma estructura que sim).

CREATE SCHEMA IF NOT EXISTS luggage_ops
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE luggage_ops;

CREATE TABLE IF NOT EXISTS envios (
  id                  BIGINT       NOT NULL AUTO_INCREMENT,
  id_pedido           VARCHAR(50)  NOT NULL,
  id_cliente          VARCHAR(50)           DEFAULT NULL,
  codigo_aerolinea    VARCHAR(10)           DEFAULT NULL,
  iata_origen         VARCHAR(4)   NOT NULL,
  iata_destino        VARCHAR(4)   NOT NULL,
  cantidad_maletas    INT          NOT NULL,
  fecha_hora_ingreso  DATETIME     NOT NULL,
  sla                 INT          NOT NULL,
  estado              VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE',
  PRIMARY KEY (id),
  INDEX idx_envio_estado          (estado),
  INDEX idx_envio_origen_destino  (iata_origen, iata_destino),
  INDEX idx_envio_fecha           (fecha_hora_ingreso)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Ejecutar el SQL en el servidor MySQL RDS**

```bash
# Reemplazar con credenciales reales
mysql -h <RDS_HOST> -u <USERNAME> -p < backend/src/main/resources/db/ops-schema.sql
```

Verificar: `SHOW TABLES IN luggage_ops;` debe mostrar `envios`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/resources/db/ops-schema.sql
git commit -m "feat(ops): add ops schema SQL for luggage_ops"
```

---

## Task 2: Propiedades del datasource ops

**Files:**
- Modify: `backend/src/main/resources/application.properties`

- [ ] **Step 1: Añadir propiedades ops.datasource al final de application.properties**

Añadir al final del archivo `backend/src/main/resources/application.properties`:

```properties
# ── Ops DataSource (schema luggage_ops) ──────────────────────────
ops.datasource.url=${OPS_DATASOURCE_URL:${SPRING_DATASOURCE_URL}}
ops.datasource.username=${OPS_DATASOURCE_USERNAME:${SPRING_DATASOURCE_USERNAME}}
ops.datasource.password=${OPS_DATASOURCE_PASSWORD:${SPRING_DATASOURCE_PASSWORD}}
ops.datasource.driver-class-name=com.mysql.cj.jdbc.Driver
ops.datasource.hikari.pool-name=OpsPool
ops.datasource.hikari.maximum-pool-size=3
ops.datasource.hikari.minimum-idle=1
ops.datasource.hikari.connection-timeout=60000
```

`OPS_DATASOURCE_URL` apunta al schema `luggage_ops` en la misma instancia RDS. Si no se define, hace fallback al URL de sim (útil para pruebas locales donde ambos schemas están en la misma conexión).

- [ ] **Step 2: Añadir a application-local.properties las variables ops**

En `backend/src/main/resources/application-local.properties` (o el archivo equivalente de env local):

```properties
OPS_DATASOURCE_URL=jdbc:mysql://<RDS_HOST>:3306/luggage_ops?useSSL=true&requireSSL=false&serverTimezone=UTC
OPS_DATASOURCE_USERNAME=<mismo username>
OPS_DATASOURCE_PASSWORD=<mismo password>
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/resources/application.properties
git commit -m "feat(ops): add ops.datasource properties"
```

---

## Task 3: Dual datasource config (Spring Boot)

**Files:**
- Create: `backend/src/main/java/com/tasf/backend/config/SimDataSourceConfig.java`
- Create: `backend/src/main/java/com/tasf/backend/config/OpsDataSourceConfig.java`

Cuando se define un `@Bean LocalContainerEntityManagerFactoryBean` con nombre `entityManagerFactory` (primario), Spring Boot JPA auto-config retrocede. Debemos configurar explícitamente ambos datasources.

- [ ] **Step 1: Crear SimDataSourceConfig.java**

```java
package com.tasf.backend.config;

import com.zaxxer.hikari.HikariDataSource;
import jakarta.persistence.EntityManagerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.orm.jpa.EntityManagerFactoryBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;
import java.util.Map;

@Configuration
@EnableJpaRepositories(
    basePackages = "com.tasf.backend.repository",
    entityManagerFactoryRef = "simEntityManagerFactory",
    transactionManagerRef = "simTransactionManager"
)
public class SimDataSourceConfig {

    @Primary
    @Bean
    @ConfigurationProperties("spring.datasource")
    public DataSourceProperties simDataSourceProperties() {
        return new DataSourceProperties();
    }

    @Primary
    @Bean
    @ConfigurationProperties("spring.datasource.hikari")
    public DataSource simDataSource(
            @Qualifier("simDataSourceProperties") DataSourceProperties props) {
        return props.initializeDataSourceBuilder()
                .type(HikariDataSource.class)
                .build();
    }

    @Primary
    @Bean
    public LocalContainerEntityManagerFactoryBean simEntityManagerFactory(
            EntityManagerFactoryBuilder builder,
            @Qualifier("simDataSource") DataSource dataSource) {
        return builder
                .dataSource(dataSource)
                .packages("com.tasf.backend.entity")
                .persistenceUnit("sim")
                .properties(Map.of("hibernate.hbm2ddl.auto", "validate"))
                .build();
    }

    @Primary
    @Bean
    public PlatformTransactionManager simTransactionManager(
            @Qualifier("simEntityManagerFactory") EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }
}
```

- [ ] **Step 2: Crear OpsDataSourceConfig.java**

```java
package com.tasf.backend.config;

import com.zaxxer.hikari.HikariDataSource;
import jakarta.persistence.EntityManagerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.orm.jpa.EntityManagerFactoryBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;
import java.util.Map;

@Configuration
@EnableJpaRepositories(
    basePackages = "com.tasf.backend.repository.ops",
    entityManagerFactoryRef = "opsEntityManagerFactory",
    transactionManagerRef = "opsTransactionManager"
)
public class OpsDataSourceConfig {

    @Bean
    @ConfigurationProperties("ops.datasource")
    public DataSourceProperties opsDataSourceProperties() {
        return new DataSourceProperties();
    }

    @Bean
    @ConfigurationProperties("ops.datasource.hikari")
    public DataSource opsDataSource(
            @Qualifier("opsDataSourceProperties") DataSourceProperties props) {
        return props.initializeDataSourceBuilder()
                .type(HikariDataSource.class)
                .build();
    }

    @Bean
    public LocalContainerEntityManagerFactoryBean opsEntityManagerFactory(
            EntityManagerFactoryBuilder builder,
            @Qualifier("opsDataSource") DataSource dataSource) {
        return builder
                .dataSource(dataSource)
                .packages("com.tasf.backend.entity")
                .persistenceUnit("ops")
                .properties(Map.of("hibernate.hbm2ddl.auto", "update"))
                .build();
    }

    @Bean
    public PlatformTransactionManager opsTransactionManager(
            @Qualifier("opsEntityManagerFactory") EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }
}
```

`ddl-auto=update` en ops: Hibernate crea la tabla `envios` automáticamente si no existe (alternativa al SQL manual de Task 1).

- [ ] **Step 3: Verificar que el backend arranca sin errores**

```bash
cd backend && ./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

Esperado en logs: `HikariPool-TasfPool - Start completed.` y `HikariPool-OpsPool - Start completed.`. Sin `HibernateException`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/com/tasf/backend/config/SimDataSourceConfig.java
git add backend/src/main/java/com/tasf/backend/config/OpsDataSourceConfig.java
git commit -m "feat(ops): configure dual JPA datasource (sim + ops schemas)"
```

---

## Task 4: OpsEnvioRepository

**Files:**
- Create: `backend/src/main/java/com/tasf/backend/repository/ops/OpsEnvioRepository.java`

- [ ] **Step 1: Crear el package y el repositorio**

```java
package com.tasf.backend.repository.ops;

import com.tasf.backend.entity.EnvioEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface OpsEnvioRepository extends JpaRepository<EnvioEntity, Long> {

    boolean existsByIdPedido(String idPedido);

    @Query("SELECT e.iataOrigen, SUM(e.cantidadMaletas) FROM EnvioEntity e " +
           "WHERE e.estado = 'PENDIENTE' AND e.fechaHoraIngreso <= :from " +
           "GROUP BY e.iataOrigen")
    List<Object[]> sumMaletasPendientesByAeropuerto(@Param("from") LocalDateTime from);

    @Query("SELECT e FROM EnvioEntity e WHERE e.estado = 'PENDIENTE' ORDER BY e.fechaHoraIngreso ASC")
    List<EnvioEntity> findAllPendientesOrdenados();

    List<EnvioEntity> findAllByOrderByFechaHoraIngresoDesc();
}
```

Spring Data JPA usa `opsEntityManagerFactory` para este repo porque está en el package `com.tasf.backend.repository.ops`, que es el `basePackages` de `OpsDataSourceConfig`.

- [ ] **Step 2: Verificar arranque sin errores**

```bash
cd backend && ./mvnw spring-boot:run -Dspring-boot.run.profiles=local 2>&1 | grep -E "ERROR|OpsEnvio|opsEntity"
```

Esperado: sin errores relacionados con `OpsEnvioRepository`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/tasf/backend/repository/ops/
git commit -m "feat(ops): add OpsEnvioRepository on ops datasource"
```

---

## Task 5: DTOs para ops

**Files:**
- Create: `backend/src/main/java/com/tasf/backend/dto/OpsEnvioRequestDTO.java`
- Create: `backend/src/main/java/com/tasf/backend/dto/OpsReporteDTO.java`

- [ ] **Step 1: Crear OpsEnvioRequestDTO.java**

```java
package com.tasf.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OpsEnvioRequestDTO {
    /** IATA del aeropuerto de origen (4 letras, ej. "SKBO") */
    private String iataOrigen;

    /** IATA del aeropuerto de destino (4 letras, ej. "LEMD") */
    private String iataDestino;

    /** Número de maletas del envío */
    private int cantidadMaletas;

    /**
     * Fecha y hora de ingreso en la zona horaria del aeropuerto origen.
     * Formato ISO-8601 con offset: "2026-06-08T14:30:00-05:00"
     * El backend convierte a UTC antes de persistir.
     */
    private String fechaHoraIngreso;
}
```

- [ ] **Step 2: Crear OpsReporteDTO.java**

```java
package com.tasf.backend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OpsReporteDTO {
    private int totalEnvios;
    private int enviosPendientes;
    private int enviosEntregados;
    private int enviosViolados;
    private int totalMaletas;
    private double porcentajeCumplimientoSla;
    /** Timestamp del reporte en ISO-8601 UTC */
    private String generadoEn;
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/tasf/backend/dto/OpsEnvioRequestDTO.java
git add backend/src/main/java/com/tasf/backend/dto/OpsReporteDTO.java
git commit -m "feat(ops): add OpsEnvioRequestDTO and OpsReporteDTO"
```

---

## Task 6: OpsService

**Files:**
- Create: `backend/src/main/java/com/tasf/backend/service/OpsService.java`

`OpsService` concentra toda la lógica de ops: estado en vivo, ingreso de envíos, SA planning (planes en memoria), y reporte. Reutiliza `DataLoaderService` (aeropuertos+vuelos en memoria) y `PlanningService` (SA).

- [ ] **Step 1: Crear OpsService.java**

```java
package com.tasf.backend.service;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.EstadoEnvio;
import com.tasf.backend.domain.ParametrosSimulacion;
import com.tasf.backend.domain.PlanDeViaje;
import com.tasf.backend.domain.PlanningResult;
import com.tasf.backend.domain.Vuelo;
import com.tasf.backend.dto.LiveStateDTO;
import com.tasf.backend.dto.LiveStateDTO.LiveAeropuertoDTO;
import com.tasf.backend.dto.LiveStateDTO.LiveVueloDTO;
import com.tasf.backend.dto.OpsEnvioRequestDTO;
import com.tasf.backend.dto.OpsReporteDTO;
import com.tasf.backend.entity.EnvioEntity;
import com.tasf.backend.repository.ops.OpsEnvioRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class OpsService {

    private static final Logger log = LoggerFactory.getLogger(OpsService.class);
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm");

    private final OpsEnvioRepository opsEnvioRepository;
    private final DataLoaderService dataLoaderService;
    private final PlanningService planningService;

    /** Planes calculados por SA. Se pierden al reiniciar el servidor. */
    private final Map<String, PlanDeViaje> planesPorEnvio = new ConcurrentHashMap<>();

    private static final ParametrosSimulacion OPS_PARAMS = ParametrosSimulacion.builder()
            .algoritmo("SIMULATED_ANNEALING")
            .minutosEscalaMinima(10)
            .minutosRecogidaDestino(10)
            .umbralSemaforoVerde(60)
            .umbralSemaforoAmbar(85)
            .fechaInicio(LocalDate.now())
            .build();

    public OpsService(OpsEnvioRepository opsEnvioRepository,
                      DataLoaderService dataLoaderService,
                      PlanningService planningService) {
        this.opsEnvioRepository = opsEnvioRepository;
        this.dataLoaderService = dataLoaderService;
        this.planningService = planningService;
    }

    /** Estado en vivo del modo ops: aeropuertos con ocupación real + vuelos activos ahora. */
    public LiveStateDTO getLiveState(LocalDateTime from) {
        List<Object[]> rows = opsEnvioRepository.sumMaletasPendientesByAeropuerto(from);
        Map<String, Long> pendingByIata = new HashMap<>();
        for (Object[] row : rows) {
            pendingByIata.put((String) row[0], ((Number) row[1]).longValue());
        }

        Map<String, Integer> husoByIata = new HashMap<>();
        for (Aeropuerto a : dataLoaderService.getAeropuertos()) {
            husoByIata.put(a.getCodigoIATA(), a.getHuso());
        }

        List<LiveAeropuertoDTO> aeropuertoDTOs = new ArrayList<>();
        for (Aeropuerto a : dataLoaderService.getAeropuertos()) {
            long pending = pendingByIata.getOrDefault(a.getCodigoIATA(), 0L);
            int maletasPendientes = (int) Math.min(pending, Integer.MAX_VALUE);
            double ocupacionPct = a.getCapacidadAlmacen() > 0
                    ? Math.max(0, Math.min(100, (double) maletasPendientes / a.getCapacidadAlmacen() * 100))
                    : 0.0;
            String semaforo = ocupacionPct < 70 ? "GREEN" : ocupacionPct < 90 ? "AMBER" : "RED";

            aeropuertoDTOs.add(LiveAeropuertoDTO.builder()
                    .codigoIATA(a.getCodigoIATA())
                    .nombre(a.getNombre())
                    .ciudad(a.getCiudad())
                    .continente(a.getContinente())
                    .lat(a.getLat())
                    .lng(a.getLng())
                    .capacidadAlmacen(a.getCapacidadAlmacen())
                    .maletasPendientes(maletasPendientes)
                    .ocupacionPct(ocupacionPct)
                    .semaforo(semaforo)
                    .build());
        }

        int nowMin = from.getHour() * 60 + from.getMinute();
        int endMin = nowMin + 60;
        List<LiveVueloDTO> vueloDTOs = new ArrayList<>();
        for (Vuelo v : dataLoaderService.getVuelos()) {
            int depMin = v.getHoraSalida().getHour() * 60 + v.getHoraSalida().getMinute();
            int arrMin = v.getHoraLlegada().getHour() * 60 + v.getHoraLlegada().getMinute();
            boolean overnight = depMin > arrMin;
            boolean inFlight = !overnight ? (depMin <= nowMin && arrMin >= nowMin) : (nowMin >= depMin || nowMin < arrMin);
            boolean departingSoon = endMin <= 1440 ? (depMin >= nowMin && depMin <= endMin) : (depMin >= nowMin || depMin <= endMin - 1440);
            if (!inFlight && !departingSoon) continue;

            int duration = (arrMin - depMin + 1440) % 1440;
            double fraction = 0;
            if (duration > 0 && (nowMin >= depMin || (overnight && nowMin < arrMin))) {
                fraction = Math.max(0, Math.min(1, (double)((nowMin - depMin + 1440) % 1440) / duration));
            }

            vueloDTOs.add(LiveVueloDTO.builder()
                    .codigoVuelo(v.getCodigoVuelo())
                    .origen(v.getOrigen())
                    .destino(v.getDestino())
                    .horaSalida(v.getHoraSalida().format(TIME_FMT))
                    .horaLlegada(v.getHoraLlegada().format(TIME_FMT))
                    .tipo(v.getTipo())
                    .capacidadTotal(v.getCapacidadTotal())
                    .fraction(fraction)
                    .husOrigen(husoByIata.get(v.getOrigen()))
                    .build());
        }

        return LiveStateDTO.builder().aeropuertos(aeropuertoDTOs).vuelos(vueloDTOs).build();
    }

    /**
     * Agrega un envío manualmente. La hora viene en la zona horaria del aeropuerto origen;
     * se convierte a UTC antes de persistir.
     */
    @Transactional("opsTransactionManager")
    public EnvioEntity addEnvio(OpsEnvioRequestDTO dto) {
        OffsetDateTime offsetDt = OffsetDateTime.parse(dto.getFechaHoraIngreso());
        LocalDateTime ingresoUtc = offsetDt.withOffsetSameInstant(ZoneOffset.UTC).toLocalDateTime();

        Map<String, String> continentByAirport = new HashMap<>();
        for (Aeropuerto a : dataLoaderService.getAeropuertos()) {
            continentByAirport.put(a.getCodigoIATA(), a.getContinente());
        }
        String continOrigen = continentByAirport.getOrDefault(dto.getIataOrigen(), "");
        String continDestino = continentByAirport.getOrDefault(dto.getIataDestino(), "");
        int sla = continOrigen.equals(continDestino) ? 1 : 2;

        String idPedido = "OPS-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();

        EnvioEntity entity = EnvioEntity.builder()
                .idPedido(idPedido)
                .iataOrigen(dto.getIataOrigen())
                .iataDestino(dto.getIataDestino())
                .cantidadMaletas(dto.getCantidadMaletas())
                .fechaHoraIngreso(ingresoUtc)
                .sla(sla)
                .estado("PENDIENTE")
                .build();

        EnvioEntity saved = opsEnvioRepository.save(entity);
        log.info("Ops envío added: {} ({} -> {}, {} bags)", idPedido, dto.getIataOrigen(), dto.getIataDestino(), dto.getCantidadMaletas());
        return saved;
    }

    /**
     * Corre SA sobre todos los envíos PENDIENTE del schema ops.
     * Planes quedan en memoria (planesPorEnvio). Idempotente: re-planifica todos los pendientes.
     */
    public PlanningResult planificar() {
        List<EnvioEntity> pendientes = opsEnvioRepository.findAllPendientesOrdenados();
        if (pendientes.isEmpty()) {
            return PlanningResult.builder().planes(List.of()).enviosSinRuta(List.of()).build();
        }

        List<Envio> domainEnvios = pendientes.stream().map(this::toDomain).toList();
        PlanningResult result = planningService.planificar(
                domainEnvios,
                dataLoaderService.getVuelos(),
                dataLoaderService.getAeropuertos(),
                OPS_PARAMS
        );

        for (PlanDeViaje plan : result.getPlanes()) {
            planesPorEnvio.put(plan.getIdEnvio(), plan);
        }

        log.info("Ops planning: {} envíos -> {} planes, {} sin ruta",
                domainEnvios.size(), result.getPlanes().size(), result.getEnviosSinRuta().size());
        return result;
    }

    /** Lista todos los envíos del schema ops con su plan si existe. */
    public List<EnvioEntity> getEnvios() {
        return opsEnvioRepository.findAllByOrderByFechaHoraIngresoDesc();
    }

    /** Plan en memoria para un envío dado por idPedido. Null si no fue planificado aún. */
    public PlanDeViaje getPlan(String idPedido) {
        return planesPorEnvio.get(idPedido);
    }

    /** KPI resumen del día actual en el schema ops. */
    public OpsReporteDTO getReporte() {
        List<EnvioEntity> todos = opsEnvioRepository.findAll();
        int pendientes = 0, entregados = 0, violados = 0, maletas = 0;
        for (EnvioEntity e : todos) {
            maletas += e.getCantidadMaletas();
            switch (e.getEstado()) {
                case "PENDIENTE" -> pendientes++;
                case "ENTREGADO" -> entregados++;
                case "VIOLADO"   -> violados++;
            }
        }
        int total = todos.size();
        double cumplimiento = total > 0 ? (double) entregados / total * 100 : 0;

        return OpsReporteDTO.builder()
                .totalEnvios(total)
                .enviosPendientes(pendientes)
                .enviosEntregados(entregados)
                .enviosViolados(violados)
                .totalMaletas(maletas)
                .porcentajeCumplimientoSla(Math.round(cumplimiento * 10.0) / 10.0)
                .generadoEn(LocalDateTime.now(ZoneOffset.UTC).toString())
                .build();
    }

    private Envio toDomain(EnvioEntity e) {
        return Envio.builder()
                .idEnvio(e.getIdPedido())
                .aeropuertoOrigen(e.getIataOrigen())
                .aeropuertoDestino(e.getIataDestino())
                .cantidadMaletas(e.getCantidadMaletas())
                .fechaHoraIngreso(e.getFechaHoraIngreso())
                .sla(e.getSla())
                .estado(EstadoEnvio.valueOf(e.getEstado()))
                .build();
    }
}
```

- [ ] **Step 2: Verificar que el backend compila**

```bash
cd backend && ./mvnw compile -q
```

Esperado: BUILD SUCCESS sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/com/tasf/backend/service/OpsService.java
git commit -m "feat(ops): add OpsService with live state, envio ingress, SA planning, report"
```

---

## Task 7: OpsController

**Files:**
- Create: `backend/src/main/java/com/tasf/backend/controller/OpsController.java`

- [ ] **Step 1: Crear OpsController.java**

```java
package com.tasf.backend.controller;

import com.tasf.backend.dto.LiveStateDTO;
import com.tasf.backend.dto.OpsEnvioRequestDTO;
import com.tasf.backend.dto.OpsReporteDTO;
import com.tasf.backend.entity.EnvioEntity;
import com.tasf.backend.service.OpsService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/ops")
public class OpsController {

    private final OpsService opsService;

    public OpsController(OpsService opsService) {
        this.opsService = opsService;
    }

    /** Estado en vivo del mapa (aeropuertos + vuelos activos) para ops. */
    @GetMapping("/state")
    public ResponseEntity<LiveStateDTO> getState(
            @RequestParam(required = false) String from) {
        LocalDateTime fromDateTime;
        if (from == null || from.isBlank()) {
            fromDateTime = LocalDateTime.now();
        } else {
            try {
                fromDateTime = LocalDateTime.parse(from);
            } catch (DateTimeParseException e) {
                return ResponseEntity.badRequest().build();
            }
        }
        return ResponseEntity.ok(opsService.getLiveState(fromDateTime));
    }

    /** Ingresa un envío manualmente al schema ops. */
    @PostMapping("/envios")
    public ResponseEntity<Map<String, Object>> addEnvio(
            @RequestBody OpsEnvioRequestDTO dto) {
        try {
            EnvioEntity saved = opsService.addEnvio(dto);
            return ResponseEntity.ok(Map.of(
                    "status", "SUCCESS",
                    "idPedido", saved.getIdPedido(),
                    "id", saved.getId()
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "ERROR",
                    "message", e.getMessage()
            ));
        }
    }

    /** Dispara SA sobre todos los envíos PENDIENTE del schema ops. */
    @PostMapping("/planificar")
    public ResponseEntity<Map<String, Object>> planificar() {
        try {
            var result = opsService.planificar();
            return ResponseEntity.ok(Map.of(
                    "status", "SUCCESS",
                    "planesCalculados", result.getPlanes().size(),
                    "sinRuta", result.getEnviosSinRuta().size()
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "status", "ERROR",
                    "message", e.getMessage()
            ));
        }
    }

    /** Lista todos los envíos del schema ops. */
    @GetMapping("/envios")
    public ResponseEntity<List<EnvioEntity>> getEnvios() {
        return ResponseEntity.ok(opsService.getEnvios());
    }

    /** KPI resumen del día actual. */
    @GetMapping("/reporte")
    public ResponseEntity<OpsReporteDTO> getReporte() {
        return ResponseEntity.ok(opsService.getReporte());
    }
}
```

- [ ] **Step 2: Verificar compilación**

```bash
cd backend && ./mvnw compile -q
```

Esperado: BUILD SUCCESS.

- [ ] **Step 3: Smoke test manual — arrancar backend y probar endpoints**

```bash
# Arrancar
cd backend && ./mvnw spring-boot:run -Dspring-boot.run.profiles=local

# En otra terminal:
curl -s http://localhost:8080/api/ops/state | python3 -m json.tool | head -20
# Esperado: JSON con aeropuertos y vuelos, envíos pendientes = 0 inicialmente

curl -s http://localhost:8080/api/ops/reporte | python3 -m json.tool
# Esperado: {"totalEnvios":0,"enviosPendientes":0,...}

curl -s -X POST http://localhost:8080/api/ops/envios \
  -H "Content-Type: application/json" \
  -d '{"iataOrigen":"SKBO","iataDestino":"LEMD","cantidadMaletas":3,"fechaHoraIngreso":"2026-06-08T14:30:00-05:00"}' \
  | python3 -m json.tool
# Esperado: {"status":"SUCCESS","idPedido":"OPS-XXXXXXXX","id":1}

curl -s -X POST http://localhost:8080/api/ops/planificar | python3 -m json.tool
# Esperado: {"status":"SUCCESS","planesCalculados":1,"sinRuta":0}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/com/tasf/backend/controller/OpsController.java
git commit -m "feat(ops): add OpsController with state, envio, planificar, reporte endpoints"
```

---

## Task 8: Upload TXT para ops schema

**Files:**
- Modify: `backend/src/main/java/com/tasf/backend/service/EnvioUploadService.java`
- Modify: `backend/src/main/java/com/tasf/backend/controller/UploadController.java`

- [ ] **Step 1: Añadir método processOpsUpload en EnvioUploadService**

En `EnvioUploadService.java`, añadir la inyección de `OpsEnvioRepository` y el nuevo método. El constructor actual recibe `EnvioRepository, AeropuertoRepository, BaggageParser, SimulationEngine`. Añadir `OpsEnvioRepository`:

```java
// Añadir al inicio de la clase (campo):
private final OpsEnvioRepository opsEnvioRepository;

// Modificar el constructor para añadir el parámetro:
public EnvioUploadService(
        EnvioRepository envioRepository,
        AeropuertoRepository aeropuertoRepository,
        BaggageParser baggageParser,
        SimulationEngine simulationEngine,
        OpsEnvioRepository opsEnvioRepository) {
    this.envioRepository = envioRepository;
    this.aeropuertoRepository = aeropuertoRepository;
    this.baggageParser = baggageParser;
    this.simulationEngine = simulationEngine;
    this.opsEnvioRepository = opsEnvioRepository;
}

// Añadir método al final de la clase (antes del cierre de }):
@Transactional("opsTransactionManager")
public List<Envio> processOpsUpload(MultipartFile file) throws IOException {
    String filename = file.getOriginalFilename();
    Matcher matcher = IATA_PATTERN.matcher(filename != null ? filename : "");
    if (!matcher.find()) {
        throw new IllegalArgumentException("Invalid filename format. Expected: _envios_XXXX_.txt");
    }
    String iata = matcher.group(1).toUpperCase();
    Map<String, String> continentByAirport = aeropuertoRepository.findAll().stream()
        .collect(Collectors.toMap(e -> e.getCodigoIata(), e -> e.getContinente()));

    List<Envio> domainEnvios;
    try (InputStream in = file.getInputStream()) {
        domainEnvios = baggageParser.parseEnvios(in, iata, java.time.LocalDate.MIN, null, continentByAirport);
    }

    List<Envio> newDomainEnvios = domainEnvios.stream()
        .filter(e -> !opsEnvioRepository.existsByIdPedido(e.getIdEnvio()))
        .toList();

    if (newDomainEnvios.isEmpty()) {
        log.info("No new ops envios found in file (all duplicates).");
        return List.of();
    }

    saveOpsEnviosInBatches(newDomainEnvios);
    log.info("Ops upload: saved {} envios from {}", newDomainEnvios.size(), filename);
    return newDomainEnvios;
}

private void saveOpsEnviosInBatches(List<Envio> domainEnvios) {
    List<EnvioEntity> batch = new ArrayList<>();
    for (int i = 0; i < domainEnvios.size(); i++) {
        batch.add(mapToEntity(domainEnvios.get(i)));
        if (batch.size() >= BATCH_SIZE) {
            opsEnvioRepository.saveAll(batch);
            batch.clear();
        }
    }
    if (!batch.isEmpty()) {
        opsEnvioRepository.saveAll(batch);
    }
}
```

- [ ] **Step 2: Añadir endpoint /api/ops/upload/envios en UploadController**

En `UploadController.java`, añadir inyección de `OpsService` y el nuevo endpoint:

```java
// Añadir campo:
private final OpsService opsService;

// Modificar constructor:
public UploadController(EnvioUploadService envioUploadService, OpsService opsService) {
    this.envioUploadService = envioUploadService;
    this.opsService = opsService;
}

// Añadir endpoint:
@PostMapping("/ops/envios")
public ResponseEntity<Map<String, Object>> uploadOpsEnvios(@RequestParam("file") MultipartFile file) {
    Map<String, Object> response = new HashMap<>();
    try {
        List<Envio> nuevos = envioUploadService.processOpsUpload(file);
        response.put("status", "SUCCESS");
        response.put("message", "File processed successfully");
        response.put("count", nuevos.size());
        return ResponseEntity.ok(response);
    } catch (IllegalArgumentException e) {
        response.put("status", "ERROR");
        response.put("message", e.getMessage());
        return ResponseEntity.badRequest().body(response);
    } catch (IOException e) {
        response.put("status", "ERROR");
        response.put("message", "Failed to read file: " + e.getMessage());
        return ResponseEntity.status(500).body(response);
    }
}
```

- [ ] **Step 3: Compilar y verificar**

```bash
cd backend && ./mvnw compile -q
```

- [ ] **Step 4: Smoke test del upload ops**

```bash
# Con el backend corriendo y un archivo de prueba disponible:
curl -s -X POST http://localhost:8080/api/upload/ops/envios \
  -F "file=@backend/src/test/resources/data/_envios_SKBO_.txt" \
  | python3 -m json.tool
# Esperado: {"status":"SUCCESS","count":N}
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/com/tasf/backend/service/EnvioUploadService.java
git add backend/src/main/java/com/tasf/backend/controller/UploadController.java
git commit -m "feat(ops): add ops TXT upload endpoint reusing BaggageParser"
```

---

## Task 9: api.js — funciones ops

**Files:**
- Modify: `src/services/api.js`

- [ ] **Step 1: Añadir funciones ops al final del archivo api.js**

Añadir después de las funciones existentes (antes del cierre del archivo):

```js
// ── Ops mode API ──────────────────────────────────────────────────

export async function getOpsState(fromISO) {
  return withHandling('getOpsState', () =>
    request(`/ops/state${fromISO ? `?from=${encodeURIComponent(fromISO)}` : ''}`)
  )
}

export async function addOpsEnvio(dto) {
  return withHandling('addOpsEnvio', () =>
    request('/ops/envios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    })
  )
}

export async function planificarOps() {
  return withHandling('planificarOps', () =>
    request('/ops/planificar', { method: 'POST' })
  )
}

export async function getOpsEnvios() {
  return withHandling('getOpsEnvios', () => request('/ops/envios'))
}

export async function getOpsReporte() {
  return withHandling('getOpsReporte', () => request('/ops/reporte'))
}

export async function uploadOpsEnvios(file) {
  return withHandling('uploadOpsEnvios', async () => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${BASE_URL}/upload/ops/envios`, {
      method: 'POST',
      body: formData,
      mode: 'cors',
      credentials: 'omit',
    })
    if (!response.ok) throw await toApiError(response)
    return response.json()
  })
}
```

También añadir las funciones dentro del objeto `api` exportado (para consistencia con el uso existente en ConfigScreen que usa `api.uploadEnvios`):

```js
// Dentro del objeto `api = { ... }`, añadir al final antes del cierre `}`:
uploadOpsEnvios: async (file) => uploadOpsEnvios(file),
addOpsEnvio: async (dto) => addOpsEnvio(dto),
planificarOps: async () => planificarOps(),
getOpsEnvios: async () => getOpsEnvios(),
getOpsReporte: async () => getOpsReporte(),
```

- [ ] **Step 2: Verificar que el frontend compila sin errores**

```bash
npm run build 2>&1 | tail -10
```

Esperado: sin errores de import/export.

- [ ] **Step 3: Commit**

```bash
git add src/services/api.js
git commit -m "feat(ops): add ops API functions to api.js"
```

---

## Task 10: OpsEnviosIngress component

**Files:**
- Create: `src/components/OpsEnviosIngress.jsx`

Este componente tiene 3 zonas: upload TXT (arriba izquierda, reusa lógica de ConfigScreen), formulario manual (arriba derecha), tabla preview de envíos cargados (abajo). Se usa tanto en `ConfigScreen` (antes de iniciar) como en `OpsScreen` (panel lateral tras iniciar).

- [ ] **Step 1: Crear OpsEnviosIngress.jsx**

```jsx
import React, { useEffect, useRef, useState } from 'react'
import { api, addOpsEnvio, planificarOps, uploadOpsEnvios } from '../services/api.js'

const FILE_PATTERN = /_envios_[A-Za-z]{4}_\.txt$/i

function sectionLabel(text) {
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase',
      letterSpacing: 2, color: 'var(--muted)', marginBottom: 8, display: 'block',
    }}>
      {text}
    </span>
  )
}

/**
 * airports: array de { id: 'IATA', name: 'Nombre', huso: -5, ... }
 * onEnviosChanged: callback cuando se agregan nuevos envíos (para refrescar lista externa)
 */
export default function OpsEnviosIngress({ airports = [], onEnviosChanged }) {
  // ── Upload TXT state ──
  const [uploadFiles, setUploadFiles] = useState([])
  const [uploadFileError, setUploadFileError] = useState(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 })
  const fileInputRef = useRef(null)

  // ── Manual form state ──
  const [formOrigen, setFormOrigen] = useState('')
  const [formDestino, setFormDestino] = useState('')
  const [formCantidad, setFormCantidad] = useState(1)
  const [formHora, setFormHora] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState(null)
  const [formSuccess, setFormSuccess] = useState(null)

  // ── Planificar state ──
  const [planLoading, setPlanLoading] = useState(false)
  const [planResult, setPlanResult] = useState(null)

  // Hora local del aeropuerto origen seleccionado
  const origenAirport = airports.find(a => a.id === formOrigen)
  const localTimeLabel = origenAirport
    ? (() => {
        const utcOffset = origenAirport.huso ?? 0
        const now = new Date()
        const localMs = now.getTime() + (utcOffset * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000)
        const local = new Date(localMs)
        const h = String(local.getUTCHours()).padStart(2,'0')
        const m = String(local.getUTCMinutes()).padStart(2,'0')
        return `Hora local en ${formOrigen} (UTC${utcOffset >= 0 ? '+' : ''}${utcOffset}): ${h}:${m}`
      })()
    : 'Seleccionar origen para ver hora local'

  function handleFileChange(e) {
    const files = Array.from(e.target.files || [])
    setUploadResult(null)
    setUploadError(null)
    if (!files.length) { setUploadFiles([]); setUploadFileError(null); return }
    const notTxt = files.find(f => !f.name.toLowerCase().endsWith('.txt'))
    if (notTxt) { setUploadFiles([]); setUploadFileError('Solo archivos .txt'); return }
    const valid = files.filter(f => FILE_PATTERN.test(f.name))
    const invalid = files.filter(f => !FILE_PATTERN.test(f.name))
    if (!valid.length) { setUploadFiles([]); setUploadFileError('Formato inválido. Debe ser: _envios_XXXX_.txt'); return }
    setUploadFiles(valid.map(f => ({ file: f, status: 'pending', error: null })))
    setUploadFileError(invalid.length > 0 ? `Ignorados ${invalid.length}: ${invalid.map(f => f.name).join(', ')}` : null)
  }

  async function handleUpload() {
    if (!uploadFiles.length) return
    setUploadLoading(true)
    setUploadError(null)
    setUploadResult(null)
    const initial = [...uploadFiles]
    let totalCount = 0
    const errors = []
    let processed = 0

    for (let i = 0; i < initial.length; i++) {
      const item = initial[i]
      setUploadFiles(prev => { const c = [...prev]; c[i] = { ...c[i], status: 'in_progress' }; return c })
      setUploadProgress({ current: processed, total: initial.length })
      try {
        const result = await uploadOpsEnvios(item.file)
        totalCount += result.count ?? 0
        processed++
        setUploadFiles(prev => { const c = [...prev]; c[i] = { ...c[i], status: 'done' }; return c })
      } catch (err) {
        processed++
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${item.file.name}: ${msg}`)
        setUploadFiles(prev => { const c = [...prev]; c[i] = { ...c[i], status: 'error', error: msg }; return c })
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
    if (errors.length) setUploadError(errors.join(' | '))
    if (totalCount > 0 || !errors.length) setUploadResult({ count: totalCount, files: initial.length })
    setUploadFiles([])
    setUploadLoading(false)
    setUploadProgress({ current: 0, total: 0 })
    if (totalCount > 0 && onEnviosChanged) onEnviosChanged()
  }

  async function handleAddManual(e) {
    e.preventDefault()
    if (!formOrigen || !formDestino || formCantidad < 1) {
      setFormError('Origen, destino y cantidad son obligatorios')
      return
    }
    if (formOrigen === formDestino) { setFormError('Origen y destino no pueden ser iguales'); return }

    // Construir ISO con offset del aeropuerto origen
    const utcOffset = origenAirport?.huso ?? 0
    const today = new Date().toISOString().slice(0, 10)
    const offsetSign = utcOffset >= 0 ? '+' : '-'
    const absOffset = Math.abs(utcOffset)
    const offsetStr = `${offsetSign}${String(absOffset).padStart(2, '0')}:00`
    const fechaHoraIngreso = `${today}T${formHora}:00${offsetStr}`

    setFormLoading(true)
    setFormError(null)
    setFormSuccess(null)
    try {
      await addOpsEnvio({ iataOrigen: formOrigen, iataDestino: formDestino, cantidadMaletas: Number(formCantidad), fechaHoraIngreso })
      setFormSuccess(`Envío agregado: ${formOrigen} → ${formDestino}, ${formCantidad} maleta(s)`)
      setFormDestino('')
      setFormCantidad(1)
      if (onEnviosChanged) onEnviosChanged()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setFormLoading(false)
    }
  }

  async function handlePlanificar() {
    setPlanLoading(true)
    setPlanResult(null)
    try {
      const result = await planificarOps()
      setPlanResult(result)
    } catch (err) {
      setPlanResult({ status: 'ERROR', message: err.message })
    } finally {
      setPlanLoading(false)
    }
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
    color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12,
    padding: '6px 8px', width: '100%', boxSizing: 'border-box',
  }
  const selectStyle = { ...inputStyle }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top: Upload TXT + Form manual lado a lado */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '16px 16px 8px', flexShrink: 0 }}>

        {/* Upload TXT */}
        <div>
          {sectionLabel('Cargar archivo TXT')}
          <input ref={fileInputRef} type="file" accept=".txt" multiple onChange={handleFileChange}
            disabled={uploadLoading} style={{ display: 'none' }} id="ops-upload-input" />
          <label htmlFor="ops-upload-input" style={{
            display: 'block', padding: '6px 10px', border: '1px solid var(--border)',
            color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11,
            textTransform: 'uppercase', letterSpacing: 1, cursor: uploadLoading ? 'not-allowed' : 'pointer',
            textAlign: 'center', marginBottom: 6,
          }}>
            Seleccionar archivos
          </label>
          {uploadFileError && <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 10, marginBottom: 4 }}>{uploadFileError}</div>}
          {uploadFiles.length > 0 && !uploadFileError && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 6px', maxHeight: 80, overflowY: 'auto' }}>
              {uploadFiles.map((item, idx) => {
                const color = item.status === 'done' ? 'var(--green)' : item.status === 'error' ? 'var(--red)' : item.status === 'in_progress' ? 'var(--blue)' : 'var(--muted)'
                return (
                  <li key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'var(--mono)', fontSize: 10, marginBottom: 3 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file.name}</span>
                  </li>
                )
              })}
            </ul>
          )}
          {uploadFiles.length > 0 && (
            <button onClick={handleUpload} disabled={uploadLoading}
              style={{ width: '100%', padding: '5px 8px', background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.3)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, cursor: uploadLoading ? 'not-allowed' : 'pointer' }}>
              {uploadLoading ? 'Subiendo...' : 'Subir'}
            </button>
          )}
          {uploadResult && <div style={{ color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 10, marginTop: 4 }}>{uploadResult.count} envíos cargados</div>}
          {uploadError && <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 10, marginTop: 4 }}>{uploadError}</div>}
          <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 9, marginTop: 4, opacity: 0.6 }}>Formato: _envios_XXXX_.txt</div>
        </div>

        {/* Formulario manual */}
        <div>
          {sectionLabel('Ingreso manual')}
          <form onSubmit={handleAddManual} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <select value={formOrigen} onChange={e => setFormOrigen(e.target.value)} style={selectStyle} disabled={formLoading}>
              <option value="">Origen</option>
              {airports.map(a => <option key={a.id} value={a.id}>{a.id} — {a.name}</option>)}
            </select>
            <select value={formDestino} onChange={e => setFormDestino(e.target.value)} style={selectStyle} disabled={formLoading}>
              <option value="">Destino</option>
              {airports.filter(a => a.id !== formOrigen).map(a => <option key={a.id} value={a.id}>{a.id} — {a.name}</option>)}
            </select>
            <input type="number" min={1} max={999} value={formCantidad}
              onChange={e => setFormCantidad(e.target.value)} style={inputStyle}
              placeholder="Cantidad de maletas" disabled={formLoading} />
            <div>
              <input type="time" value={formHora} onChange={e => setFormHora(e.target.value)}
                style={inputStyle} disabled={formLoading} />
              <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 9, marginTop: 2, opacity: 0.7 }}>{localTimeLabel}</div>
            </div>
            {formError && <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 10 }}>{formError}</div>}
            {formSuccess && <div style={{ color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 10 }}>{formSuccess}</div>}
            <button type="submit" disabled={formLoading}
              style={{ padding: '6px 10px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', color: '#22c55e', fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, cursor: formLoading ? 'not-allowed' : 'pointer' }}>
              {formLoading ? 'Agregando...' : '+ Agregar envío'}
            </button>
          </form>
        </div>
      </div>

      {/* Planificar button */}
      <div style={{ padding: '0 16px 8px', flexShrink: 0 }}>
        <button onClick={handlePlanificar} disabled={planLoading}
          style={{ width: '100%', padding: '7px 12px', background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.35)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, cursor: planLoading ? 'not-allowed' : 'pointer', opacity: planLoading ? 0.6 : 1 }}>
          {planLoading ? 'Planificando...' : '▶ Planificar rutas (SA)'}
        </button>
        {planResult && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, marginTop: 4, color: planResult.status === 'ERROR' ? 'var(--red)' : 'var(--green)' }}>
            {planResult.status === 'ERROR' ? planResult.message : `${planResult.planesCalculados} planes calculados${planResult.sinRuta > 0 ? `, ${planResult.sinRuta} sin ruta` : ''}`}
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }} />
    </div>
  )
}
```

- [ ] **Step 2: Verificar que el frontend arranca sin errores**

```bash
npm run dev 2>&1 | grep -E "error|Error" | head -5
```

Esperado: sin errores de compilación.

- [ ] **Step 3: Commit**

```bash
git add src/components/OpsEnviosIngress.jsx
git commit -m "feat(ops): add OpsEnviosIngress component (file upload + manual form + planificar)"
```

---

## Task 11: ConfigScreen — modo selector y layout ops

**Files:**
- Modify: `src/screens/ConfigScreen.jsx`

- [ ] **Step 1: Añadir estado modoConfig al top del componente**

En `ConfigScreen.jsx`, dentro de la función `ConfigScreen`, añadir al inicio del bloque de estados (después de `const [periodo, setPeriodo]`):

```js
const [modoConfig, setModoConfig] = useState('simulacion') // 'simulacion' | 'operaciones'
const [opsEnviosCount, setOpsEnviosCount] = useState(0)
```

- [ ] **Step 2: Reemplazar el handler de simulación para que maneje ambos modos**

El botón de acción inferior debe cambiar según el modo. Modificar el footer del `<section>` (línea 541 aprox):

```jsx
{/* Reemplazar el botón SIMULAR existente por esto: */}
<button
  onClick={modoConfig === 'simulacion' ? handleSimular : () => onOperacionesStarted()}
  disabled={modoConfig === 'simulacion' ? (Boolean(semaforoError) || loading) : false}
  style={{
    background: modoConfig === 'simulacion' ? 'rgba(88,166,255,0.12)' : 'rgba(34,197,94,0.12)',
    border: `1px solid ${modoConfig === 'simulacion' ? 'rgba(88,166,255,0.4)' : 'rgba(34,197,94,0.4)'}`,
    color: modoConfig === 'simulacion' ? 'var(--blue)' : '#22c55e',
    fontFamily: 'var(--mono)', fontSize: 13, textTransform: 'uppercase',
    letterSpacing: 1, fontWeight: 700, padding: '8px 20px',
    cursor: (modoConfig === 'simulacion' && (Boolean(semaforoError) || loading)) ? 'not-allowed' : 'pointer',
    opacity: (modoConfig === 'simulacion' && (Boolean(semaforoError) || loading)) ? 0.35 : 1,
  }}
>
  {modoConfig === 'simulacion'
    ? (loading ? 'PROCESANDO...' : '▶ SIMULAR')
    : '▶ INICIAR OPERACIONES'}
</button>
```

- [ ] **Step 3: Añadir selector de modo encima del grid principal**

En el `return`, reemplazar el `<>` externo y añadir el selector antes del `<div style={{ height: '100%', display: 'grid'...`:

```jsx
return (
  <>
    {loading && ( /* spinner existente sin cambios */ )}

    {/* Selector de modo — encima del grid */}
    <div style={{ display: 'flex', gap: 8, padding: '12px 20px 0', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
      {[
        { key: 'simulacion', label: 'Simulación', color: 'var(--blue)' },
        { key: 'operaciones', label: 'Operaciones día a día', color: '#22c55e' },
      ].map(opt => {
        const active = modoConfig === opt.key
        return (
          <button key={opt.key} onClick={() => setModoConfig(opt.key)}
            style={{
              padding: '6px 16px', fontFamily: 'var(--mono)', fontSize: 12,
              textTransform: 'uppercase', letterSpacing: 1,
              background: active ? `rgba(${opt.key === 'simulacion' ? '88,166,255' : '34,197,94'},0.1)` : 'transparent',
              border: `1px solid ${active ? opt.color : 'var(--border)'}`,
              color: active ? opt.color : 'var(--muted)', cursor: 'pointer',
              borderBottom: active ? `2px solid ${opt.color}` : '1px solid var(--border)',
            }}>
            {opt.label}
          </button>
        )
      })}
    </div>

    {/* Grid principal */}
    <div style={{ height: 'calc(100% - 49px)', display: 'grid',
      gridTemplateColumns: modoConfig === 'simulacion' ? '420px 1fr' : '420px 1fr 1fr',
      background: 'var(--bg)' }}>

      {/* IZQUIERDA — siempre igual (período, fecha, archivos envíos para sim) */}
      <aside style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '24px 20px' }}>
        {modoConfig === 'simulacion' ? (
          /* contenido existente del aside sin cambios */
          <> ... </>
        ) : (
          /* En ops: solo la parte de upload de archivos (reutilizamos la lógica existente) */
          <div>
            <span style={sectionHeaderStyle()}>Archivos de envíos</span>
            {/* Copiar el bloque de upload existente del aside aquí */}
            ...
          </div>
        )}
      </aside>

      {/* CENTRO — solo en ops: formulario manual */}
      {modoConfig === 'operaciones' && (
        <section style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '24px 20px' }}>
          <span style={sectionHeaderStyle()}>Ingreso manual</span>
          {/* Formulario manual de OpsEnviosIngress — el estado de airports viene del prop */}
          {/* Por ahora: placeholder; en OpsScreen el componente completo estará disponible */}
          <p style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
            Selecciona origen, destino, cantidad y hora para agregar un envío al modo operaciones.
          </p>
        </section>
      )}

      {/* DERECHA — sim: parámetros | ops: preview envíos */}
      <section style={{ overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {modoConfig === 'simulacion' ? (
          /* contenido existente de la section sin cambios */
          <> ... </>
        ) : (
          <div>
            <span style={sectionHeaderStyle()}>Envíos cargados</span>
            <p style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
              {opsEnviosCount > 0 ? `${opsEnviosCount} envíos listos` : 'Ningún envío cargado aún. Sube un archivo o usa el formulario.'}
            </p>
          </div>
        )}
      </section>
    </div>
  </>
)
```

> **Nota:** El paso 3 es intencional como guía de estructura. El implementador debe fusionar este esqueleto con el JSX existente del `return` actual en `ConfigScreen.jsx`. Los bloques `/* contenido existente sin cambios */` deben sustituirse con el código actual de la izquierda y derecha de simulación.

- [ ] **Step 4: Añadir prop onOperacionesStarted a ConfigScreen**

En la firma del componente, añadir el nuevo prop:

```js
export default function ConfigScreen({ onCancel, onSimulationStarted, onOperacionesStarted }) {
```

- [ ] **Step 5: Verificar en el browser que el selector de modo funciona**

```bash
npm run dev
```

Abrir `http://localhost:5173`, ir a Configurar. Verificar que aparecen los dos botones de modo y que el grid cambia de 2 a 3 columnas al seleccionar Operaciones.

- [ ] **Step 6: Commit**

```bash
git add src/screens/ConfigScreen.jsx
git commit -m "feat(ops): add mode selector and ops layout to ConfigScreen"
```

---

## Task 12: OpsScreen

**Files:**
- Create: `src/screens/OpsScreen.jsx`

`OpsScreen` es `LiveScreen` + tab de ingreso de envíos en el panel izquierdo. Polls `GET /api/ops/state` en lugar de `/api/live/state`.

- [ ] **Step 1: Crear OpsScreen.jsx**

```jsx
import React, { useEffect, useMemo, useState } from 'react'
import MapView from '../components/MapView'
import RightPanel from '../components/RightPanel'
import OpsEnviosIngress from '../components/OpsEnviosIngress'
import AirportFilterPanel from '../components/AirportFilterPanel'
import DrawerVuelo from '../drawers/DrawerVuelo'
import DrawerAeropuerto from '../drawers/DrawerAeropuerto'

const PULSE_STYLE = `
@keyframes livePulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.6); }
  50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
}
`

function parseTimeToMinutes(t) {
  if (!t || !t.includes(':')) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function flightFractionAtMinute(now, dep, arr) {
  const total = (arr - dep + 1440) % 1440
  if (total <= 0) return 0
  return Math.max(0, Math.min(1, ((now - dep + 1440) % 1440) / total))
}

function isActiveAtMinute(now, dep, arr) {
  if (dep == null || arr == null) return false
  const m = now >= 1440 ? 1439 : now
  return arr > dep ? (m >= dep && m < arr) : (m >= dep || m < arr)
}

function nowMinutes() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

/**
 * opsState: misma estructura que liveState (LiveStateDTO del backend)
 * theme, onBack: igual que LiveScreen
 */
export default function OpsScreen({ opsState, theme, onBack }) {
  const [leftTab, setLeftTab] = useState('filtros') // 'filtros' | 'envios'
  const [selectedFlight, setSelectedFlight] = useState(null)
  const [selectedVueloData, setSelectedVueloData] = useState(null)
  const [wallClock, setWallClock] = useState(() => new Date().toLocaleTimeString('es-PE'))
  const [liveNowMinutes, setLiveNowMinutes] = useState(nowMinutes)
  const [originIds, setOriginIds] = useState(null)
  const [destIds, setDestIds] = useState(null)
  const [selectedAirport, setSelectedAirport] = useState(null)
  const [threshold, setThreshold] = useState(80)
  const [filterOpen, setFilterOpen] = useState(true)

  useEffect(() => {
    const id = setInterval(() => setWallClock(new Date().toLocaleTimeString('es-PE')), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setLiveNowMinutes(nowMinutes()), 5000)
    return () => clearInterval(id)
  }, [])

  const airports = useMemo(() => {
    if (!opsState?.aeropuertos) return []
    return opsState.aeropuertos.map(a => ({
      id: a.codigoIATA, name: a.nombre, continent: a.continente,
      lat: a.lat, lng: a.lng, currentOccupation: a.ocupacionPct,
      warehouseCapacity: a.capacidadAlmacen, maletasPendientes: a.maletasPendientes,
      semaforo: a.semaforo, ciudad: a.ciudad,
      huso: a.husOrigen ?? 0,
    }))
  }, [opsState?.aeropuertos])

  const flights = useMemo(() => {
    if (!opsState?.vuelos) return []
    return opsState.vuelos.map(v => {
      const depMin = parseTimeToMinutes(v.horaSalida)
      const arrMin = parseTimeToMinutes(v.horaLlegada)
      return {
        id: v.codigoVuelo, origin: v.origen, destination: v.destino,
        type: v.tipo, status: 'active', currentLoad: null,
        capacity: v.capacidadTotal, hour: parseInt(v.horaSalida.split(':')[0], 10),
        horaSalida: v.horaSalida, horaLlegada: v.horaLlegada,
        husOrigen: v.husOrigen ?? null, depMin, arrMin,
        fraction: flightFractionAtMinute(liveNowMinutes, depMin, arrMin),
      }
    }).filter(v => isActiveAtMinute(liveNowMinutes, v.depMin, v.arrMin))
  }, [opsState?.vuelos, liveNowMinutes])

  const originSet = useMemo(() => originIds ? new Set(originIds) : null, [originIds])
  const destSet = useMemo(() => destIds ? new Set(destIds) : null, [destIds])

  const visibleAirports = useMemo(() => {
    if (!originSet && !destSet) return airports
    const visible = new Set()
    for (const ap of airports) {
      if (!originSet || originSet.has(ap.id)) visible.add(ap.id)
      if (!destSet || destSet.has(ap.id)) visible.add(ap.id)
    }
    return airports.filter(a => visible.has(a.id))
  }, [airports, originSet, destSet])

  const visibleFlights = useMemo(() =>
    flights.filter(f => (!originSet || originSet.has(f.origin)) && (!destSet || destSet.has(f.destination))),
    [flights, originSet, destSet]
  )

  const selectedFlightData = useMemo(
    () => visibleFlights.find(f => f.id === selectedFlight) ?? null,
    [visibleFlights, selectedFlight]
  )

  useEffect(() => { setSelectedVueloData(selectedFlightData) }, [selectedFlightData])

  if (!opsState) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, color: 'var(--text-secondary, #888)', fontSize: 14 }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border, #444)', borderTopColor: '#22c55e', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        Cargando operaciones...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{PULSE_STYLE}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '1px solid var(--border, #333)', background: 'var(--panel, #1a1a1a)', flexShrink: 0 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'none', border: '1px solid var(--border, #444)', borderRadius: 4, color: 'var(--text, #eee)', cursor: 'pointer', padding: '3px 10px', fontSize: 13, marginRight: 6 }}>
            ← Volver
          </button>
        )}
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#22c55e', animation: 'livePulse 2s ease-in-out infinite', flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: '#22c55e', letterSpacing: '0.08em' }}>OPERACIONES</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-secondary, #888)', fontVariantNumeric: 'tabular-nums' }}>{wallClock}</span>
      </div>

      {/* 3-column: left panel | map | right panel */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `${filterOpen ? '260px' : '0px'} 1fr 300px`, overflow: 'hidden', minHeight: 0, transition: 'grid-template-columns 0.4s cubic-bezier(0.4,0,0.2,1)' }}>

        {/* Left panel con tabs Filtros | Envíos */}
        <div style={{ overflow: 'hidden', height: '100%', borderRight: filterOpen ? '1px solid var(--border)' : 'none', background: 'var(--panel)', display: 'flex', flexDirection: 'column' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {['filtros', 'envios'].map(tab => (
              <button key={tab} onClick={() => setLeftTab(tab)}
                style={{ flex: 1, padding: '8px 4px', fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, background: leftTab === tab ? 'rgba(34,197,94,0.08)' : 'transparent', border: 'none', borderBottom: leftTab === tab ? '2px solid #22c55e' : '2px solid transparent', color: leftTab === tab ? '#22c55e' : 'var(--muted)', cursor: 'pointer' }}>
                {tab === 'filtros' ? 'Filtros' : '+ Envíos'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {leftTab === 'filtros' ? (
              <AirportFilterPanel
                airports={airports} originIds={originIds} setOriginIds={setOriginIds}
                destIds={destIds} setDestIds={setDestIds} threshold={threshold} setThreshold={setThreshold}
              />
            ) : (
              <div style={{ height: '100%', overflowY: 'auto' }}>
                <OpsEnviosIngress airports={airports} onEnviosChanged={() => {}} />
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
          <button onClick={() => setFilterOpen(!filterOpen)}
            style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 1000, width: 24, height: 48, background: 'rgba(13,17,23,0.85)', border: '1px solid var(--border)', borderLeft: 'none', borderRadius: '0 8px 8px 0', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>
            {filterOpen ? '‹' : '›'}
          </button>

          <MapView airports={visibleAirports} flights={visibleFlights} selectedFlight={selectedFlight}
            setSelectedFlight={setSelectedFlight} selectedFlightData={selectedFlightData}
            onAirportClick={setSelectedAirport} onMapClick={() => { setSelectedFlight(null); setSelectedVueloData(null) }} theme={theme} />

          <DrawerVuelo vuelo={selectedVueloData} onClose={() => { setSelectedFlight(null); setSelectedVueloData(null) }} onCancelFlight={null} />
          <DrawerAeropuerto airport={selectedAirport} vuelos={visibleFlights} onClose={() => setSelectedAirport(null)} />
        </div>

        {/* Right panel */}
        <div style={{ borderLeft: '1px solid var(--border, #333)', background: 'var(--panel, #1a1a1a)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <RightPanel flights={visibleFlights} airports={visibleAirports} threshold={threshold}
            selectedFlight={selectedFlight} setSelectedFlight={setSelectedFlight}
            onVueloClick={f => { setSelectedFlight(f.id); setSelectedVueloData(f) }}
            showAllAirports />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar compilación sin errores**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/screens/OpsScreen.jsx
git commit -m "feat(ops): add OpsScreen (map + flight panel + envios ingress tab)"
```

---

## Task 13: App.jsx — wiring del modo ops

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Añadir import de OpsScreen y funciones api ops**

```js
// Añadir junto a los otros imports de screens:
import OpsScreen from './screens/OpsScreen.jsx'

// Añadir junto a los otros imports de api.js:
import { getOpsState } from './services/api.js'
```

- [ ] **Step 2: Añadir estado opsState y refs de polling**

Añadir junto a los otros estados en App.jsx (cerca de donde está `liveState`):

```js
const [opsState, setOpsState] = useState(null)
const opsPollingRef = useRef(null)
const opsApplyRef = useRef(null)
const opsWindowStartRef = useRef(null)
const opsNextStateRef = useRef(null)
```

- [ ] **Step 3: Añadir funciones startOps / stopOps**

Añadir junto a `startLive` / `stopLive` en App.jsx:

```js
function stopOps() {
  clearTimeout(opsPollingRef.current)
  clearTimeout(opsApplyRef.current)
  opsPollingRef.current = null
  opsApplyRef.current = null
  opsNextStateRef.current = null
  opsWindowStartRef.current = null
  setOpsState(null)
}

function scheduleOpsTimers() {
  clearTimeout(opsPollingRef.current)
  clearTimeout(opsApplyRef.current)

  opsPollingRef.current = setTimeout(() => {
    const nextFrom = new Date(opsWindowStartRef.current.getTime() + 60 * 60 * 1000)
    getOpsState(toLocalISO(nextFrom))
      .then(state => { opsNextStateRef.current = state })
      .catch(err => console.error('Ops prefetch error:', err))
  }, 55 * 60 * 1000)

  opsApplyRef.current = setTimeout(() => {
    const nextWindowStart = new Date(opsWindowStartRef.current.getTime() + 60 * 60 * 1000)
    opsWindowStartRef.current = nextWindowStart
    if (opsNextStateRef.current) {
      setOpsState(opsNextStateRef.current)
    } else {
      getOpsState(toLocalISO(nextWindowStart)).then(setOpsState).catch(console.error)
    }
    opsNextStateRef.current = null
    scheduleOpsTimers()
  }, 60 * 60 * 1000)
}

function startOps() {
  stopOps()
  const now = new Date()
  opsWindowStartRef.current = now
  getOpsState(toLocalISO(now)).then(setOpsState).catch(err => console.error('Ops fetch error:', err))
  scheduleOpsTimers()
}
```

- [ ] **Step 4: Añadir manejo de screen='ops' y prop onOperacionesStarted**

En la función `handleNavigate` (o donde se maneja el cambio de `screen`), añadir:

```js
if (next === 'ops') {
  setScreen('ops')
  startOps()
} else {
  if (screen === 'ops') stopOps()
}
```

Donde se renderiza `ConfigScreen`, añadir el prop:

```jsx
<ConfigScreen
  onCancel={...}
  onSimulationStarted={...}
  onOperacionesStarted={() => { setScreen('ops'); startOps() }}
/>
```

- [ ] **Step 5: Añadir render de OpsScreen**

En el bloque de renderizado principal de App.jsx, añadir junto al bloque de LiveScreen:

```jsx
{screen === 'ops' && (
  <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--bg)' }}>
    <OpsScreen
      opsState={opsState}
      theme={theme}
      onBack={() => { stopOps(); setScreen('config') }}
    />
  </div>
)}
```

- [ ] **Step 6: Añadir botón Operaciones en la navbar**

En la barra de navegación superior (donde están los botones de Simulación, Envíos, Dashboard, etc.), añadir un botón que vaya a `'ops'` solo cuando no hay simulación activa, o siempre como acceso directo a ops:

Buscar el componente de navbar (probablemente en `App.jsx` o en un componente separado). Añadir:

```jsx
<button onClick={() => handleNavigate('ops')} style={{ /* mismo estilo que los otros botones de nav */ }}>
  Operaciones
</button>
```

- [ ] **Step 7: Verificar flujo completo en el browser**

```bash
npm run dev
```

1. Abrir `http://localhost:5173`
2. Clic en "Configurar" → debe aparecer selector `Simulación | Operaciones`
3. Seleccionar "Operaciones" → layout cambia a 3 columnas
4. Clic "INICIAR OPERACIONES" → debe navegar a OpsScreen con mapa y panel de tabs
5. Tab "Envíos" → debe mostrar el formulario manual y upload

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "feat(ops): wire OpsScreen into App.jsx with startOps/stopOps and navigation"
```

---

## Self-Review — cobertura del spec

| Requisito | Task que lo implementa |
|---|---|
| Schema MySQL separado | Task 1, Task 2, Task 3 |
| Dual datasource Spring Boot | Task 3 |
| Ingreso manual de envíos | Task 5, Task 6, Task 7, Task 10 |
| Upload TXT al schema ops | Task 8, Task 10 |
| SA dispara al ingresar envíos | Task 6 (planificar endpoint) + botón en OpsEnviosIngress |
| Mapa actualizado en tiempo real | Task 13 (polling getOpsState) |
| Hora en zona horaria del aeropuerto | Task 10 (OpsEnviosIngress localTimeLabel + offset) |
| Multi-usuario: estado compartido | Implícito — polling DB, sin sesión de usuario |
| Filtros por sesión (no compartidos) | Implícito — todo useState local en OpsScreen |
| Configuración desde ConfigScreen | Task 11 |
| Panel izquierdo tabs Filtros / Envíos | Task 12 |
| Reporte KPI en cualquier momento | Task 6 (GET /api/ops/reporte) — integración al frontend en OpsScreen pendiente |
| Cierre de día a medianoche | No implementado en esta versión — pendiente como tarea futura |

### Gaps conocidos (fuera de scope de este plan)

- **Cierre de día automático a medianoche:** evaluación SLA + snapshot automático. Requiere `@Scheduled` en Spring.
- **EnviosScreen en ops mode:** tabla de envíos ops + detalle de ruta. Requiere endpoint `/api/ops/envios/{id}` con plan.
- **DashboardScreen en ops mode:** wiring de KPIs ops a la pantalla de dashboard existente.
- **ResultadosScreen en ops mode:** reporte bajo demanda completo (CSV export).
- **Preview de envíos cargados en ConfigScreen:** la tabla de preview de Task 11 es un placeholder; requiere llamar `getOpsEnvios()` para poblarla.

---
