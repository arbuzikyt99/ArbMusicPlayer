import Foundation
import Capacitor
import AVFoundation

/**
 * ArbMusic native scanner for iOS.
 * Scans the app's Documents folder (user adds music via Finder / Files app / share sheet),
 * returns metadata, embedded artwork and .lrc/.txt lyrics.
 */
@objc(ArbMusicScannerPlugin)
public class ArbMusicScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ArbMusicScannerPlugin"
    public let jsName = "MusicScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getArt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLyrics", returnType: CAPPluginReturnPromise)
    ]

    private let audioExt: Set<String> = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "wma"]
    private let maxTracks = 5000

    // MARK: - scan

    @objc func scan(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            var tracks: [[String: Any]] = []
            let fm = FileManager.default
            if let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first {
                if let e = fm.enumerator(at: docs, includingPropertiesForKeys: [.isRegularFileKey, .contentModificationDateKey], options: [.skipsHiddenFiles]) {
                    for case let url as URL in e {
                        if tracks.count >= self.maxTracks { break }
                        let ext = url.pathExtension.lowercased()
                        guard self.audioExt.contains(ext), let meta = self.readMeta(url) else { continue }
                        tracks.append(meta)
                    }
                }
            }
            tracks.sort { a, b in
                let aa = (a["artist"] as? String ?? "", a["title"] as? String ?? "")
                let bb = (b["artist"] as? String ?? "", b["title"] as? String ?? "")
                return aa < bb
            }
            call.resolve(["status": "ok", "tracks": tracks])
        }
    }

    private func readMeta(_ url: URL) -> [String: Any]? {
        let name = url.lastPathComponent
        let ext = url.pathExtension.lowercased()
        var dur: Double = 0
        var title: String?
        var artist: String?
        var album: String?
        var artwork: Data?
        let semaphore = DispatchSemaphore(value: 0)
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: false])
        asset.loadValuesAsynchronously(forKeys: ["duration", "commonMetadata"]) {
            var err: NSError?
            let st = asset.statusOfValue(forKey: "duration", error: &err)
            if st == .loaded {
                dur = CMTimeGetSeconds(asset.duration)
                if !dur.isFinite { dur = 0 }
            }
            let st2 = asset.statusOfValue(forKey: "commonMetadata", error: &err)
            if st2 == .loaded {
                for item in asset.commonMetadata {
                    guard let key = item.commonKey else { continue }
                    switch key {
                    case .commonKeyTitle: title = item.stringValue
                    case .commonKeyArtist: artist = item.stringValue
                    case .commonKeyAlbumName: album = item.stringValue
                    case .commonKeyArtwork: artwork = item.dataValue
                    default: break
                    }
                }
            }
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 6)
        if dur > 0 && dur < 8 { return nil } // skip ringtones / ui sounds

        let base = (name as NSString).deletingPathExtension
        let parsed = Self.parseName(base)
        if title == nil || title!.trimmingCharacters(in: .whitespaces).isEmpty { title = parsed.title }
        if artist == nil || artist!.trimmingCharacters(in: .whitespaces).isEmpty { artist = parsed.artist }
        if title == parsed.title { title = parsed.title }

        var t: [String: Any] = [
            "path": url.path,
            "name": name,
            "title": title ?? base,
            "artist": artist ?? "Неизвестный исполнитель",
            "album": album ?? "",
            "duration": dur,
            "ext": ext
        ]
        if let aw = artwork {
            let mime = (aw.count > 4 && aw[aw.startIndex] == 0x89) ? "image/png" : "image/jpeg"
            t["art"] = "data:\(mime);base64,\(aw.base64EncodedString())"
        }
        return t
    }

    static func parseName(_ base: String) -> (title: String, artist: String) {
        var b = base
        if let r = b.range(of: "^[0-9]+[\\s.\\-_]+", options: .regularExpression) { b = String(b[r.upperBound...]) }
        if let idx = b.range(of: " - ") {
            let artist = String(b[..<idx.lowerBound]).trimmingCharacters(in: .whitespaces)
            let title = String(b[idx.upperBound...]).trimmingCharacters(in: .whitespaces)
            if !artist.isEmpty && !title.isEmpty { return (title, artist) }
        }
        return (b.trimmingCharacters(in: .whitespaces), "Неизвестный исполнитель")
    }

    // MARK: - art

    @objc func getArt(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.resolve(["data": NSNull()])
            return
        }
        DispatchQueue.global(qos: .utility).async {
            var result: [String: Any] = ["data": NSNull()]
            if FileManager.default.fileExists(atPath: path) {
                let asset = AVURLAsset(url: URL(fileURLWithPath: path))
                var done = false
                let sem = DispatchSemaphore(value: 0)
                asset.loadValuesAsynchronously(forKeys: ["commonMetadata"]) {
                    for item in asset.commonMetadata {
                        if item.commonKey == .commonKeyArtwork, let data = item.dataValue {
                            let mime = (data.count > 4 && data[data.startIndex] == 0x89) ? "image/png" : "image/jpeg"
                            result["data"] = "data:\(mime);base64,\(data.base64EncodedString())"
                            break
                        }
                    }
                    done = true
                    sem.signal()
                }
                _ = sem.wait(timeout: .now() + 6)
                _ = done
            }
            call.resolve(result)
        }
    }

    // MARK: - lyrics

    @objc func getLyrics(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.resolve(["lyrics": NSNull()])
            return
        }
        DispatchQueue.global(qos: .utility).async {
            var result: [String: Any] = ["lyrics": NSNull()]
            let fileURL = URL(fileURLWithPath: path)
            let dir = fileURL.deletingLastPathComponent()
            let base = fileURL.deletingPathExtension().lastPathComponent.lowercased()
            let fm = FileManager.default
            if let entries = try? fm.contentsOfDirectory(atPath: dir.path) {
                for n in entries {
                    let ln = n.lowercased()
                    if ln == "\(base).lrc" || ln == "\(base).txt" {
                        let url = dir.appendingPathComponent(n)
                        if let data = try? Data(contentsOf: url) {
                            // 0x04CC = kCFStringEncodingWindowsCyrillic (windows-1251)
                            let win1251 = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(0x04CC))
                            let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: win1251) ?? ""
                            if !text.isEmpty { result["lyrics"] = text; break }
                        }
                    }
                }
            }
            call.resolve(result)
        }
    }
}
