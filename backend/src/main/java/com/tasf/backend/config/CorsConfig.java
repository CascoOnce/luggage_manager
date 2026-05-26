package com.tasf.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        String extraOrigins = System.getenv("CORS_ALLOWED_ORIGINS");
        String[] origins = extraOrigins != null && !extraOrigins.isBlank()
            ? extraOrigins.split(",")
            : new String[]{};

        String[] base = {"http://localhost:*", "http://127.0.0.1:*"};
        String[] all = java.util.stream.Stream
            .concat(java.util.Arrays.stream(base), java.util.Arrays.stream(origins))
            .toArray(String[]::new);

        registry.addMapping("/api/**")
            .allowedOriginPatterns(all)
            .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
            .allowedHeaders("*")
            .allowCredentials(false)
            .maxAge(3600);
    }
}
