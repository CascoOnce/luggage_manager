package com.tasf.backend.config;

import com.zaxxer.hikari.HikariDataSource;
import jakarta.persistence.EntityManagerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.orm.jpa.EntityManagerFactoryBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;
import java.util.Map;

@Configuration
@EnableJpaRepositories(
    basePackages = "com.tasf.backend.ops.repository",
    entityManagerFactoryRef = "opsEntityManagerFactory",
    transactionManagerRef = "opsTransactionManager"
)
public class OpsDataSourceConfig {

    @Bean
    @ConfigurationProperties("ops.datasource")
    public DataSourceProperties opsDataSourceProperties() {
        return new DataSourceProperties();
    }

    @Bean
    @ConfigurationProperties("ops.datasource.hikari")
    public DataSource opsDataSource(
            @Qualifier("opsDataSourceProperties") DataSourceProperties props) {
        return props.initializeDataSourceBuilder()
                .type(HikariDataSource.class)
                .build();
    }

    @Bean
    public LocalContainerEntityManagerFactoryBean opsEntityManagerFactory(
            EntityManagerFactoryBuilder builder,
            @Qualifier("opsDataSource") DataSource dataSource) {
        return builder
                .dataSource(dataSource)
                .packages("com.tasf.backend.entity")
                .persistenceUnit("ops")
                .properties(Map.of("hibernate.hbm2ddl.auto", "validate"))
                .build();
    }

    @Bean
    public PlatformTransactionManager opsTransactionManager(
            @Qualifier("opsEntityManagerFactory") EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }
}
