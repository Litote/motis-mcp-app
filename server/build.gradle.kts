plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    jacoco
    alias(libs.plugins.shadow)
    application
}

dependencies {
    implementation(libs.mcp.server)
    implementation(libs.motis.client)
    implementation(libs.ktor.server.cio)
    implementation(libs.ktor.server.cors)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.serialization.json)
    implementation(libs.kotlin.logging)
    runtimeOnly(libs.logback)

    testImplementation(kotlin("test"))
    testImplementation(libs.mcp.client)
    testImplementation(libs.ktor.client.mock)
}

// APP_VERSION constant (MCP serverInfo, User-Agent sent to MOTIS) from the project version
val generateAppInfo by tasks.registering {
    group = "build"
    description = "Generates the APP_VERSION constant from the project version."
    val appVersion = version.toString()
    val outputDir = layout.buildDirectory.dir("generated/appInfo/kotlin")
    inputs.property("appVersion", appVersion)
    outputs.dir(outputDir)
    doLast {
        val file = outputDir.get().file("org/litote/motis/mcp/AppInfo.kt").asFile
        file.parentFile.mkdirs()
        file.writeText(
            """
            |package org.litote.motis.mcp
            |
            |const val APP_VERSION: String = "$appVersion"
            |""".trimMargin(),
        )
    }
}

kotlin {
    jvmToolchain(25)
    sourceSets.main {
        kotlin.srcDir(generateAppInfo)
    }
}

application {
    mainClass = "org.litote.motis.mcp.MainKt"
}

// --- UI views (ui/, TypeScript + Vite): each view is bundled into a single HTML file served as a ui:// resource ---

val uiDir = rootProject.layout.projectDirectory.dir("ui")

// The Gradle daemon may not see the PATH of the shell (nvm...): npm is resolved from the PATH of the build invocation,
// or given with -Pnpm=/path/to/npm.
val buildPath: String = providers.environmentVariable("PATH").getOrElse("")
val npm: String =
    providers.gradleProperty("npm").orNull
        ?: buildPath.split(File.pathSeparator).map { File(it, "npm") }.firstOrNull { it.canExecute() }?.absolutePath
        ?: "npm"

val npmInstall by tasks.registering(Exec::class) {
    group = "ui"
    description = "Installs the UI dependencies."
    workingDir = uiDir.asFile
    environment("PATH", buildPath)
    commandLine(npm, "ci", "--no-audit", "--no-fund")
    inputs.file(uiDir.file("package-lock.json"))
    outputs.dir(uiDir.dir("node_modules"))
}

val buildUi by tasks.registering(Exec::class) {
    group = "ui"
    description = "Bundles the MCP App views into single HTML files."
    dependsOn(npmInstall)
    workingDir = uiDir.asFile
    environment("PATH", buildPath)
    commandLine(npm, "run", "build")
    inputs.dir(uiDir.dir("src"))
    inputs.files(uiDir.file("package.json"), uiDir.file("build.mjs"), uiDir.file("tsconfig.json"))
    outputs.dir(uiDir.dir("dist"))
}

tasks.processResources {
    from(buildUi) {
        include("*.html")
        into("ui")
    }
}

jacoco {
    toolVersion = libs.versions.jacoco.get()
}

tasks.test {
    useJUnitPlatform()
}
