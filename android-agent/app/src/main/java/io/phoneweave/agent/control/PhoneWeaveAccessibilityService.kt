package io.phoneweave.agent.control

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

class PhoneWeaveAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile var instance: PhoneWeaveAccessibilityService? = null
            private set
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        io.phoneweave.agent.service.AgentForegroundService.instance?.refreshCapabilities()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (instance === this) instance = null
        io.phoneweave.agent.service.AgentForegroundService.instance?.refreshCapabilities()
        super.onDestroy()
    }
}
