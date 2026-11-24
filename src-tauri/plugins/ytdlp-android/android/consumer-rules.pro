# youtubedl-android maps yt-dlp's JSON with Jackson.
-keep class com.yausername.** { *; }
-keep class app.tunewire.ytdlp.** { *; }
# It unpacks the bundled Python with Apache Commons Compress, which finds
# its zip classes by name: renamed or removed by the release shrinker, the
# first launch crashed ("class … is not a concrete class").
-keep class org.apache.commons.compress.** { *; }
-dontwarn org.apache.commons.compress.**
-keep class org.tukaani.xz.** { *; }
-dontwarn org.tukaani.xz.**
# Jackson reads yt-dlp's JSON into these classes by reflection.
-keep class com.fasterxml.jackson.** { *; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-dontwarn com.fasterxml.jackson.**
