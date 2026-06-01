# Rúbrica de Evaluación — Tasf.B2B (Transporte Aéreo de Maletas)

**Semestre 2026-1 | Pontificia Universidad Católica del Perú**

> Adaptada a partir de la rúbrica de proyectos similares, aplicada al contexto de gestión de traslado de maletas extraviadas entre aeropuertos de América, Asia y Europa.

---

## SECCIÓN A — Criterios Generales (Pre-escenarios)

| Criterio | Descripción                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| 1        | Versión del software                                                                                                |
| 2        | Fecha de subida                                                                                                     |
| 3        | Nombre del algoritmo(s) principales (planificador de rutas de maletas)                                              |
| 4        | Problemas o pendientes reportados por los estudiantes                                                               |
| 5        | ¿Está desplegado en el servidor del laboratorio de Ingeniería Informática?                                          |
| 6        | ¿Cuánto es el tiempo de ejecución del algoritmo planificador: Ta?                                                   |
| 7        | ¿Cuánto es el tiempo del salto del algoritmo: Sa?                                                                   |
| 8        | ¿Cuánto es el salto (tiempo) del eje de monitoreo de operaciones: Sc?                                               |
| 9        | ¿Cuánto demora en mostrar la primera vez la simulación semanal desde presionar inicio? (aproximadamente)            |
| 10       | Explique cómo se ejecuta el planificador: ¿Continuo / Por Bloques / Por Demanda?                                    |
| 11       | ¿Cómo se registran los envíos de maletas (aerolínea origen → aeropuerto destino)? [GUI / Script / Hard-code / Otro] |
| 12       | ¿Cómo se carga el mapa mundial con los aeropuertos (América, Asia, Europa)? [GUI / Script / Hard-code / Otro]       |
| 13       | ¿Cómo se registra la flota de vuelos disponibles? [GUI / Script / Hard-code / Otro]                                 |
| 14       | ¿Cómo se registran las cancelaciones de vuelos? [GUI / Script / Hard-code / Otro]                                   |
| 15       | ¿Cómo se registran los retrasos o incidencias de vuelos? [GUI / Script / Hard-code / Otro]                          |
| 16       | ¿Cómo se registran los aeropuertos/almacenes? [GUI / Script / Hard-code / Otro]                                     |
| 17       | ¿Cómo se cargan los planes de vuelo (rutas entre aeropuertos)? [GUI / Script / Hard-code / Otro]                    |
| 18       | ¿Cómo se cargan los tramos/segmentos aéreos (conexiones entre aeropuertos)? [GUI / Script / Hard-code / Otro]       |
| 19       | ¿Cómo se gestiona la base de datos? [RDBMS / NoSQL / CSV-TXT / Otro]                                                |
| 20       | ¿Cómo se carga la data histórica/futura a la BD antes de iniciar la simulación?                                     |
| 21       | ¿Se está usando el juego de datos completo proporcionado por el curso?                                              |
| 22       | ¿Está independiente la carga de datos de los 3 escenarios (tiempo real, simulación semanal, colapso)?               |

---

## SECCIÓN B — Visualizador (Mapa Mundial)

> El mapa debe mostrar los aeropuertos de América, Asia y Europa. Se usará mapa de nivel planeta.

