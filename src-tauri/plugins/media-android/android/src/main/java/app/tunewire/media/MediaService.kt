package app.tunewire.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.net.URL

/**
 * Foreground media service: keeps the app alive while music plays (screen
 * off, other apps open) and owns the media session behind the notification,
 * the lock screen and headset buttons.
 */
class MediaService : Service() {

    data class State(
        val title: String,
        val artist: String,
        val album: String,
        val artwork: String?,
        val status: String,
        val positionMs: Long,
        val durationMs: Long,
    )

    companion object {
        private const val CHANNEL = "playback"
        private const val NOTIFICATION_ID = 1201
        private const val ACTION = "app.tunewire.media.ACTION"

        @Volatile var onAction: ((String) -> Unit)? = null
        @Volatile private var state: State? = null
        @Volatile private var instance: MediaService? = null
        @Volatile private var art: Pair<String, Bitmap?>? = null

        /** Called by the plugin on every playback change. */
        fun update(context: Context, s: State) {
            state = s
            val running = instance
            when {
                s.status == "stopped" -> running?.stopSelf()
                running == null -> ContextCompat.startForegroundService(context, Intent(context, MediaService::class.java))
                else -> running.refresh()
            }
        }
    }

    private lateinit var session: MediaSessionCompat
    private var wake: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW).apply {
            description = "What's playing, with play and skip buttons"
            setShowBadge(false)
        })
        session = MediaSessionCompat(this, "Tunewire").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = send("play")
                override fun onPause() = send("pause")
                override fun onSkipToNext() = send("next")
                override fun onSkipToPrevious() = send("prev")
                override fun onStop() = send("stop")
            })
            isActive = true
        }
    }

    private fun send(action: String) {
        onAction?.invoke(action)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.getStringExtra(ACTION)?.let { send(it) }
        val n = build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
        refresh()
        return START_NOT_STICKY
    }

    fun refresh() {
        val s = state ?: return
        val playing = s.status == "playing"
        // Keep the CPU awake while music plays (network + decoding with the screen off).
        if (playing && wake?.isHeld != true) {
            wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Tunewire::playback").apply { acquire(6 * 60 * 60 * 1000L) }
        } else if (!playing) {
            wake?.let { if (it.isHeld) it.release() }
            wake = null
        }
        session.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, s.durationMs)
                .apply { artwork(s.artwork)?.let { putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) } }
                .build()
        )
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or PlaybackStateCompat.ACTION_STOP
                )
                .setState(if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED, s.positionMs, if (playing) 1f else 0f)
                .build()
        )
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build())
    }

    /** The cover as a bitmap (downloaded once per song, off the main thread). */
    private fun artwork(url: String?): Bitmap? {
        if (url.isNullOrEmpty() || !url.startsWith("https://")) return null
        val cached = art
        if (cached?.first == url) return cached.second
        art = Pair(url, null)
        Thread {
            val bmp = try {
                URL(url).openStream().use { BitmapFactory.decodeStream(it) }
            } catch (e: Exception) {
                null
            }
            if (art?.first == url) {
                art = Pair(url, bmp)
                instance?.refresh()
            }
        }.start()
        return null
    }

    private fun button(icon: Int, title: String, action: String, code: Int): NotificationCompat.Action {
        val pi = PendingIntent.getService(
            this, code,
            Intent(this, MediaService::class.java).putExtra(ACTION, action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Action(icon, title, pi)
    }

    private fun build(): Notification {
        val s = state
        val playing = s?.status == "playing"
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_tunewire)
            .setContentTitle(s?.title ?: "Tunewire")
            .setContentText(s?.artist ?: "")
            .setLargeIcon(art?.second)
            .setContentIntent(open)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(button(android.R.drawable.ic_media_previous, "Previous", "prev", 1))
            .addAction(
                if (playing) button(android.R.drawable.ic_media_pause, "Pause", "pause", 2)
                else button(android.R.drawable.ic_media_play, "Play", "play", 3)
            )
            .addAction(button(android.R.drawable.ic_media_next, "Next", "next", 4))
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
    }

    override fun onDestroy() {
        wake?.let { if (it.isHeld) it.release() }
        session.isActive = false
        session.release()
        instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
