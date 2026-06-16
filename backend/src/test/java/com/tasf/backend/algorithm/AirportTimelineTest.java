package com.tasf.backend.algorithm;

import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import static org.assertj.core.api.Assertions.assertThat;

class AirportTimelineTest {

    @Test
    void peakWithNoEvents_returnsZero() {
        AirportTimeline tl = new AirportTimeline();
        assertThat(tl.globalPeak("X")).isZero();
    }

    @Test
    void peakAfterAddingBags() {
        AirportTimeline tl = new AirportTimeline();
        LocalDateTime t0 = LocalDateTime.of(2024, 1, 1, 0, 0);
        LocalDateTime t1 = LocalDateTime.of(2024, 1, 1, 8, 0);
        LocalDateTime t2 = LocalDateTime.of(2024, 1, 1, 14, 0);

        tl.addEvent("X", t0, 200);  // 200 bags arrive
        tl.addEvent("X", t1, -200); // 200 bags depart
        tl.addEvent("X", t1, 300);  // 300 bags arrive same time as departure
        tl.addEvent("X", t2, -300); // 300 bags depart

        assertThat(tl.globalPeak("X")).isEqualTo(300);
    }

    @Test
    void howManyFit_respectsHardCap() {
        AirportTimeline tl = new AirportTimeline();
        LocalDateTime t0 = LocalDateTime.of(2024, 1, 1, 0, 0);
        LocalDateTime t1 = LocalDateTime.of(2024, 1, 1, 8, 0);
        tl.addEvent("X", t0, 350); // existing 350 bags
        tl.addEvent("X", t1, -350);

        // cap=400, existing peak=350, asking for 100 → only 50 fit
        int fits = tl.howManyFit("X", t0, t1, 100, 400);
        assertThat(fits).isEqualTo(50);
    }

    @Test
    void howManyFit_allFitWhenUnderCap() {
        AirportTimeline tl = new AirportTimeline();
        LocalDateTime t0 = LocalDateTime.of(2024, 1, 1, 0, 0);
        LocalDateTime t1 = LocalDateTime.of(2024, 1, 1, 8, 0);
        tl.addEvent("X", t0, 100);
        tl.addEvent("X", t1, -100);

        int fits = tl.howManyFit("X", t0, t1, 50, 400);
        assertThat(fits).isEqualTo(50);
    }

    @Test
    void removeEvent_decreasesPeak() {
        AirportTimeline tl = new AirportTimeline();
        LocalDateTime t0 = LocalDateTime.of(2024, 1, 1, 0, 0);
        LocalDateTime t1 = LocalDateTime.of(2024, 1, 1, 8, 0);
        tl.addEvent("X", t0, 300);
        tl.addEvent("X", t1, -300);

        tl.removeEvent("X", t0, 100);
        tl.removeEvent("X", t1, -100);

        assertThat(tl.globalPeak("X")).isEqualTo(200);
    }

    @Test
    void affectedAirports_returnsAllAirportsWithEvents() {
        AirportTimeline tl = new AirportTimeline();
        tl.addEvent("X", LocalDateTime.now(), 10);
        tl.addEvent("Y", LocalDateTime.now(), 5);
        assertThat(tl.affectedAirports()).containsExactlyInAnyOrder("X", "Y");
    }
}