| Criterio                                   | Descripción                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1                                          | ¿Se solicita fecha y hora de inicio para la simulación semanal?                                                             |
| **MAPA**                                   |                                                                                                                             |
| 2                                          | ¿Se presenta el mapa mundial completo como pantalla principal?                                                              |
| 3                                          | ¿Se aprovecha al máximo la pantalla para mostrar el mapa?                                                                   |
| 4                                          | ¿Se tiene deshabilitado/oculto uno o más paneles al inicio para liberar el mapa?                                            |
| 5                                          | ¿Se presenta cada aeropuerto principal (con almacén Tasf.B2B) en su posición correcta en el mapa?                           |
| 6                                          | ¿Se presenta cada aeropuerto principal con un ícono idóneo (avión/terminal) que contraste con el mapa?                      |
| 7                                          | ¿Se observa el stock actual de maletas en cada aeropuerto principal en números o porcentaje en el mapa? ¿al pasar el mouse? |
| 8                                          | ¿Se observa el stock actual de maletas en cada aeropuerto principal en colores (semáforo: verde/ámbar/rojo)?                |
| 9                                          | ¿Se presenta en cada aeropuerto principal la lista de maletas/envíos planificados que salen? ¿al pasar el mouse?            |
| 10                                         | ¿Se presenta en cada aeropuerto principal la lista de vuelos que parten (con maletas)? ¿al pasar el mouse?                  |
| 11                                         | ¿Se presenta en cada aeropuerto principal la lista de vuelos que arriban (con maletas)? ¿al pasar el mouse?                 |
| 12                                         | ¿Se presenta cada aeropuerto de conexión/escala en su posición correcta en el mapa y con etiqueta?                          |
| 13                                         | ¿Se presenta cada aeropuerto de conexión con un ícono idóneo que contraste con el mapa?                                     |
| 14                                         | ¿Se observa el stock actual de maletas en cada aeropuerto de conexión en números o porcentaje? ¿al pasar el mouse?          |
| 15                                         | ¿Se observa el stock actual de maletas en cada aeropuerto de conexión en colores (semáforo)?                                |
| 16                                         | ¿Se presenta en cada aeropuerto de conexión la lista de maletas/envíos que arriban? ¿al pasar el mouse?                     |
| 17                                         | ¿Se presenta en cada aeropuerto de conexión la lista de vuelos que parten? ¿al pasar el mouse?                              |
| 18                                         | ¿Se presenta en cada aeropuerto de conexión la lista de vuelos en espera/tránsito? ¿al pasar el mouse?                      |
| 19                                         | ¿Se presentan las cancelaciones de vuelos en el mapa?                                                                       |
| 20                                         | ¿Se emplea un color idóneo para representar un vuelo cancelado o ruta bloqueada?                                            |
| 21                                         | ¿Se presenta información relevante de la cancelación (vuelo, ruta, hora)? ¿al pasar el mouse?                               |
| 22                                         | ¿Se emplea un nivel de grosor/ideograma idóneo para presentar la cancelación o ruta afectada?                               |
| 23                                         | ¿Se presenta cada vuelo en tránsito (con maletas) en su posición estimada en el mapa?                                       |
| 24                                         | ¿Se presenta cada vuelo en tránsito con un ícono idóneo (avión) que contraste con el mapa?                                  |
| 25                                         | ¿Se presenta el ícono del vuelo alineado con el tramo aéreo que recorre (dirección)?                                        |
| 26                                         | ¿Se presenta el ícono del vuelo coherente con el desplazamiento (dirección y velocidad estimada)?                           |
| 27                                         | ¿Se desplaza el vuelo con fluidez, sin saltos, sin descontrol ni anomalías visuales?                                        |
| 28                                         | ¿Se observa la carga actual de maletas de cada vuelo en tránsito en números o porcentaje? ¿al pasar el mouse?               |
| 29                                         | ¿Se observa la carga actual de maletas de cada vuelo en tránsito en colores (semáforo)?                                     |
| 30                                         | ¿Se presenta la línea de la ruta aérea planificada que recorre el vuelo?                                                    |
| 31                                         | ¿Se presenta la línea de la ruta aérea con un grosor/ideograma idóneo?                                                      |
| 32                                         | ¿Se presentan las rutas aéreas con colores de sentido semántico (leyenda visible)?                                          |
| 33                                         | ¿Se tiene un mecanismo para mostrar/ocultar la línea de ruta de un vuelo?                                                   |
| 34                                         | ¿Se presenta el tramo actual del vuelo borrando/diferenciando lo ya recorrido?                                              |
| 35                                         | ¿Se presenta la fecha, hora, minuto y segundo del momento que está siendo simulado?                                         |
| 36                                         | ¿Se presenta la fecha, hora, minuto y segundo del momento actual (tiempo real)?                                             |
| 37                                         | ¿Se presenta el tiempo transcurrido (dd, hh, mm, ss) dentro de lo simulado?                                                 |
| 38                                         | ¿Se presenta el tiempo transcurrido (dd, hh, mm, ss) en tiempo real?                                                        |
| 39                                         | ¿Se presenta un bloque con estos tiempos con fuente pertinente y en lugar adecuado del mapa?                                |
| 40                                         | ¿Se presentan datos de nivel de ocupación/disponibilidad de la flota de vuelos total en números (porcentaje)?               |
| 41                                         | ¿Se presentan datos de nivel de ocupación/disponibilidad de la flota de vuelos total en colores (semáforo)?                 |
| 42                                         | ¿Se presentan datos de nivel de ocupación/disponibilidad de vuelos en tránsito?                                             |
| 43                                         | ¿Se presentan datos de nivel de llenado/disponibilidad de almacenes en aeropuerto en números (porcentaje)?                  |
| 44                                         | ¿Se presentan datos de nivel de llenado/disponibilidad de almacenes en aeropuerto en colores (semáforo)?                    |
| 45                                         | ¿Se cancela un vuelo (Tipo 1: cancelación programada) y se refleja en el mapa?                                              |
| 46                                         | ¿Se cancela un vuelo (Tipo 2: cancelación en tránsito / desvío de emergencia) y se refleja en el mapa?                      |
| 47                                         | ¿Se cancela un vuelo (Tipo 3: cancelación masiva / colapso de operaciones) y se refleja en el mapa?                         |
| **MAPA ENLAZADO AL PANEL (BIDIRECCIONAL)** |                                                                                                                             |
| 48                                         | ¿Se selecciona un aeropuerto principal desde el mapa y se abre el panel de detalle?                                         |
| 49                                         | ¿Se selecciona un aeropuerto de conexión desde el mapa y se abre el panel de detalle?                                       |
| 50                                         | ¿Se selecciona un vuelo en tránsito desde el mapa y se abre el panel de detalle?                                            |
| 51                                         | ¿Se selecciona una cancelación/ruta bloqueada desde el mapa y se abre el panel de detalle?                                  |
| 52                                         | ¿Se selecciona un aeropuerto principal desde el panel y se centra/resalta en el mapa?                                       |
| 53                                         | ¿Se selecciona un aeropuerto de conexión desde el panel y se centra/resalta en el mapa?                                     |
| 54                                         | ¿Se selecciona un vuelo desde el panel y se centra/resalta en el mapa?                                                      |
| 55                                         | ¿Se selecciona una cancelación desde el panel y se centra/resalta en el mapa?                                               |
| 56                                         | ¿Se selecciona un vuelo con cancelación Tipo 1 desde el panel y se abre el mapa en ese punto?                               |
| 57                                         | ¿Se selecciona un vuelo con cancelación Tipo 2 desde el panel y se abre el mapa en ese punto?                               |
| 58                                         | ¿Se selecciona un vuelo con cancelación Tipo 3 desde el panel y se abre el mapa en ese punto?                               |
| **PANEL (puede ser uno o más paneles)**    |                                                                                                                             |
| 59                                         | ¿Se presenta el stock actual de maletas de cada aeropuerto/almacén en números o porcentaje?                                 |
| 60                                         | ¿Se presenta el stock actual de maletas de cada aeropuerto/almacén en colores (semáforo)?                                   |
| 61                                         | ¿Se puede buscar un aeropuerto/almacén principal?                                                                           |
| 62                                         | ¿Se presenta para cada aeropuerto de conexión su ubicación en el mapa?                                                      |
| 63                                         | ¿Se presenta la lista de cancelaciones de vuelos según hora y aeropuerto de origen?                                         |
| 64                                         | ¿Se presenta la lista de vuelos cancelados según hora y aeropuerto de origen?                                               |
| 65                                         | ¿Se presenta una lista de maletas/envíos planificados?                                                                      |
| 66                                         | ¿Se presenta para cada maleta/envío planificado los vuelos que lo atienden (plan de viaje)?                                 |
| 67                                         | ¿Se puede ver la ruta completa que sigue una maleta? Si tiene escalas, ¿se ven todos los tramos?                            |
| 68                                         | ¿Se puede buscar un envío/maleta planificado?                                                                               |
| 69                                         | ¿Se puede buscar un envío/maleta ya entregado?                                                                              |
| 70                                         | ¿Se presenta una lista de vuelos de la flota Tasf.B2B?                                                                      |
| 71                                         | ¿Se presenta la lista de vuelos con su carga actual de maletas?                                                             |
| 72                                         | ¿Se puede ver para un vuelo específico sus rutas/tramos planificados?                                                       |
| 73                                         | ¿Se puede ver para un vuelo específico las maletas asignadas?                                                               |
| 74                                         | ¿Se puede buscar un vuelo específico?                                                                                       |
| 75                                         | ¿Se aprecia el tiempo de permanencia/manipulación de maletas en el aeropuerto de escala (según plazo comprometido)?         |
| 76                                         | ¿Se aprecia si un vuelo está operativo, cancelado, retrasado u otro estado?                                                 |
| 77                                         | ¿Se ve el periodo en que un vuelo está cancelado, en mantenimiento o no disponible?                                         |
| 78                                         | ¿Se ve la lista de vuelos con cancelación Tipo 1?                                                                           |
| 79                                         | ¿Se ve la lista de vuelos con cancelación Tipo 2?                                                                           |
| 80                                         | ¿Se ve la lista de vuelos con cancelación Tipo 3?                                                                           |
| **OTROS**                                  |                                                                                                                             |
| 81                                         | ¿Cómo se manejan las cancelaciones de vuelos en el planificador? Por Hora / Por Horario / Salto-datos                       |
| 82                                         | ¿Se presenta el reporte final con la última planificación completa en los 3 escenarios?                                     |
| **PERCEPCIÓN FINAL**                       |                                                                                                                             |
| 83                                         | Percepción global del software — FORTALEZA                                                                                  |
| 84                                         | Percepción global del software — OPORTUNIDAD DE MEJORA                                                                      |
| 85                                         | Video de simulación semanal (30–90 min de ejecución)                                                                        |
| 86                                         | XpoSTEM                                                                                                                     |

