package com.tasf.backend.ops;

import com.tasf.backend.service.OpsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class OpsScheduler {

    private static final Logger log = LoggerFactory.getLogger(OpsScheduler.class);

    private final OpsService opsService;

    public OpsScheduler(OpsService opsService) {
        this.opsService = opsService;
    }

    /**
     * Two-phase departure/arrival tick for ops mode.
     * Phase 1 (salidas): PENDIENTE → EN_VUELO when horaSalidaEst <= now.
     * Phase 2 (llegadas): EN_VUELO → PENDIENTE (intermediate) or ENTREGADO (final).
     * fixedDelay ensures phases run sequentially with no overlap between ticks.
     */
    @Scheduled(fixedDelay = 30_000)
    public void tick() {
        log.debug("OpsScheduler tick");
        opsService.procesarSalidas();
        opsService.procesarLlegadas();
    }
}
