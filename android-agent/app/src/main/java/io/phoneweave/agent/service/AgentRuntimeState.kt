package io.phoneweave.agent.service

enum class AgentConnectionPhase {
    STOPPED,
    STARTING,
    CONNECTING,
    AUTHENTICATING,
    CONNECTED,
    RECONNECTING,
}

data class AgentRuntimeState(
    val phase: AgentConnectionPhase = AgentConnectionPhase.STOPPED,
    val detail: String? = null,
    val hasProjection: Boolean = false,
    val leaseMode: String = "FREE",
    val connectedAt: Long = 0L,
) {
    val running: Boolean
        get() = phase != AgentConnectionPhase.STOPPED
}
