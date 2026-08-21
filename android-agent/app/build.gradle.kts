import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val agentVersionProperties = Properties().apply {
    val versionFile = rootProject.projectDir.parentFile.resolve("agent-version.properties")
    require(versionFile.isFile) { "Missing agent-version.properties at ${versionFile.absolutePath}" }
    versionFile.inputStream().use(::load)
}
val phoneWeaveVersionName = agentVersionProperties.getProperty("PHONEWEAVE_AGENT_VERSION_NAME")
    ?: error("PHONEWEAVE_AGENT_VERSION_NAME is required")
val phoneWeaveVersionCode = agentVersionProperties.getProperty("PHONEWEAVE_AGENT_VERSION_CODE")
    ?.toIntOrNull() ?: error("PHONEWEAVE_AGENT_VERSION_CODE must be an integer")

val phoneWeaveDefaultServerUrl = providers.gradleProperty("phoneweaveDefaultServerUrl")
    .orElse(providers.environmentVariable("PHONEWEAVE_ANDROID_SERVER_URL"))
    .orElse("http://10.0.2.2:8787")
    .get()
val escapedDefaultServerUrl = phoneWeaveDefaultServerUrl
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")

android {
    namespace = "io.phoneweave.agent"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.phoneweave.agent"
        minSdk = 30
        targetSdk = 36
        versionCode = phoneWeaveVersionCode
        versionName = phoneWeaveVersionName
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$escapedDefaultServerUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.github.webrtc-sdk:android:144.7559.09")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
