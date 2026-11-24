package app.tunewire.ytdlp

import android.app.Activity
import android.util.Log
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@InvokeArg
class ExecuteArgs {
    var args: Array<String> = emptyArray()
}

/**
 * Runs yt-dlp (bundled Python + yt-dlp from youtubedl-android) with the same
 * arguments the desktop app passes to its yt-dlp program.
 */
@TauriPlugin
class YtdlpPlugin(private val activity: Activity) : Plugin(activity) {
    private val ready = CountDownLatch(1)
    @Volatile private var initError: String? = null
    // Same cap as desktop (MAX_CONCURRENT in ytdlp.rs).
    private val pool = Executors.newFixedThreadPool(3)

    override fun load(webView: WebView) {
        super.load(webView)
        Thread {
            val ctx = activity.applicationContext
            try {
                YoutubeDL.getInstance().init(ctx)
            } catch (e: Exception) {
                initError = e.message ?: e.toString()
                Log.e(TAG, "init failed", e)
            }
            ready.countDown()
            // YouTube changes often; keep yt-dlp current (quietly).
            if (initError == null) {
                try {
                    val status = YoutubeDL.getInstance().updateYoutubeDL(ctx, YoutubeDL.UpdateChannel.STABLE)
                    Log.i(TAG, "yt-dlp update: $status (${YoutubeDL.getInstance().versionName(ctx)})")
                } catch (e: Exception) {
                    Log.w(TAG, "yt-dlp update failed: ${e.message}")
                }
            }
        }.start()
    }

    @Command
    fun execute(invoke: Invoke) {
        val args = invoke.parseArgs(ExecuteArgs::class.java).args.toList()
        pool.execute {
            val ret = JSObject()
            if (!ready.await(120, TimeUnit.SECONDS) || initError != null) {
                ret.put("code", 127)
                ret.put("stdout", "")
                ret.put("stderr", "ERROR: yt-dlp is not ready: ${initError ?: "still starting"}")
                invoke.resolve(ret)
                return@execute
            }
            try {
                // No URL list: the arguments already hold the targets.
                val request = YoutubeDLRequest(emptyList<String>()).addCommands(args)
                val r = YoutubeDL.getInstance().execute(request, null, null)
                ret.put("code", r.exitCode)
                ret.put("stdout", r.out)
                ret.put("stderr", r.err)
            } catch (e: YoutubeDLException) {
                // Non-zero exit: the message is yt-dlp's stderr.
                ret.put("code", 1)
                ret.put("stdout", "")
                ret.put("stderr", e.message ?: "ERROR: yt-dlp failed")
            } catch (e: Exception) {
                ret.put("code", 1)
                ret.put("stdout", "")
                ret.put("stderr", "ERROR: ${e.message ?: e}")
            }
            invoke.resolve(ret)
        }
    }

    @Command
    fun version(invoke: Invoke) {
        val ret = JSObject()
        ret.put("version", try { YoutubeDL.getInstance().versionName(activity.applicationContext) ?: "" } catch (e: Exception) { "" })
        invoke.resolve(ret)
    }

    companion object {
        private const val TAG = "TunewireYtdlp"
    }
}
