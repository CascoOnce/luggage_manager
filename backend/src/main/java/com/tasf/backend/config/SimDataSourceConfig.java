package com.tasf.backend.config;

import com.zaxxer.hikari.HikariDataSource;
import jakarta.persistence.EntityManagerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.orm.jpa.EntityManagerFactoryBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;
import java.util.Map;

@Configuration
@EnableJpaRepositories(
    basePackages = "com.tasf.backend.repository",
    entityManagerFactoryRef = "simEntityManagerFactory",
    transactionManagerRef = "simTransactionManager"
)
public class SimDataSourceConfig {

    // Schema management strategy for this persistence unit. Defaults to "validate"
    // (prod-safe: tables must pre-exist). Override with app.jpa.ddl-auto=update in a
    // fresh local/dev database so Hibernate generates the schema on first boot.
    @org.springframework.beans.factory.annotation.Value("${app.jpa.ddl-auto:validate}")
    private String ddlAuto;

    @Primary
    @Bean
    @ConfigurationProperties("spring.datasource")
    public DataSourceProperties simDataSourceProperties() {
        return new DataSourceProperties();
    }

    @Primary
    @Bean
    @ConfigurationProperties("spring.datasource.hikari")
    public DataSource simDataSource(
            @Qualifier("simDataSourceProperties") DataSourceProperties props) {
        return props.initializeDataSourceBuilder()
                .type(HikariDataSource.class)
                .build();
    }

    @Primary
    @Bean
    public LocalContainerEntityManagerFactoryBean simEntityManagerFactory(
            EntityManagerFactoryBuilder builder,
            @Qualifier("simDataSource") DataSource dataSource) {
        return builder
                .dataSource(dataSource)
                .packages("com.tasf.backend.entity")
                .persistenceUnit("sim")
                .properties(Map.of("hibernate.hbm2ddl.auto", ddlAuto))
                .build();
    }

    @Primary
    @Bean
    public PlatformTransactionManager simTransactionManager(
            @Qualifier("simEntityManagerFactory") EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }
}