---

## SECCIÓN C — Criterios Específicos por Escenario

### Escenario 1 — Simulación Semanal (5 días / 3 días)

| Criterio | Descripción                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------ |
| E1-1     | ¿Se puede parametrizar el período de simulación (5 días / 3 días)?                               |
| E1-2     | ¿La simulación semanal se ejecuta entre 30 y 90 minutos?                                         |
| E1-3     | ¿Se respetan los plazos: 1 día mismo continente / 2 días distinto continente?                    |
| E1-4     | ¿Se replantifican rutas ante cancelaciones de vuelo durante la simulación?                       |
| E1-5     | ¿Se puede ver la evolución del stock de maletas en almacenes a lo largo del período?             |
| E1-6     | ¿Se puede ver el historial de vuelos (completados, cancelados, retrasados) al final del período? |
| E1-7     | ¿Se presenta una gráfica/indicador del desempeño de cumplimiento de plazos al final?             |

### Escenario 2 — Operaciones en Tiempo Real (Día a Día)

| Criterio | Descripción                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| E2-1     | ¿Se puede registrar nuevos envíos de maletas en tiempo real?                                                |
| E2-2     | ¿El planificador genera/ajusta rutas en tiempo real ante nuevos envíos o cancelaciones?                     |
| E2-3     | ¿Se actualiza el monitoreo de maletas (ciudad actual según plan de viaje) de forma manual por aeropuerto?   |
| E2-4     | ¿Se genera el plan de viaje por maleta o grupo de maletas al momento del envío?                             |
| E2-5     | ¿Se genera el reporte de monitoreo de viaje por demanda (a solicitud del cliente)?                          |
| E2-6     | ¿Se verifican restricciones de capacidad de almacén (500–800 maletas según ciudad)?                         |
| E2-7     | ¿Se verifican restricciones de capacidad de vuelo (150–250 mismo continente / 150–400 distinto continente)? |

