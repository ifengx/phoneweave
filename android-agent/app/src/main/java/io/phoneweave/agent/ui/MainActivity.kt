package io.phoneweave.agent.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.*
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import io.phoneweave.agent.BuildConfig
import io.phoneweave.agent.control.PhoneWeaveAccessibilityService
import io.phoneweave.agent.service.AgentConnectionPhase
import io.phoneweave.agent.service.AgentForegroundService
import io.phoneweave.agent.service.AgentRuntimeState
import io.phoneweave.agent.util.Prefs

private val PhoneWeaveColors = darkColorScheme(
    background = Color(0xFF0F1015),
    surface = Color(0xFF14151B),
    surfaceContainer = Color(0xFF1B1C24),
    surfaceContainerHigh = Color(0xFF232530),
    primary = Color(0xFF3B82F6),
    secondary = Color(0xFF06B6D4),
    tertiary = Color(0xFF10B981),
    onBackground = Color(0xFFF4F4F5),
    onSurface = Color(0xFFF4F4F5),
    outline = Color(0xFF2D303E),
    outlineVariant = Color(0xFF232530),
    error = Color(0xFFEF4444),
)

private fun isAccessibilityEnabled(context: Context): Boolean {
    if (PhoneWeaveAccessibilityService.instance != null) return true
    val expectedService = "${context.packageName}/${PhoneWeaveAccessibilityService::class.java.name}"
    val shortService = "${context.packageName}/.control.PhoneWeaveAccessibilityService"
    val enabledServices = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    val splitter = TextUtils.SimpleStringSplitter(':')
    splitter.setString(enabledServices)
    while (splitter.hasNext()) {
        val service = splitter.next()
        if (service.equals(expectedService, ignoreCase = true) || service.equals(shortService, ignoreCase = true)) {
            return true
        }
    }
    return false
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermission()
        setContent { PhoneWeaveTheme { AgentDashboardScreen() } }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 501)
        }
    }
}

