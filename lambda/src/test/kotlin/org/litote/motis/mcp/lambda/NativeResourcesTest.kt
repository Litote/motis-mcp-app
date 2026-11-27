package org.litote.motis.mcp.lambda

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.FileSystem
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.isRegularFile
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The native image embeds only the resources declared in its reachability metadata: a resource of the server
 * missing there is `null` in the Lambda only (e.g. the logo, `serverInfo.icons` empty), never in the JVM tests.
 */
class NativeResourcesTest {
    private val metadataPath = "META-INF/native-image/org.litote/motis-mcp-lambda/reachability-metadata.json"

    /** Resources of the server not read by the Lambda. */
    private val notInNativeImage =
        listOf(
            "logback.xml", // JVM server only: logback excluded from the Lambda
            "**/README.md",
            "META-INF/**",
            "**.class", // the jar of the server holds its classes too
        ).map { FileSystems.getDefault().getPathMatcher("glob:$it") }

    @Test
    fun `every resource of the server is declared in the native image`() {
        val declared =
            Json
                .parseToJsonElement(resourceText(metadataPath))
                .jsonObject
                .getValue("resources")
                .jsonArray
                .mapNotNull { it.jsonObject["glob"]?.jsonPrimitive?.content }
                .map { FileSystems.getDefault().getPathMatcher("glob:$it") }

        val missing =
            serverResources()
                .filterNot { resource -> notInNativeImage.any { it.matches(resource) } }
                .filterNot { resource -> declared.any { it.matches(resource) } }

        assertTrue(missing.isEmpty(), "add to the resources of $metadataPath: $missing")
    }

    private fun resourceText(path: String): String =
        checkNotNull(javaClass.classLoader.getResource(path)) { "$path not found" }.readText()

    /** Relative paths of the resources of the server module, from its directory or its jar. */
    private fun serverResources(): List<Path> {
        // a resource of the server only, to find the root of its resources on the classpath
        val anchor = "stations/stations.tsv"
        val uri = checkNotNull(javaClass.classLoader.getResource(anchor)) { "$anchor not found" }.toURI()
        val jar: FileSystem? = if (uri.scheme == "jar") FileSystems.newFileSystem(uri, emptyMap<String, Any>()) else null
        return jar.use {
            val file = it?.provider()?.getPath(uri) ?: Path.of(uri)
            val root = file.parent.parent
            Files.walk(root).use { paths ->
                paths
                    .filter { path -> path.isRegularFile() }
                    .map { path -> Path.of(root.relativize(path).toString()) }
                    .toList()
            }
        }.also { assertTrue(it.isNotEmpty(), "no resource found for the server") }
    }
}
