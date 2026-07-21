package com.tasf.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import org.junit.jupiter.api.Test;

/** Pure static logic — no Spring context, safe while the DB VM is down. */
class FlightOccurrenceTest {

    // Reported bug: SPIM->OPKC departs 16:31 UTC (11:31 Lima). At 04:33 UTC it is 23:33 in Lima,
    // so the old minute-of-day check said "already gone" and dropped today's still-upcoming flight.
    @Test
    void upcomingFlightLaterTodayIsNotTreatedAsGone() {
        LocalDateTime now = LocalDateTime.of(2026, 7, 21, 4, 33); // UTC
        var occ = OpsService.occurrenceOf(now, LocalTime.of(16, 31), LocalTime.of(4, 31));
        assertTrue(occ.upcoming());
        assertFalse(occ.inFlight());
        // Occurrence departs 21/07 16:31 UTC → Lima-local (huso -5) date is 21/07, matching the plan leg.
        assertEquals(LocalDate.of(2026, 7, 21), occ.depUtc().plusHours(-5).toLocalDate());
    }

    @Test
    void airborneFlightReportsInFlight() {
        LocalDateTime now = LocalDateTime.of(2026, 7, 21, 20, 0); // between 16:31 dep and 04:31 arr
        var occ = OpsService.occurrenceOf(now, LocalTime.of(16, 31), LocalTime.of(4, 31));
        assertTrue(occ.inFlight());
        assertFalse(occ.upcoming());
    }

    @Test
    void afterLandingRollsToNextDayOccurrence() {
        LocalDateTime now = LocalDateTime.of(2026, 7, 22, 5, 0); // just after 04:31 arrival
        var occ = OpsService.occurrenceOf(now, LocalTime.of(16, 31), LocalTime.of(4, 31));
        assertTrue(occ.upcoming());
        assertEquals(LocalDate.of(2026, 7, 22), occ.depUtc().toLocalDate());
    }
}