### Escenario 3 — Simulación hasta el Colapso

| Criterio | Descripción                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------- |
| E3-1     | ¿Se puede parametrizar el escenario de colapso (aumento progresivo de demanda/cancelaciones)?             |
| E3-2     | ¿El sistema detecta y notifica visualmente (semáforo) cuando un almacén supera su capacidad?              |
| E3-3     | ¿El sistema detecta y notifica visualmente cuándo la operación colapsa (imposibilidad de cumplir plazos)? |
| E3-4     | ¿Se presenta un reporte/gráfica del punto de colapso (momento, métricas, causa principal)?                |
| E3-5     | ¿El planificador intenta replanificar antes de declarar el colapso?                                       |
| E3-6     | ¿Se puede comparar el resultado de los 2 algoritmos metaheurísticos en el escenario de colapso?           |

---

## SECCIÓN D — Requisitos No Funcionales (según enunciado)

| Criterio | Descripción                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------- |
| RNF-1    | ¿Se presentan dos soluciones algorítmicas (metaheurísticos) en Java para el planificador?           |
| RNF-2    | ¿Los dos algoritmos han sido evaluados por experimentación numérica?                                |
| RNF-3    | ¿Se usan colores semáforo (verde, ámbar, rojo) en los indicadores y son parametrizables sus rangos? |
| RNF-4    | ¿La solución funciona en el equipamiento del laboratorio de Ingeniería Informática?                 |
| RNF-5    | ¿Se evidencia el proceso seguido según NTP-ISO/IEC 29110-5-1-2 (VSE)?                               |
| RNF-6    | ¿Se tienen grabados los videos de presentación final del equipo?                                    |
| RNF-7    | ¿Se entregaron videos de avances y finales de los 3 escenarios según indicación del equipo docente? |

