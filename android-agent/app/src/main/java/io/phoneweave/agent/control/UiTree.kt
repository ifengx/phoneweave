package io.phoneweave.agent.control

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

object UiTree {
    private const val MAX_NODES = 500
    private const val MAX_DEPTH = 12

    fun snapshot(service: PhoneWeaveAccessibilityService): JSONObject {
        val out = JSONObject()
        val windows = JSONArray()
        var budget = MAX_NODES
        service.windows.forEach { window ->
            if (budget <= 0) return@forEach
            val root = window.root ?: return@forEach
            val node = encode(root, 0) { budget-- ; budget >= 0 }
            windows.put(JSONObject()
                .put("id", window.id)
                .put("type", window.type)
                .put("active", window.isActive)
                .put("focused", window.isFocused)
                .put("root", node))
        }
        out.put("windows", windows)
        out.put("truncated", budget <= 0)
        return out
    }

    private fun encode(node: AccessibilityNodeInfo, depth: Int, consume: () -> Boolean): JSONObject {
        val rect = Rect()
        node.getBoundsInScreen(rect)
        val o = JSONObject()
            .put("class", node.className?.toString())
            .put("text", node.text?.toString())
            .put("contentDescription", node.contentDescription?.toString())
            .put("viewId", node.viewIdResourceName)
            .put("clickable", node.isClickable)
            .put("focusable", node.isFocusable)
            .put("editable", node.isEditable)
            .put("enabled", node.isEnabled)
            .put("bounds", JSONObject().put("left", rect.left).put("top", rect.top).put("right", rect.right).put("bottom", rect.bottom))

        val children = JSONArray()
        if (depth < MAX_DEPTH) {
            for (i in 0 until node.childCount) {
                if (!consume()) break
                val child = node.getChild(i) ?: continue
                children.put(encode(child, depth + 1, consume))
            }
        }
        o.put("children", children)
        return o
    }
}
