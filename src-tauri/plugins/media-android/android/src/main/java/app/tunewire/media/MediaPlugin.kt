package app.tunewire.media

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class NowPlayingArgs {
    var title: String = ""
    var artist: String = ""
    var album: String = ""
    var artwork: String? = null
    var status: String = "stopped"
    var positionMs: Long = 0
    var durationMs: Long = 0
}

@InvokeArg
class UrlArgs {
    var url: String = ""
}

/**
 * The playback service's link to the app: `update` shows the song on the
 * notification and lock screen; button presses come back as `action` events
 * ("toggle", "next", "prev", "play", "pause", "stop").
 */
@TauriPlugin
class MediaPlugin(private val activity: Activity) : Plugin(activity) {

    override fun load(webView: WebView) {
        super.load(webView)
        MediaService.onAction = { action ->
            val data = JSObject()
            data.put("action", action)
            trigger("action", data)
        }
        // Android 13+: the playback notification needs permission.
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4711)
        }
    }

    @Command
    fun update(invoke: Invoke) {
        val a = invoke.parseArgs(NowPlayingArgs::class.java)
        MediaService.update(
            activity.applicationContext,
            MediaService.State(a.title, a.artist, a.album, a.artwork, a.status, a.positionMs, a.durationMs)
        )
        invoke.resolve()
    }

    @Command
    fun openUrl(invoke: Invoke) {
        val url = invoke.parseArgs(UrlArgs::class.java).url
        if (!(url.startsWith("https://") || url.startsWith("http://"))) {
            invoke.reject("not a web link")
            return
        }
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "couldn't open the link")
        }
    }
}
