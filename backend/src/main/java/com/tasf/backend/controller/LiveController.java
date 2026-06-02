package com.tasf.backend.controller;

import com.tasf.backend.dto.LiveStateDTO;
import com.tasf.backend.service.LiveService;
import java.time.LocalDateTime;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/live")
public class LiveController {

    private final LiveService liveService;

    public LiveController(LiveService liveService) {
        this.liveService = liveService;
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
            } catch (java.time.format.DateTimeParseException e) {
                return ResponseEntity.badRequest().build();
            }
        }
        return ResponseEntity.ok(liveService.getLiveState(fromDateTime));
    }
}