@Composable
private fun PhoneWeaveTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = PhoneWeaveColors, typography = Typography(), content = content)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgentDashboardScreen() {
    val context = LocalContext.current
    var server by remember { mutableStateOf(Prefs.server(context)) }
    var deviceId by remember { mutableStateOf(Prefs.deviceId(context)) }
    var token by remember { mutableStateOf(Prefs.deviceToken(context)) }

    val runtimeState by AgentForegroundService.runtimeState.collectAsState()
    val isConnected = runtimeState.phase == AgentConnectionPhase.CONNECTED

    // When connected, default to collapsing the config card. User can manually toggle it.
    var userExpandedConfig by remember { mutableStateOf<Boolean?>(null) }
    val isConfigExpanded = userExpandedConfig ?: !isConnected

    var accessibilityReady by remember { mutableStateOf(isAccessibilityEnabled(context)) }
    var showAccessibilityPrompt by remember { mutableStateOf(false) }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                accessibilityReady = isAccessibilityEnabled(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    val hasProjection = runtimeState.hasProjection

    val projectionManager = remember { context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager }
    val screenCaptureLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && result.data != null) {
            val service = Intent(context, AgentForegroundService::class.java)
                .setAction(AgentForegroundService.ACTION_SET_PROJECTION)
                .putExtra(AgentForegroundService.EXTRA_PROJECTION_DATA, result.data)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service) else context.startService(service)
        }
    }

    fun save() {
        Prefs.save(context, server.trim(), deviceId.trim(), token.trim(), true)
    }

    fun executeStartAgent() {
        save()
        val intent = Intent(context, AgentForegroundService::class.java).setAction(AgentForegroundService.ACTION_START)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    fun startAgent() {
        val ready = isAccessibilityEnabled(context)
        accessibilityReady = ready
        if (!ready) {
            showAccessibilityPrompt = true
        } else {
            executeStartAgent()
        }
    }

    fun stopAgent() {
        context.stopService(Intent(context, AgentForegroundService::class.java))
    }

    fun restartAgent() {
        stopAgent()
        startAgent()
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = Color(0xFF1E3A8A),
                            modifier = Modifier.size(36.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.PhoneAndroid, null, tint = Color(0xFF60A5FA), modifier = Modifier.size(20.dp))
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text("PhoneWeave", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("REMOTE AGENT · v${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF94A3B8))
                        }
                    }
                },
                actions = {
                    PhaseBadge(runtimeState.phase)
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)
            )
        },
        bottomBar = {
            // Sticky Action Bar: Always visible on screen, no scrolling needed!
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainer,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                shadowElevation = 12.dp
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = 18.dp, vertical = 12.dp)
                ) {
                    ActionButtonsRow(
                        running = runtimeState.running,
                        isConnected = isConnected,
                        onStart = { startAgent() },
                        onStop = { stopAgent() },
                        onRestart = { restartAgent() }
                    )
                }
            }
        }
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 1. Hero Status Card (Top prominent position with quick action)
            RuntimeHeroCard(
                state = runtimeState,
                server = server,
                deviceId = deviceId,
                onStart = { startAgent() },
                onStop = { stopAgent() },
                onRestart = { restartAgent() }
            )

            // 2. System Capabilities & Permission Section
            SectionHeader(title = "系统能力与授权", subtitle = "控制通道与屏幕流授权状态")

            CapabilityStatusCard(
                icon = Icons.Outlined.SettingsAccessibility,
                title = "Accessibility Control",
                subtitle = if (accessibilityReady) "已就绪 · 点击、滑动与 UI 树识别正常" else "未开启 · 需要系统无障碍授权",
                active = accessibilityReady,
                actionLabel = if (accessibilityReady) "查看" else "去授权",
                action = { context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            )

            CapabilityStatusCard(
                icon = Icons.Outlined.Cast,
                title = "Live Screen (WebRTC)",
                subtitle = when {
                    hasProjection -> "实时推流就绪 · 屏幕投影已授权"
                    isConnected -> "未授权 · 建议开启以获得流畅视频流"
                    else -> "MediaProjection 会话级授权"
                },
                active = hasProjection,
                actionLabel = if (hasProjection) "已就绪" else "启用投屏",
                actionEnabled = !hasProjection,
                action = {
                    save()
                    if (!runtimeState.running) startAgent()
                    screenCaptureLauncher.launch(projectionManager.createScreenCaptureIntent())
                }
            )

            // 3. Connection Configuration Card (Collapsible when connected)
            CollapsibleConfigCard(
                isExpanded = isConfigExpanded,
                isConnected = isConnected,
                server = server,
                deviceId = deviceId,
                token = token,
                onServerChange = { server = it },
                onDeviceIdChange = { deviceId = it },
                onTokenChange = { token = it },
                onToggleExpand = { userExpandedConfig = !isConfigExpanded },
                onSave = { save() }
            )

            Spacer(Modifier.height(8.dp))
        }

        if (showAccessibilityPrompt) {
            AccessibilityPromptDialog(
                onConfirm = {
                    showAccessibilityPrompt = false
                    executeStartAgent()
                    context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                },
                onDismiss = {
                    showAccessibilityPrompt = false
                    executeStartAgent()
                },
                onCancel = {
                    showAccessibilityPrompt = false
                }
            )
        }
    }
}

// -----------------------------------------------------------------------------
// Component: Runtime Hero Card
// -----------------------------------------------------------------------------

