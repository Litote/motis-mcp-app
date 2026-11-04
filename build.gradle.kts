import java.util.Properties

plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.shadow) apply false
    alias(libs.plugins.graalvm.native) apply false
    alias(libs.plugins.sonarqube)
    jacoco
}

jacoco {
    toolVersion = libs.versions.jacoco.get()
}

allprojects {
    group = providers.gradleProperty("GROUP").orNull ?: error("Missing gradle.properties 'GROUP'")
    version = providers.gradleProperty("VERSION_NAME").orNull ?: error("Missing gradle.properties 'VERSION_NAME'")
}

val sonarProjectKey = "Litote_motis-mcp-app"
val coveredProjects = listOf("server", "lambda")

// Coverage of the Kotlin modules (tests of server and lambda), used by SonarCloud
val jacocoAggregatedReport by tasks.registering(JacocoReport::class) {
    group = "verification"
    description = "Generates the JaCoCo coverage report of the server and lambda tests, used by SonarCloud."
    dependsOn(coveredProjects.map { ":$it:test" })
    executionData.setFrom(
        files(coveredProjects.map { "$it/build/jacoco/test.exec" }).filter { it.exists() },
    )
    sourceDirectories.setFrom(coveredProjects.map { "$it/src/main/kotlin" })
    classDirectories.setFrom(
        coveredProjects.map { module ->
            fileTree("$module/build/classes/kotlin/main") { exclude("**/*\$\$serializer.class") }
        },
    )
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}

sonar {
    properties {
        property("sonar.projectKey", sonarProjectKey)
        property("sonar.organization", "litote")
        property("sonar.host.url", "https://sonarcloud.io")
        property("sonar.qualitygate.wait", true)
        property(
            "sonar.coverage.jacoco.xmlReportPaths",
            layout.buildDirectory.file("reports/jacoco/jacocoAggregatedReport/jacocoAggregatedReport.xml").get().asFile.absolutePath,
        )
        // Root module: the views (ui/), the web chat (web/) and the Terraform (infra/), without the vitest tests and
        // their fixtures. The Kotlin modules (server, lambda) are analysed from their Gradle source sets.
        property("sonar.sources", "ui/src,web/src,infra")
        // web/src/DevHost.tsx, dev.tsx: dev host of the views (dev.html), served by the Vite dev server only, not deployed
        property(
            "sonar.exclusions",
            "**/*.test.ts,**/*.test.tsx,ui/src/test/**,**/.terraform/**,web/src/DevHost.tsx,web/src/dev.tsx",
        )
        // Translations: the dictionaries of each language have the same keys
        property("sonar.cpd.exclusions", "**/i18n.ts")
        // vitest coverage (npm run coverage in ui/ and web/)
        property("sonar.javascript.lcov.reportPaths", "ui/coverage/lcov.info,web/coverage/lcov.info")
        // Access logs of the buckets and CloudFront distributions: a log bucket billed for a public demo, not needed
        property("sonar.issue.ignore.multicriteria", "logs")
        property("sonar.issue.ignore.multicriteria.logs.ruleKey", "terraform:S6258")
        property("sonar.issue.ignore.multicriteria.logs.resourceKey", "infra/**/*.tf")
    }
}
