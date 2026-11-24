// Dev tooling: the generator of the names of the railway stations (server/src/main/resources/stations/stations.tsv).
// ./gradlew :tools:station-names:run [-Pcsv=stations.csv]   (the Trainline CSV is downloaded when no file is given)
plugins {
    alias(libs.plugins.kotlin.jvm)
    application
}

dependencies {
    implementation(libs.serialization.json)
}

kotlin {
    jvmToolchain(25)
}

application {
    mainClass = "org.litote.motis.stations.GenerateStationNamesKt"
}

tasks.named<JavaExec>("run") {
    description = "Generates stations.tsv of the server from Trainline stations and Wikidata (-Pcsv=stations.csv: no download)."
    args(
        listOfNotNull(
            rootProject.layout.projectDirectory.file("server/src/main/resources/stations/stations.tsv").asFile.absolutePath,
            providers.gradleProperty("csv").orNull?.let { rootProject.file(it).absolutePath },
        ),
    )
}