@Composable
private fun RuntimeHeroCard(
    state: AgentRuntimeState,
    server: String,
    deviceId: String,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onRestart: () -> Unit
) {
    val phase = state.phase
    val isConnected = phase == AgentConnectionPhase.CONNECTED
    val isReconnecting = phase == AgentConnectionPhase.RECONNECTING || phase == AgentConnectionPhase.CONNECTING

    val primaryColor = when (phase) {
        AgentConnectionPhase.CONNECTED -> Color(0xFF10B981)
        AgentConnectionPhase.CONNECTING, AgentConnectionPhase.STARTING -> Color(0xFFF59E0B)
        AgentConnectionPhase.AUTHENTICATING -> Color(0xFF38BDF8)
        AgentConnectionPhase.RECONNECTING -> Color(0xFFF97316)
        AgentConnectionPhase.STOPPED -> Color(0xFF64748B)
    }

    val bgBrush = Brush.verticalGradient(
        colors = listOf(
            primaryColor.copy(alpha = if (isConnected) 0.15f else 0.08f),
            MaterialTheme.colorScheme.surfaceContainer
        )
    )

    Surface(
        modifier = Modifier.fillMaxWidth().animateContentSize(),
        shape = RoundedCornerShape(24.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        border = BorderStroke(1.dp, primaryColor.copy(alpha = if (isConnected) 0.40f else 0.20f))
    ) {
        Column(
            Modifier
                .background(bgBrush)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header Row: Icon + Title + Quick Action
            Row(verticalAlignment = Alignment.CenterVertically) {
                PulsingIndicator(color = primaryColor, active = state.running)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = when (phase) {
                            AgentConnectionPhase.CONNECTED -> "Agent 在线运行中"
                            AgentConnectionPhase.AUTHENTICATING -> "正在验证设备身份..."
                            AgentConnectionPhase.CONNECTING -> "正在连接控制服务器..."
                            AgentConnectionPhase.RECONNECTING -> "正在重连控制服务..."
                            AgentConnectionPhase.STARTING -> "正在启动前台服务..."
                            AgentConnectionPhase.STOPPED -> "Agent 未启动"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = when (phase) {
                            AgentConnectionPhase.CONNECTED -> "设备已就绪，正在实时监听控制指令"
                            AgentConnectionPhase.RECONNECTING -> state.detail?.takeIf { it.isNotBlank() } ?: "自动重试连接中..."
                            AgentConnectionPhase.STOPPED -> "点击下方按钮启动 Agent 连接控制服务"
                            else -> server.ifBlank { "未指定服务器" }
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF94A3B8)
                    )
                }
            }

            // If Connected, show live status metrics grid
            if (isConnected) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    MetricTile(
                        modifier = Modifier.weight(1f),
                        icon = Icons.Outlined.CloudDone,
                        label = "通道状态",
                        value = "WS 101 直连",
                        tint = Color(0xFF10B981)
                    )
                    MetricTile(
                        modifier = Modifier.weight(1f),
                        icon = Icons.Outlined.Shield,
                        label = "控制租约",
                        value = when (state.leaseMode) {
                            "HUMAN" -> "人工接管中"
                            "AGENT" -> "AI 操控中"
                            else -> "FREE (就绪)"
                        },
                        tint = when (state.leaseMode) {
                            "HUMAN" -> Color(0xFFF59E0B)
                            "AGENT" -> Color(0xFF8B5CF6)
                            else -> Color(0xFF38BDF8)
                        }
                    )
                }
            } else if (isReconnecting) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth().height(4.dp).clip(CircleShape),
                    color = primaryColor,
                    trackColor = primaryColor.copy(alpha = 0.2f)
                )
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Component: Collapsible Connection Configuration Card
// -----------------------------------------------------------------------------

