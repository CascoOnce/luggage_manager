package com.tasf.backend.dto;

import com.tasf.backend.domain.PlanDeViaje;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EnvioDTO {
    private String idEnvio;
    private String codigoAerolinea;
    private String aeropuertoOrigen;
    private String aeropuertoDestino;
    private int cantidadMaletas;
    private String estado;
    private int sla;
    private String fechaHoraIngreso;
    private String fechaSalidaPrimerVuelo;
    private String fechaLlegadaUltimoVuelo;
    private String planResumen;
    private String tiempoRestante;
    private String fechaEntrega;
    private String fechaLimiteSla;
    /** Dónde está físicamente el envío ahora: aeropuerto de origen si PENDIENTE (aún no
     *  planificado), aeropuerto de destino si ENTREGADO, o el aeropuerto/vuelo actual en el resto
     *  de los casos — derivado de las maletas del envío. */
    private String ubicacionActual;
    private PlanDeViaje planDetalle;
    /** Desglose de partes cuando el envío está partido (split). Siempre tiene ≥1 elemento cuando
     *  hay plan; el frontend muestra el desglose solo si hay más de una parte. */
    private List<ParteEnvioDTO> partes;
    private List<EscalaResumenDTO> escalasResumen;
    private List<String> vuelosAsignados;
    /** Camino completo de la ruta: [origen, destino de cada escala…]. Permite al panel filtrar
     *  por aeropuerto "en el tramo" (cualquier escala) además de "en la ruta" (origen/destino). */
    private List<String> aeropuertosRuta;
}
