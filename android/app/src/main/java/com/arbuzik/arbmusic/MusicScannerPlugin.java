package com.arbuzik.arbmusic;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "MusicScanner", permissions = {
    @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "storage")
})
public class MusicScannerPlugin extends Plugin {

    private static final int MAX_TRACKS = 5000;
    private static final long MIN_DURATION_MS = 8000;
    private static final Set<String> AUDIO_EXT = new HashSet<>(Arrays.asList(
        "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "wma"));

    @PluginMethod
    public void scan(PluginCall call) {
        if (!hasStorageAccess()) {
            if (Build.VERSION.SDK_INT >= 30) {
                call.resolve(permsResult("needsAllFiles"));
            } else {
                requestPermissionForAlias("storage", call, "storageCallback");
            }
            return;
        }
        doScan(call);
    }

    @PermissionCallback
    public void storageCallback(PluginCall call) {
        if (hasStorageAccess()) {
            doScan(call);
        } else {
            call.resolve(permsResult("denied"));
        }
    }

    private boolean hasStorageAccess() {
        if (Build.VERSION.SDK_INT >= 30) {
            return Environment.isExternalStorageManager();
        }
        return getContext().checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject permsResult(String status) {
        JSObject r = new JSObject();
        r.put("status", status);
        r.put("tracks", new JSArray());
        return r;
    }

    private void doScan(PluginCall call) {
        new Thread(() -> {
            JSArray arr = new JSArray();
            try {
                File root = Environment.getExternalStorageDirectory();
                List<File> found = new ArrayList<>();
                Deque<File> stack = new ArrayDeque<>();
                if (root != null) stack.push(root);
                int depthGuard = 0;
                while (!stack.isEmpty() && found.size() < MAX_TRACKS && depthGuard < 400000) {
                    depthGuard++;
                    File dir = stack.pop();
                    File[] entries = dir.listFiles();
                    if (entries == null) continue;
                    for (File f : entries) {
                        String name = f.getName();
                        if (name.startsWith(".")) continue;
                        if (f.isDirectory()) {
                            if (name.equals("Android") || name.equals("obb") || name.equals("data")) continue;
                            stack.push(f);
                        } else {
                            int dot = name.lastIndexOf('.');
                            if (dot < 0) continue;
                            String ext = name.substring(dot + 1).toLowerCase(Locale.US);
                            if (AUDIO_EXT.contains(ext)) found.add(f);
                        }
                    }
                }

                for (File f : found) {
                    JSObject t = readMeta(f);
                    if (t != null) arr.put(t);
                }
            } catch (Throwable e) {
                // return whatever we collected
            }

            JSObject res = new JSObject();
            res.put("status", "ok");
            res.put("tracks", arr);
            call.resolve(res);
        }, "arbmusic-scan").start();
    }

    private JSObject readMeta(File f) {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            mmr.setDataSource(f.getAbsolutePath());
            long durMs = 0;
            try {
                String d = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                if (d != null) durMs = Long.parseLong(d);
            } catch (Exception ignored) {
            }
            if (durMs > 0 && durMs < MIN_DURATION_MS) return null; // skip UI sounds / ringtones

            String title = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            String artist = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            String albumArtist = null;
            try {
                albumArtist = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST);
            } catch (Exception ignored) {
            }
            String album = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);

            String name = f.getName();
            String base = name.substring(0, name.lastIndexOf('.'));
            if (title == null || title.trim().isEmpty()) title = base;
            if (artist == null || artist.trim().isEmpty()) {
                // fallback: "Artist - Title" in filename
                String b = base.replaceFirst("^\\s*\\d+[\\s.\\-_]+", "");
                int idx = b.indexOf(" - ");
                if (idx > 0) {
                    artist = b.substring(0, idx).trim();
                    if (title.equals(base)) title = b.substring(idx + 3).trim();
                } else {
                    artist = "Неизвестный исполнитель";
                }
            }
            if (albumArtist != null && !albumArtist.trim().isEmpty() && artist.contains(albumArtist)) artist = albumArtist;

            JSObject t = new JSObject();
            t.put("path", f.getAbsolutePath());
            t.put("name", name);
            t.put("title", title);
            t.put("artist", artist);
            t.put("album", album == null ? "" : album);
            t.put("duration", durMs / 1000.0);
            t.put("ext", name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.US));
            return t;
        } catch (Throwable e) {
            return null;
        } finally {
            try {
                mmr.release();
            } catch (Exception ignored) {
            }
        }
    }

    @PluginMethod
    public void getArt(PluginCall call) {
        String path = call.getString("path");
        JSObject res = new JSObject();
        res.put("data", null);
        if (path == null) {
            call.resolve(res);
            return;
        }
        new Thread(() -> {
            MediaMetadataRetriever mmr = new MediaMetadataRetriever();
            try {
                mmr.setDataSource(path);
                byte[] pic = mmr.getEmbeddedPicture();
                if (pic != null && pic.length > 4) {
                    String mime = (pic[0] == (byte) 0x89 && pic[1] == 'P') ? "image/png" : "image/jpeg";
                    String data = "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(pic);
                    res.put("data", data);
                }
            } catch (Throwable ignored) {
            } finally {
                try {
                    mmr.release();
                } catch (Exception ignored) {
                }
            }
            call.resolve(res);
        }, "arbmusic-art").start();
    }

    @PluginMethod
    public void getLyrics(PluginCall call) {
        String path = call.getString("path");
        JSObject res = new JSObject();
        res.put("lyrics", null);
        if (path == null) {
            call.resolve(res);
            return;
        }
        new Thread(() -> {
            try {
                File f = new File(path);
                File dir = f.getParentFile();
                if (dir != null && dir.exists()) {
                    String base = f.getName();
                    int dot = base.lastIndexOf('.');
                    if (dot > 0) base = base.substring(0, dot);
                    base = base.toLowerCase(Locale.US);
                    File[] entries = dir.listFiles();
                    if (entries != null) {
                        for (File e : entries) {
                            String n = e.getName().toLowerCase(Locale.US);
                            if (n.equals(base + ".lrc") || n.equals(base + ".txt")) {
                                res.put("lyrics", readTextFile(e));
                                break;
                            }
                        }
                    }
                }
            } catch (Throwable ignored) {
            }
            call.resolve(res);
        }, "arbmusic-lrc").start();
    }

    private String readTextFile(File f) throws IOException {
        byte[] bytes = readAll(f);
        try {
            CharsetDecoder dec = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
            return dec.decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            return new String(bytes, Charset.forName("windows-1251"));
        }
    }

    private byte[] readAll(File f) throws IOException {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) Math.min(f.length(), 2_000_000L)];
            int off = 0, r;
            while (off < buf.length && (r = in.read(buf, off, buf.length - off)) > 0) off += r;
            return off == buf.length ? buf : Arrays.copyOf(buf, off);
        }
    }

    @PluginMethod
    public void openAllFilesSettings(PluginCall call) {
        try {
            Intent i;
            if (Build.VERSION.SDK_INT >= 30) {
                i = new Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName()));
            } else {
                i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Throwable e) {
            try {
                Intent i = new Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } catch (Throwable ignored) {
            }
            call.resolve();
        }
    }
}