@Composable
private fun CollapsibleConfigCard(
    isExpanded: Boolean,
    isConnected: Boolean,
    server: String,
    deviceId: String,
    token: String,
    onServerChange: (String) -> Unit,
    onDeviceIdChange: (String) -> Unit,
    onTokenChange: (String) -> Unit,
    onToggleExpand: () -> Unit,
    onSave: () -> Unit
) {
    var tokenVisible by remember { mutableStateOf(false) }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .animateContentSize(),
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Column(
            Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Header Row (Always visible, acts as toggle)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .clickable { onToggleExpand() }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = Color(0xFF1E293B),
                    modifier = Modifier.size(42.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Dns, null, tint = Color(0xFF94A3B8), modifier = Modifier.size(22.dp))
                    }
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("连接配置", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        if (!isExpanded) {
                            Spacer(Modifier.width(8.dp))
                            Surface(
                                shape = RoundedCornerShape(6.dp),
                                color = Color(0xFF1E293B)
                            ) {
                                Text(
                                    text = "已收起",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Color(0xFF94A3B8),
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                        }
                    }
                    if (!isExpanded) {
                        Text(
                            text = "$server · $deviceId",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF64748B),
                            maxLines = 1
                        )
                    } else {
                        Text("控制服务器地址与设备认证 Token", style = MaterialTheme.typography.bodySmall, color = Color(0xFF94A3B8))
                    }
                }
                IconButton(onClick = onToggleExpand) {
                    Icon(
                        imageVector = if (isExpanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                        contentDescription = if (isExpanded) "收起" else "展开",
                        tint = Color(0xFF94A3B8)
                    )
                }
            }

            // Expandable form body
            AnimatedVisibility(
                visible = isExpanded,
                enter = fadeIn() + expandVertically(),
                exit = fadeOut() + shrinkVertically()
            ) {
                Column(
                    modifier = Modifier.padding(top = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    OutlinedTextField(
                        value = server,
                        onValueChange = onServerChange,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Server URL") },
                        placeholder = { Text(BuildConfig.DEFAULT_SERVER_URL) },
                        leadingIcon = { Icon(Icons.Outlined.Link, null, tint = Color(0xFF94A3B8)) },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp)
                    )

                    OutlinedTextField(
                        value = deviceId,
                        onValueChange = onDeviceIdChange,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Device ID") },
                        leadingIcon = { Icon(Icons.Outlined.PermIdentity, null, tint = Color(0xFF94A3B8)) },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace)
                    )

                    OutlinedTextField(
                        value = token,
                        onValueChange = onTokenChange,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Device Token") },
                        leadingIcon = { Icon(Icons.Outlined.Lock, null, tint = Color(0xFF94A3B8)) },
                        trailingIcon = {
                            IconButton(onClick = { tokenVisible = !tokenVisible }) {
                                Icon(
                                    imageVector = if (tokenVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                    contentDescription = if (tokenVisible) "隐藏 Token" else "显示明文 Token",
                                    tint = if (tokenVisible) MaterialTheme.colorScheme.primary else Color(0xFF94A3B8)
                                )
                            }
                        },
                        singleLine = true,
                        visualTransformation = if (tokenVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        shape = RoundedCornerShape(14.dp),
                        textStyle = if (tokenVisible) LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace) else LocalTextStyle.current
                    )

                    Button(
                        onClick = onSave,
                        modifier = Modifier.fillMaxWidth().height(46.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B))
                    ) {
                        Icon(Icons.Outlined.Save, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("保存本地配置")
                    }
                }
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Component: Capability Status Card
// -----------------------------------------------------------------------------

@Composable
private fun CapabilityStatusCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    active: Boolean,
    actionLabel: String,
    actionEnabled: Boolean = true,
    action: () -> Unit
) {
    val activeColor = Color(0xFF10B981)
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, if (active) activeColor.copy(alpha = 0.25f) else MaterialTheme.colorScheme.outlineVariant)
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = if (active) activeColor.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier.size(44.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = if (active) activeColor else Color(0xFF94A3B8),
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                    if (active) {
                        Spacer(Modifier.width(6.dp))
                        Icon(Icons.Outlined.CheckCircle, null, tint = activeColor, modifier = Modifier.size(16.dp))
                    }
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (active) Color(0xFFA7F3D0) else Color(0xFF94A3B8)
                )
            }
            TextButton(
                onClick = action,
                enabled = actionEnabled,
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(actionLabel, color = if (active) activeColor else MaterialTheme.colorScheme.primary)
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Component: Action Buttons Row (Fixed Bottom / Sticky)
// -----------------------------------------------------------------------------

@Composable
private fun ActionButtonsRow(
    running: Boolean,
    isConnected: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onRestart: () -> Unit
) {
    if (!running) {
        Button(
            onClick = onStart,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
        ) {
            Icon(Icons.Outlined.PlayArrow, null, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(8.dp))
            Text("启动 Agent 服务", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        }
    } else {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedButton(
                onClick = onRestart,
                modifier = Modifier.weight(1f).height(50.dp),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
            ) {
                Icon(Icons.Outlined.Refresh, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("重新连接")
            }

            Button(
                onClick = onStop,
                modifier = Modifier.weight(1f).height(50.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444))
            ) {
                Icon(Icons.Outlined.Stop, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("停止 Agent")
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Helper UI Widgets
// -----------------------------------------------------------------------------

@Composable
private fun SectionHeader(title: String, subtitle: String) {
    Column(Modifier.padding(start = 4.dp, top = 4.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Color(0xFFF4F4F5))
        Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Color(0xFF64748B))
    }
}

@Composable
private fun MetricTile(
    modifier: Modifier = Modifier,
    icon: ImageVector,
    label: String,
    value: String,
    tint: Color
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Column {
                Text(label, style = MaterialTheme.typography.labelSmall, color = Color(0xFF94A3B8))
                Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = Color(0xFFF4F4F5))
            }
        }
    }
}

@Composable
private fun PulsingIndicator(color: Color, active: Boolean) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = EaseInOutCubic),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseAlpha"
    )

    Box(
        modifier = Modifier.size(44.dp),
        contentAlignment = Alignment.Center
    ) {
        if (active) {
            Surface(
                modifier = Modifier.size(36.dp).alpha(alpha * 0.4f),
                shape = CircleShape,
                color = color
            ) {}
        }
        Surface(
            modifier = Modifier.size(20.dp),
            shape = CircleShape,
            color = color
        ) {
            Box(contentAlignment = Alignment.Center) {
                Box(Modifier.size(8.dp).background(Color.White, CircleShape))
            }
        }
    }
}

