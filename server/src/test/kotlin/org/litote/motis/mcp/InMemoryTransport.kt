package org.litote.motis.mcp

import io.modelcontextprotocol.kotlin.sdk.shared.AbstractTransport
import io.modelcontextprotocol.kotlin.sdk.shared.TransportSendOptions
import io.modelcontextprotocol.kotlin.sdk.types.JSONRPCMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Transport delivering the messages to [peer] in memory, for the tests. */
class InMemoryTransport private constructor(private val scope: CoroutineScope) : AbstractTransport() {
    private lateinit var peer: InMemoryTransport

    override suspend fun start() {}

    override suspend fun send(message: JSONRPCMessage, options: TransportSendOptions?) {
        // asynchronous delivery: a request handler may wait for another message
        scope.launch { peer._onMessage(message) }
    }

    override suspend fun close() {
        invokeOnCloseCallback()
        scope.cancel()
    }

    companion object {
        /** Two connected transports: (client side, server side). */
        fun pair(): Pair<InMemoryTransport, InMemoryTransport> {
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val client = InMemoryTransport(scope)
            val server = InMemoryTransport(scope)
            client.peer = server
            server.peer = client
            return client to server
        }
    }
}
