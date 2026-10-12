import groovy.json.JsonSlurper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
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
        property(
            "sonar.coverage.jacoco.xmlReportPaths",
            layout.buildDirectory.file("reports/jacoco/jacocoAggregatedReport/jacocoAggregatedReport.xml").get().asFile.absolutePath,
        )
        // Root module: the views (ui/), the web chat (web/) and the Terraform (infra/), without the vitest tests and
        // their fixtures. The Kotlin modules (server, lambda) are analysed from their Gradle source sets.
        property("sonar.sources", "ui/src,web/src,infra")
        property("sonar.exclusions", "**/*.test.ts,**/*.test.tsx,ui/src/test/**,**/.terraform/**")
        // vitest coverage (npm run coverage in ui/ and web/)
        property("sonar.javascript.lcov.reportPaths", "ui/coverage/lcov.info,web/coverage/lcov.info")
        // Access logs of the buckets and CloudFront distributions: a log bucket billed for a public demo, not needed
        property("sonar.issue.ignore.multicriteria", "logs")
        property("sonar.issue.ignore.multicriteria.logs.ruleKey", "terraform:S6258")
        property("sonar.issue.ignore.multicriteria.logs.resourceKey", "infra/**/*.tf")
    }
}

/**
 * Fetches quality gate status and open issues from SonarCloud.
 * Fails the build if the gate is not OK or any issue/hotspot remains.
 *
 * Waits for SonarCloud to finish processing the analysis (async CE task) before checking.
 *
 * Prerequisites: run `./gradlew check jacocoAggregatedReport sonar` first to push the analysis.
 * Token: set `systemProp.sonar.token=<token>` in ~/.gradle/gradle.properties
 *
 * Full quality loop:
 *   ./gradlew check jacocoAggregatedReport sonar sonarCheck
 */
tasks.register("sonarCheck") {
    group = "verification"
    description = "Verifies SonarCloud quality gate: fails if gate != OK, issues > 0, or hotspots > 0."
    mustRunAfter("sonar")
    notCompatibleWithConfigurationCache("Reads sonar/report-task.txt generated at execution time")
    doLast {
        val token = project.providers.systemProperty("sonar.token")
            .orElse(project.providers.environmentVariable("SONAR_TOKEN"))
            .orNull
            ?: error("sonar.token not set. Add systemProp.sonar.token=<token> to ~/.gradle/gradle.properties")

        val projectKey = sonarProjectKey
        val client = HttpClient.newHttpClient()
        val slurper = JsonSlurper()

        fun fetch(url: String): Any {
            val req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Authorization", "Bearer $token")
                .GET()
                .build()
            val resp = client.send(req, HttpResponse.BodyHandlers.ofString())
            check(resp.statusCode() == 200) {
                "SonarCloud API error ${resp.statusCode()}: ${resp.body()}"
            }
            return slurper.parseText(resp.body())
        }

        val reportTaskFile = layout.buildDirectory.file("sonar/report-task.txt").get().asFile
        if (reportTaskFile.exists()) {
            val props = Properties().also { it.load(reportTaskFile.inputStream()) }
            val ceTaskId = props.getProperty("ceTaskId")
            if (ceTaskId != null) {
                logger.lifecycle("⏳ Waiting for SonarCloud analysis (task $ceTaskId) to complete…")
                val maxWaitMs = 120_000L
                val pollIntervalMs = 5_000L
                val start = System.currentTimeMillis()
                while (true) {
                    @Suppress("UNCHECKED_CAST")
                    val taskData = fetch("https://sonarcloud.io/api/ce/task?id=$ceTaskId") as Map<String, Any>
                    @Suppress("UNCHECKED_CAST")
                    val taskStatus = (taskData["task"] as Map<String, Any>)["status"] as String
                    when (taskStatus) {
                        "SUCCESS" -> {
                            logger.lifecycle("✅ Analysis processing complete.")
                            break
                        }
                        "FAILED", "CANCELLED" -> error("SonarCloud analysis task $ceTaskId ended with status: $taskStatus")
                        else -> {
                            check(System.currentTimeMillis() - start < maxWaitMs) {
                                "Timed out waiting for SonarCloud analysis task $ceTaskId (status: $taskStatus)"
                            }
                            Thread.sleep(pollIntervalMs)
                        }
                    }
                }
            }
        }

        @Suppress("UNCHECKED_CAST")
        val qgData = fetch("https://sonarcloud.io/api/qualitygates/project_status?projectKey=$projectKey") as Map<String, Any>
        @Suppress("UNCHECKED_CAST")
        val gateStatus = (qgData["projectStatus"] as Map<String, Any>)["status"] as String

        @Suppress("UNCHECKED_CAST")
        val issuesData = fetch("https://sonarcloud.io/api/issues/search?projectKeys=$projectKey&resolved=false&ps=1") as Map<String, Any>
        val issueCount = (issuesData["total"] as Number).toInt()

        @Suppress("UNCHECKED_CAST")
        val hotspotsData = fetch("https://sonarcloud.io/api/hotspots/search?projectKey=$projectKey&status=TO_REVIEW&ps=1") as Map<String, Any>
        @Suppress("UNCHECKED_CAST")
        val hotspotCount = ((hotspotsData["paging"] as Map<String, Any>)["total"] as Number).toInt()

        logger.lifecycle("")
        logger.lifecycle("╔════════════════════════════════════╗")
        logger.lifecycle("║     SonarCloud Quality Gate        ║")
        logger.lifecycle("╠════════════════════════════════════╣")
        logger.lifecycle("║  Gate    : ${gateStatus.padEnd(24)}║")
        logger.lifecycle("║  Issues  : ${issueCount.toString().padEnd(24)}║")
        logger.lifecycle("║  Hotspots: ${hotspotCount.toString().padEnd(24)}║")
        logger.lifecycle("╚════════════════════════════════════╝")
        logger.lifecycle("")

        // NONE = gate not yet calibrated (no baseline period); ERROR = gate conditions failed.
        // Accepting NONE is safe because issues and hotspots are checked independently above.
        val failures = buildList {
            if (gateStatus != "OK" && gateStatus != "NONE") add("quality gate status is '$gateStatus' (expected OK or NONE)")
            if (issueCount > 0) add("$issueCount unresolved issue(s)")
            if (hotspotCount > 0) add("$hotspotCount unreviewed security hotspot(s)")
        }

        check(failures.isEmpty()) {
            "❌ SonarCloud check FAILED:\n${failures.joinToString("\n") { "  • $it" }}"
        }

        logger.lifecycle("✅ SonarCloud quality gate passed — 0 issues, 0 hotspots.")
    }
}