@Composable
private fun PhaseBadge(phase: AgentConnectionPhase) {
    val (text, color) = when (phase) {
        AgentConnectionPhase.CONNECTED -> "在线" to Color(0xFF10B981)
        AgentConnectionPhase.AUTHENTICATING -> "验证中" to Color(0xFF38BDF8)
        AgentConnectionPhase.CONNECTING -> "连接中" to Color(0xFFF59E0B)
        AgentConnectionPhase.RECONNECTING -> "重连中" to Color(0xFFF97316)
        AgentConnectionPhase.STARTING -> "启动中" to Color(0xFFF59E0B)
        AgentConnectionPhase.STOPPED -> "未运行" to Color(0xFF64748B)
    }

    Surface(
        color = color.copy(alpha = 0.15f),
        shape = RoundedCornerShape(999.dp),
        border = BorderStroke(1.dp, color.copy(alpha = 0.3f)),
        modifier = Modifier.padding(end = 12.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(Modifier.size(6.dp).background(color, CircleShape))
            Spacer(Modifier.width(6.dp))
            Text(text, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Medium, color = color)
        }
    }
}

// -----------------------------------------------------------------------------
// Component: Accessibility Prompt Dialog (Guiding user to enable accessibility)
// -----------------------------------------------------------------------------

@Composable
private fun AccessibilityPromptDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    onCancel: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onCancel,
        shape = RoundedCornerShape(24.dp),
        containerColor = MaterialTheme.colorScheme.surfaceContainer,
        icon = {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = Color(0xFF1E3A8A),
                modifier = Modifier.size(52.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Outlined.SettingsAccessibility,
                        contentDescription = null,
                        tint = Color(0xFF60A5FA),
                        modifier = Modifier.size(28.dp)
                    )
                }
            }
        },
        title = {
            Text(
                text = "开启无障碍服务授权",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = Color(0xFFF4F4F5)
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(
                    text = "PhoneWeave 需要开启系统无障碍服务，以支持远程屏幕点击、滑动手势、按键模拟及 UI 树结构识别。\n\n若未开启，远程控制端将仅能监视画面，无法执行触控交互操作。",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF94A3B8),
                    lineHeight = 20.sp
                )

                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = Color(0xFF1E293B),
                    border = BorderStroke(1.dp, Color(0xFF334155)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Info,
                            contentDescription = null,
                            tint = Color(0xFF38BDF8),
                            modifier = Modifier.size(16.dp).padding(top = 2.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = "提示：在 Android 13 及以上设备，若系统无障碍列表中的 PhoneWeave 显示灰色不可点，请前往系统【应用信息】页面，点击右上角【⋮】菜单选择【允许受限制的设置】。",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFF94A3B8),
                            lineHeight = 16.sp
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
            ) {
                Icon(Icons.Outlined.Settings, null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("前往开启", fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            OutlinedButton(
                onClick = onDismiss,
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
            ) {
                Text("暂不开启并启动", color = Color(0xFF94A3B8))
            }
        }
    )
}

