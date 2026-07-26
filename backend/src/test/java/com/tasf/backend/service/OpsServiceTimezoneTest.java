package com.tasf.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.tasf.backend.domain.Aeropuerto;
import com.tasf.backend.dto.OpsEnvioRequestDTO;
import com.tasf.backend.entity.EnvioEntity;
import com.tasf.backend.ops.repository.OpsEnvioRepository;
import com.tasf.backend.ops.repository.OpsEscalaRepository;
import com.tasf.backend.ops.repository.OpsItinerarioRepository;

import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class OpsServiceTimezoneTest {

    private OpsReferenceData opsReferenceData;
    private OpsEnvioRepository opsEnvioRepository;
    private OpsService opsService;

    @BeforeEach
    void setUp() {
        opsReferenceData = mock(OpsReferenceData.class);
        opsEnvioRepository = mock(OpsEnvioRepository.class);
        DataLoaderService dataLoaderService = mock(DataLoaderService.class);
        PlanningService planningService = mock(PlanningService.class);
        OpsItinerarioRepository itinerarioRepository = mock(OpsItinerarioRepository.class);
        OpsEscalaRepository escalaRepository = mock(OpsEscalaRepository.class);

        Aeropuerto ekch = Aeropuerto.builder()
                .codigoIATA("EKCH")
                .nombre("Copenhagen")
                .continente("Europa")
                .huso(2)
                .build();

        when(opsReferenceData.getAeropuertos()).thenReturn(List.of(ekch));
        when(opsEnvioRepository.save(any(EnvioEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        opsService = new OpsService(
                dataLoaderService,
                opsReferenceData,
                planningService,
                opsEnvioRepository,
                itinerarioRepository,
                escalaRepository
        );
    }

    @Test
    void batchSaveConvertsNaiveLocalTimeStringToUtcUsingOriginAirportHuso() {
        OpsEnvioRequestDTO dto = OpsEnvioRequestDTO.builder()
                .iataOrigen("EKCH")
                .iataDestino("EBCI")
                .cantidadMaletas(180)
                .codigoAerolinea("0007729")
                .fechaHoraIngreso("2026-07-26T22:15") // Naive local time in EKCH (Huso +2)
                .build();

        List<EnvioEntity> savedList = opsService.batchSave(List.of(dto));

        assertEquals(1, savedList.size());
        // 22:15 local in EKCH (+2) minus 2h = 20:15 UTC
        assertEquals(LocalDateTime.of(2026, 7, 26, 20, 15), savedList.get(0).getFechaHoraIngreso());
    }

    @Test
    void addEnvioConvertsNaiveLocalTimeStringToUtcUsingOriginAirportHuso() {
        OpsEnvioRequestDTO dto = OpsEnvioRequestDTO.builder()
                .iataOrigen("EKCH")
                .iataDestino("EBCI")
                .cantidadMaletas(180)
                .codigoAerolinea("0007729")
                .fechaHoraIngreso("2026-07-26T22:15") // Naive local time in EKCH (Huso +2)
                .build();

        EnvioEntity saved = opsService.addEnvio(dto);

        // 22:15 local in EKCH (+2) minus 2h = 20:15 UTC
        assertEquals(LocalDateTime.of(2026, 7, 26, 20, 15), saved.getFechaHoraIngreso());
    }

    @Test
    void addEnvioConvertsOffsetIsoStringToUtc() {
        OpsEnvioRequestDTO dto = OpsEnvioRequestDTO.builder()
                .iataOrigen("EKCH")
                .iataDestino("EBCI")
                .cantidadMaletas(180)
                .codigoAerolinea("0007729")
                .fechaHoraIngreso("2026-07-26T15:15:00-05:00") // -05:00 offset
                .build();

        EnvioEntity saved = opsService.addEnvio(dto);

        // 15:15 -05:00 converted to UTC = 20:15 UTC
        assertEquals(LocalDateTime.of(2026, 7, 26, 20, 15), saved.getFechaHoraIngreso());
    }
}