---

## Tabla de Correspondencia de Conceptos (Referencia)

| Proyecto Original (Camiones)  | Tasf.B2B (Aviones)                                                       |
| ----------------------------- | ------------------------------------------------------------------------ |
| Unidad de transporte (camión) | Vuelo / aeronave de Tasf.B2B                                             |
| Pedido / envío / producto     | Maleta o grupo de maletas                                                |
| Bloqueo de ruta               | Cancelación de vuelo                                                     |
| Almacén / oficina principal   | Aeropuerto con almacén Tasf.B2B                                          |
| Oficina intermedia / de paso  | Aeropuerto de conexión / escala                                          |
| Flota de camiones             | Flota de vuelos Tasf.B2B                                                 |
| Tramo / segmento de carretera | Ruta aérea entre aeropuertos                                             |
| Avería Tipo 1/2/3             | Cancelación Tipo 1 (programada) / Tipo 2 (en tránsito) / Tipo 3 (masiva) |
| Mapa de ciudad/país           | Mapa mundial (América, Asia, Europa)                                     |
| Plan de entrega               | Plan de viaje de la maleta                                               |
| Reporte de entrega            | Reporte de monitoreo de viaje (por demanda)                              |
| 15 min en cliente a entrega   | Tiempo de manipulación en aeropuerto de destino                          |

---

*Documento generado para evaluación del proyecto Tasf.B2B — Semestre 2026-1*
