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

    @GetMapping("/envios")
    public ResponseEntity<List<EnvioEntity>> getEnvios() {
        return ResponseEntity.ok(opsService.getEnvios());
    }

    @GetMapping("/reporte")
    public ResponseEntity<OpsReporteDTO> getReporte() {
        return ResponseEntity.ok(opsService.getReporte());
    }

    @PostMapping("/envios/batch")
    public ResponseEntity<Map<String, Object>> batchSave(
            @RequestBody List<OpsEnvioRequestDTO> dtos) {
        try {
            List<EnvioEntity> saved = opsService.batchSave(dtos);
            return ResponseEntity.ok(Map.of(
                    "status", "SUCCESS",
                    "count", saved.size()));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "ERROR",
                    "message", e.getMessage()));
        }
    }

    @DeleteMapping("/envios/{id}")
    public ResponseEntity<Map<String, Object>> deleteEnvio(@PathVariable Long id) {
        try {
            opsService.deleteEnvio(id);
            return ResponseEntity.ok(Map.of("status", "SUCCESS", "id", id));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "ERROR",
                    "message", e.getMessage()));
        }
    }
}
