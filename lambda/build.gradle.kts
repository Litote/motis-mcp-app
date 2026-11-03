plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    jacoco
    alias(libs.plugins.graalvm.native)
}

dependencies {
    implementation(project(":server"))
    implementation(libs.mcp.server)
    implementation(libs.motis.client)
    implementation(libs.ktor.server.core)
    implementation(libs.serialization.json)
    implementation(libs.kotlin.logging)
    implementation(libs.lambda.runtime)
    // logback (reflection, XML configuration) replaced by slf4j-simple, logging to stderr (CloudWatch)
    runtimeOnly(libs.slf4j.simple)

    testImplementation(kotlin("test"))
}

configurations.all {
    // Lambda: no socket server, CORS handled by the function URL
    exclude(group = "io.ktor", module = "ktor-server-cio")
    exclude(group = "io.ktor", module = "ktor-server-cio-jvm")
    exclude(group = "io.ktor", module = "ktor-server-cors")
    exclude(group = "io.ktor", module = "ktor-server-cors-jvm")
    exclude(group = "ch.qos.logback")
}

kotlin {
    jvmToolchain(25)
}

graalvmNative {
    // The toolchain of the build (GraalVM image of `make build`): no toolchain detection
    toolchainDetection.set(false)
    binaries {
        named("main") {
            // name required by the provided.al2023 runtime
            imageName.set("bootstrap")
            mainClass.set("org.litote.motis.mcp.lambda.MainKt")
            buildArgs.addAll(
                "--initialize-at-build-time=io.github.oshai.kotlinlogging",
                "--enable-url-protocols=https,http",
                "--enable-native-access=ALL-UNNAMED",
                "--no-fallback",
                "-H:+ReportExceptionStackTraces",
            )
        }
    }
    metadataRepository {
        enabled.set(true)
    }
    agent {
        defaultMode.set("standard")
        metadataCopy {
            inputTaskNames.add("tracing")
            outputDirectories.add("src/main/resources/META-INF/native-image/org.litote/motis-mcp-lambda")
            mergeWithExisting.set(true)
        }
    }
}

// Records the reflection/resources metadata of the native image: `./gradlew :lambda:tracing -Pagent` then
// `./gradlew :lambda:metadataCopy` (in the GraalVM image, see infra/Makefile `trace`)
val tracing by tasks.registering(JavaExec::class) {
    group = "graalvm"
    description = "Replays MCP requests through the Lambda handler (with -Pagent: under the native-image agent)."
    mainClass.set("org.litote.motis.mcp.lambda.TracingRunnerKt")
    classpath = sourceSets["main"].runtimeClasspath
    environment("MOTIS_APP_CONTACT", providers.environmentVariable("MOTIS_APP_CONTACT").getOrElse("https://github.com/Litote/motis-mcp-app"))
}

val packageNative by tasks.registering(Zip::class) {
    group = "build"
    description = "Packages the native executable as a provided.al2023 Lambda zip."
    dependsOn("nativeCompile")
    archiveFileName.set("lambda.zip")
    destinationDirectory.set(layout.buildDirectory.dir("libs"))
    from(layout.buildDirectory.dir("native/nativeCompile")) {
        include("bootstrap")
        filePermissions { unix("755") }
    }
}

// After :lambda:packageNative, with DynamoDB Local on localhost:8000 (see lambda/smoke-test/smoke-test.sh)
val smokeTest by tasks.registering(JavaExec::class) {
    group = "verification"
    description = "Runs the native executable in the Lambda runtime image, with MOTIS mocked."
    mainClass.set("org.litote.motis.mcp.lambda.MockMotisServerKt")
    classpath = sourceSets["test"].runtimeClasspath
    args(file("smoke-test/smoke-test.sh"), layout.buildDirectory.file("native/nativeCompile/bootstrap").get().asFile)
}

jacoco {
    toolVersion = libs.versions.jacoco.get()
}

tasks.test {
    useJUnitPlatform()
}
