// td-call-audio: records the Mac's own sound (the other side of a Zoom / Meet / Teams call)
// for Teacher's Desk meeting notes. Bundled in the app as Contents/MacOS/td-call-audio and
// started by the app (desktop/src-tauri/src/call_audio.rs) while the teacher records.
//
//   td-call-audio <output.m4a>
//
// Protocol (one line each, on stdout):
//   READY            capture has started
//   SAVED            the file is complete (or no sound arrived: then there's no file)
//   ERROR <message>  something went wrong (exit code 1); the message is for the teacher
//
// It stops when stdin closes (the app closes it, quits or crashes) or on SIGTERM / SIGINT.
// Uses ScreenCaptureKit (macOS 13+): system audio of the main display, minus Teacher's Desk
// itself. macOS asks the teacher once, under Screen & System Audio Recording.
//
// Build: desktop/helpers/build-call-audio.sh (universal; CI runs it before `tauri build`).

import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

let appBundleID = "org.localschool.desktop"
let permissionMessage =
    "Allow Teacher's Desk under System Settings → Privacy & Security → Screen & System Audio Recording, then try again."

/// Unbuffered, one line at a time, so the app sees each line as soon as it's written.
func say(_ line: String) {
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

func fail(_ message: String) -> Never {
    say("ERROR \(message)")
    exit(1)
}

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    /// All recorder state is touched only on this queue (it also receives the samples).
    private let queue = DispatchQueue(label: "org.localschool.call-audio")
    private let url: URL
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var stream: SCStream?
    private var ready = false
    private var sessionStarted = false
    private var stopping = false

    init(url: URL) throws {
        self.url = url
        writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
        // Mono AAC is plenty for speech: about 29 MB an hour.
        input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw NSError(domain: "td-call-audio", code: 1) }
        writer.add(input)
    }

    var isReady: Bool { queue.sync { ready } }

    func start() async {
        // Fails when the teacher hasn't allowed screen & system audio recording.
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            fail(permissionMessage)
        }
        guard let display = content.displays.first else {
            fail("No display found to record the computer's sound from.")
        }
        // Everything this display plays, except Teacher's Desk itself.
        let ownApp = content.applications.filter { $0.bundleIdentifier == appBundleID }
        let filter = SCContentFilter(display: display, excludingApplications: ownApp, exceptingWindows: [])

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 1
        // ScreenCaptureKit always captures video too: make it as cheap as possible.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        do {
            // A screen output too (ignored), or ScreenCaptureKit logs every dropped frame.
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
            try await stream.startCapture()
        } catch {
            if (error as NSError).code == SCStreamError.Code.userDeclined.rawValue {
                fail(permissionMessage)
            }
            fail("Couldn't start recording the computer's sound (\(error.localizedDescription)).")
        }
        queue.sync {
            self.stream = stream
            if self.stopping {  // told to stop while starting
                stream.stopCapture { _ in self.queue.async { self.finish() } }
            } else {
                self.ready = true
                say("READY")
            }
        }
    }

    /// Stop capturing, finish the file, print SAVED and exit. Safe to call more than once.
    func requestStop() {
        queue.async {
            guard !self.stopping else { return }
            self.stopping = true
            guard let stream = self.stream else { return self.finish() }  // not started yet
            stream.stopCapture { _ in self.queue.async { self.finish() } }
        }
    }

    /// On `queue`. Ends the process.
    private func finish() {
        guard sessionStarted else {
            // No sound ever arrived: no file (the app reports "no sound was recorded").
            try? FileManager.default.removeItem(at: url)
            say("SAVED")
            exit(0)
        }
        input.markAsFinished()
        writer.finishWriting {
            if self.writer.status == .completed {
                say("SAVED")
                exit(0)
            }
            fail("Couldn't save the computer's sound (\(self.writer.error?.localizedDescription ?? "unknown error")).")
        }
    }

    // SCStreamOutput: called on `queue`.
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, !stopping, sampleBuffer.isValid, sampleBuffer.numSamples > 0 else { return }
        if !sessionStarted {
            guard writer.startWriting() else {
                fail("Couldn't write the computer's sound (\(writer.error?.localizedDescription ?? "unknown error")).")
            }
            writer.startSession(atSourceTime: sampleBuffer.presentationTimeStamp)
            sessionStarted = true
        }
        if input.isReadyForMoreMediaData {
            input.append(sampleBuffer)
        }
    }

    // SCStreamDelegate: capture ended on its own (permission revoked, display gone…). Keep
    // what was recorded; the app collects it when the teacher presses Stop.
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write(Data("capture stopped: \(error.localizedDescription)\n".utf8))
        queue.async {
            guard !self.stopping else { return }
            self.stopping = true
            self.finish()
        }
    }
}

@main
struct CallAudio {
    static var signalSources: [DispatchSourceSignal] = []

    static func main() {
        let args = CommandLine.arguments
        guard args.count == 2 else { fail("usage: td-call-audio <output.m4a>") }
        let url = URL(fileURLWithPath: args[1])
        try? FileManager.default.removeItem(at: url)

        let recorder: Recorder
        do {
            recorder = try Recorder(url: url)
        } catch {
            fail("Couldn't create the recording file (\(error.localizedDescription)).")
        }

        // Stop when stdin closes: the app closes it on Stop, and it closes by itself if the
        // app quits or crashes, so this helper never outlives Teacher's Desk.
        Thread {
            while readLine() != nil {}
            recorder.requestStop()
        }.start()

        // …or on SIGTERM / SIGINT.
        for sig in [SIGTERM, SIGINT] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { recorder.requestStop() }
            source.resume()
            signalSources.append(source)
        }

        // Never hang at startup (e.g. a permission prompt nobody answers).
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            if !recorder.isReady { fail("The computer's sound didn't start recording. " + permissionMessage) }
        }

        Task { await recorder.start() }
        dispatchMain()
    }
}
