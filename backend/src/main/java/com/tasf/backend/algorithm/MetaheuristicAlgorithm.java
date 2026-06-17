package com.tasf.backend.algorithm;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.domain.Envio;
import com.tasf.backend.domain.MetricaAlgoritmo;
import com.tasf.backend.domain.ParametrosSimulacion;
import com.tasf.backend.domain.PlanDeViaje;
import com.tasf.backend.domain.Vuelo;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public interface MetaheuristicAlgorithm {

    /**
     * Planifica un lote de envíos usando estado compartido de capacidad.
     * timeline y flightLoads se mutan in-place — las reservas de lotes anteriores
     * ya están ahí y las de este lote se agregan al terminar.
     */
    List<PlanDeViaje> planificarConEstado(
        List<Envio> envios,
        List<Vuelo> vuelos,
        List<Aeropuerto> aeropuertos,
        ParametrosSimulacion params,
        AirportTimeline timeline,
        Map<String, Integer> flightLoads
    );

    /** Convenience wrapper para uso sin estado previo (tests, replanning simple). */
    default List<PlanDeViaje> planificar(
        List<Envio> envios,
        List<Vuelo> vuelos,
        List<Aeropuerto> aeropuertos,
        ParametrosSimulacion params
    ) {
        return planificarConEstado(envios, vuelos, aeropuertos, params, new AirportTimeline(), new HashMap<>());
    }

    String getNombre();

    MetricaAlgoritmo getUltimaMetrica();
}
