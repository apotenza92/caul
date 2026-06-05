import AVFoundation
import CoreAudio
import CoreGraphics
import CoreMedia
import FluidAudio
import Foundation
@preconcurrency import ScreenCaptureKit

let fallbackCaptureSampleRate = 48_000.0
let parakeetSampleRate = 16_000.0

@_cdecl("caulSystemAudioIOProc")
func caulSystemAudioIOProc(
  _ device: AudioObjectID,
  _ now: UnsafePointer<AudioTimeStamp>,
  _ inputData: UnsafePointer<AudioBufferList>,
  _ inputTime: UnsafePointer<AudioTimeStamp>,
  _ outputData: UnsafeMutablePointer<AudioBufferList>,
  _ outputTime: UnsafePointer<AudioTimeStamp>,
  _ clientData: UnsafeMutableRawPointer?
) -> OSStatus {
  guard let clientData else {
    return noErr
  }

  let capture = Unmanaged<SystemAudioCapture>.fromOpaque(clientData).takeUnretainedValue()
  capture.handleInputData(inputData)

  return noErr
}

struct HelperEvent: Encodable {
  let type: String
  var message: String?
  var ok: Bool?
  var macOSVersion: String?
  var coreAudioProcessTapAvailable: Bool?
  var screenCaptureKitAvailable: Bool?
  var tapID: UInt32?
  var aggregateDeviceID: UInt32?
  var sampleRate: Double?
  var inputSampleRate: Double?
  var channels: UInt32?
  var level: Double?
  var decibels: Double?
  var pcm16: String?
  var text: String?
  var status: Int32?
}

final class EventWriter: @unchecked Sendable {
  private let encoder = JSONEncoder()
  private let queue = DispatchQueue(label: "dev.caul.audio-helper.events")
  private var lastLevelEventAt = Date.distantPast

  func emit(_ event: HelperEvent) {
    queue.async {
      self.write(event)
    }
  }

  func emitImmediate(_ event: HelperEvent) {
    queue.sync {
      self.write(event)
    }
  }

  func emitLevel(_ event: HelperEvent) {
    queue.async {
      let now = Date()

      guard now.timeIntervalSince(self.lastLevelEventAt) >= 0.2 else {
        return
      }

      self.lastLevelEventAt = now

      guard let data = try? self.encoder.encode(event) else {
        return
      }

      FileHandle.standardOutput.write(data)
      FileHandle.standardOutput.write(Data([0x0a]))
    }
  }

  private func write(_ event: HelperEvent) {
    guard let data = try? encoder.encode(event) else {
      return
    }

    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
  }
}

enum HelperError: Error {
  case unsupportedOS
  case coreAudioStatus(String, OSStatus)
  case coreAudioTimeout(String)
  case missingDefaultOutputDevice
  case screenCapturePermissionDenied
  case screenCaptureUnavailable
  case unavailableFormat
}

final class ErrorBox: @unchecked Sendable {
  private let lock = NSLock()
  private var value: Error?

  func set(_ error: Error) {
    lock.lock()
    value = error
    lock.unlock()
  }

  func get() -> Error? {
    lock.lock()
    defer { lock.unlock() }
    return value
  }
}

struct DaemonCommand: Decodable {
  let type: String
}

final class ScreenCaptureKitSystemAudioCapture: NSObject, SCStreamDelegate, SCStreamOutput, @unchecked Sendable {
  private let writer: EventWriter
  private var stream: SCStream?
  private var inputSampleRate = 48_000.0
  private var emittedFormat = false

  init(writer: EventWriter) {
    self.writer = writer
    super.init()
  }

  @available(macOS 13.0, *)
  func start() async throws {
    writer.emitImmediate(HelperEvent(type: "capture_stage", message: "checking ScreenCaptureKit permission"))

    guard CGPreflightScreenCaptureAccess() else {
      throw HelperError.screenCapturePermissionDenied
    }

    writer.emitImmediate(HelperEvent(type: "capture_stage", message: "reading ScreenCaptureKit shareable content"))
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

    guard let display = content.displays.first else {
      throw HelperError.screenCaptureUnavailable
    }

    let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
    let configuration = SCStreamConfiguration()
    configuration.capturesAudio = true

    if #available(macOS 15.0, *) {
      configuration.captureMicrophone = false
    }

    configuration.excludesCurrentProcessAudio = false

    let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
    try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "dev.caul.audio-helper.sck"))
    self.stream = stream

    writer.emitImmediate(HelperEvent(type: "capture_stage", message: "starting ScreenCaptureKit audio stream"))
    try await stream.startCapture()
    writer.emit(HelperEvent(
      type: "capture_started",
      ok: true,
      sampleRate: inputSampleRate,
      channels: 1
    ))
  }

  @available(macOS 13.0, *)
  func stop() async {
    guard let stream else {
      return
    }

    try? await stream.stopCapture()
    self.stream = nil
    writer.emit(HelperEvent(type: "capture_stopped", ok: true))
  }

  @available(macOS 13.0, *)
  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
    guard outputType == .audio else {
      return
    }

    if let description = sampleBuffer.formatDescription?.audioStreamBasicDescription {
      inputSampleRate = description.mSampleRate

      if !emittedFormat {
        emittedFormat = true
        writer.emit(HelperEvent(
          type: "capture_stage",
          message: "ScreenCaptureKit format rate=\(description.mSampleRate) format=\(description.mFormatID) flags=\(description.mFormatFlags) bits=\(description.mBitsPerChannel) channels=\(description.mChannelsPerFrame) bytesPerFrame=\(description.mBytesPerFrame) samples=\(sampleBuffer.numSamples)"
        ))
      }
    }

    do {
      try sampleBuffer.withAudioBufferList { bufferList, _ in
        let monoSamples = readMonoFloatSamples(bufferList.unsafePointer)

        guard !monoSamples.isEmpty else {
          return
        }

        let level = calculateLevel(monoSamples)
        writer.emitLevel(HelperEvent(
          type: "system_level",
          level: level.percent,
          decibels: level.decibels
        ))

        let pcm16 = encodePCM16Base64(monoSamples)

        guard !pcm16.isEmpty else {
          return
        }

        writer.emit(HelperEvent(
          type: "audio_frame",
          sampleRate: inputSampleRate,
          inputSampleRate: inputSampleRate,
          channels: 1,
          pcm16: pcm16
        ))
      }
    } catch {
      writer.emit(HelperEvent(
        type: "capture_error",
        message: "ScreenCaptureKit audio processing failed: \(error)",
        ok: false
      ))
    }
  }

  @available(macOS 13.0, *)
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    writer.emit(HelperEvent(
      type: "capture_error",
      message: "ScreenCaptureKit stopped: \(error)",
      ok: false
    ))
  }
}

final class SystemAudioCapture {
  private let writer: EventWriter
  private let ioProcMode: String
  private let transcriber: SlidingParakeetTranscriber?
  private var processTapID = AudioObjectID(kAudioObjectUnknown)
  private var aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
  private var ioProcID: AudioDeviceIOProcID?
  private var inputFormat = AudioStreamBasicDescription()
  private let ioQueue = DispatchQueue(label: "dev.caul.audio-helper.io", qos: .userInitiated)
  private var started = false
  private var stopped = false

  var isStopped: Bool {
    stopped
  }

  init(writer: EventWriter, ioProcMode: String = "block", transcriber: SlidingParakeetTranscriber? = nil) {
    self.writer = writer
    self.ioProcMode = ioProcMode
    self.transcriber = transcriber
  }

  deinit {
    stop()
  }

  @available(macOS 14.2, *)
  func start(recording: Bool = true) throws {
    let tapDescription = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
    tapDescription.name = "Caul System Audio"
    tapDescription.uuid = UUID()
    tapDescription.isPrivate = true
    tapDescription.muteBehavior = .unmuted

    let tapUID = tapDescription.uuid.uuidString
    writer.emitImmediate(HelperEvent(type: "capture_stage", message: "reading default output device"))
    let defaultOutputUID = try readDefaultOutputDeviceUID()

    let aggregateDescription: [String: Any] = [
      String(kAudioAggregateDeviceNameKey): "Caul System Audio",
      String(kAudioAggregateDeviceUIDKey): "dev.caul.system-audio.\(UUID().uuidString)",
      String(kAudioAggregateDeviceMainSubDeviceKey): defaultOutputUID,
      String(kAudioAggregateDeviceIsPrivateKey): true,
      String(kAudioAggregateDeviceIsStackedKey): false,
      String(kAudioAggregateDeviceTapAutoStartKey): false,
      String(kAudioAggregateDeviceSubDeviceListKey): [
        [
          String(kAudioSubDeviceUIDKey): defaultOutputUID
        ]
      ],
      String(kAudioAggregateDeviceTapListKey): [
        [
          String(kAudioSubTapDriftCompensationKey): true,
          String(kAudioSubTapUIDKey): tapUID
        ]
      ]
    ]

    writer.emitImmediate(HelperEvent(type: "capture_stage", message: "creating Core Audio process tap"))
    try check(
      AudioHardwareCreateProcessTap(tapDescription, &processTapID),
      "AudioHardwareCreateProcessTap"
    )

    writer.emitImmediate(HelperEvent(type: "capture_stage", message: "creating private aggregate device"))
    try check(
      AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateDeviceID),
      "AudioHardwareCreateAggregateDevice"
    )

    writer.emitImmediate(HelperEvent(type: "capture_stage", message: "reading Core Audio tap format"))
    inputFormat = try readTapFormat(tapID: processTapID)
    writer.emitImmediate(HelperEvent(
      type: "capture_stage",
      message: "Core Audio tap format rate=\(inputFormat.mSampleRate) flags=\(inputFormat.mFormatFlags) bits=\(inputFormat.mBitsPerChannel) channels=\(inputFormat.mChannelsPerFrame) bytesPerFrame=\(inputFormat.mBytesPerFrame)"
    ))

    guard inputFormat.mFormatID == kAudioFormatLinearPCM,
          inputFormat.mBitsPerChannel == 32,
          inputFormat.mChannelsPerFrame > 0
    else {
      throw HelperError.unavailableFormat
    }

    if !recording {
      started = true
      writer.emit(HelperEvent(
        type: "tap_ready",
        ok: true,
        tapID: processTapID,
        aggregateDeviceID: aggregateDeviceID,
        inputSampleRate: inputFormat.mSampleRate,
        channels: inputFormat.mChannelsPerFrame
      ))
      return
    }

    try createAndStartIOProc()

    started = true
    writer.emit(HelperEvent(
      type: "capture_started",
      ok: true,
      tapID: processTapID,
      aggregateDeviceID: aggregateDeviceID,
      sampleRate: inputFormat.mSampleRate,
      inputSampleRate: inputFormat.mSampleRate,
      channels: 1
    ))
  }

  func stop() {
    guard !stopped else {
      return
    }

    stopped = true
    transcriber?.finish()

    if let ioProcID {
      _ = AudioDeviceStop(aggregateDeviceID, ioProcID)
      _ = AudioDeviceDestroyIOProcID(aggregateDeviceID, ioProcID)
      self.ioProcID = nil
    }

    if aggregateDeviceID != AudioObjectID(kAudioObjectUnknown) {
      _ = AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
      aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
    }

    if #available(macOS 14.2, *), processTapID != AudioObjectID(kAudioObjectUnknown) {
      _ = AudioHardwareDestroyProcessTap(processTapID)
      processTapID = AudioObjectID(kAudioObjectUnknown)
    }

    if started {
      writer.emit(HelperEvent(type: "capture_stopped", ok: true))
    }
  }

  func handleInputData(_ inputData: UnsafePointer<AudioBufferList>?) {
    guard let inputData, !stopped else {
      return
    }

    let monoSamples = readMonoFloatSamples(inputData, expectedChannels: inputFormat.mChannelsPerFrame)

    guard !monoSamples.isEmpty else {
      return
    }

    let level = calculateLevel(monoSamples)
    writer.emitLevel(HelperEvent(
      type: "system_level",
      level: level.percent,
      decibels: level.decibels
    ))

    if let transcriber {
      let parakeetSamples = resample(monoSamples, inputSampleRate: inputFormat.mSampleRate, outputSampleRate: parakeetSampleRate)
      transcriber.append(parakeetSamples)
      return
    }

    let pcm16 = encodePCM16Base64(monoSamples)

    guard !pcm16.isEmpty else {
      return
    }

    writer.emit(HelperEvent(
      type: "audio_frame",
      sampleRate: inputFormat.mSampleRate,
      inputSampleRate: inputFormat.mSampleRate,
      channels: 1,
      pcm16: pcm16
    ))
  }

  private func readMonoFloatSamples(_ inputData: UnsafePointer<AudioBufferList>, expectedChannels: UInt32) -> [Float] {
    let bufferList = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
    var samples: [Float] = []

    if bufferList.count == 1, let data = bufferList[0].mData {
      let buffer = bufferList[0]
      let channelCount = max(1, Int(expectedChannels), Int(buffer.mNumberChannels))
      let floatCount = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
      let frameCount = floatCount / channelCount
      let pointer = data.assumingMemoryBound(to: Float.self)
      samples.reserveCapacity(frameCount)

      for frameIndex in 0..<frameCount {
        var mixed: Float = 0
        for channelIndex in 0..<channelCount {
          mixed += pointer[(frameIndex * channelCount) + channelIndex]
        }
        samples.append(mixed / Float(channelCount))
      }
    } else if bufferList.count > 1 {
      let readableBuffers = bufferList.filter { $0.mData != nil && $0.mDataByteSize > 0 }
      let frameCount = readableBuffers
        .map { buffer in
          let channelCount = max(1, Int(buffer.mNumberChannels))
          return (Int(buffer.mDataByteSize) / MemoryLayout<Float>.size) / channelCount
        }
        .min() ?? 0

      samples.reserveCapacity(frameCount)

      for frameIndex in 0..<frameCount {
        var mixed: Float = 0

        for buffer in readableBuffers {
          let pointer = buffer.mData!.assumingMemoryBound(to: Float.self)
          let channelCount = max(1, Int(buffer.mNumberChannels))
          var bufferMixed: Float = 0

          for channelIndex in 0..<channelCount {
            bufferMixed += pointer[(frameIndex * channelCount) + channelIndex]
          }

          mixed += bufferMixed / Float(channelCount)
        }

        samples.append(mixed / Float(max(1, readableBuffers.count)))
      }
    }

    return samples
  }

  private func readTapFormat(tapID: AudioObjectID) throws -> AudioStreamBasicDescription {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioTapPropertyFormat,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var format = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    let status = AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &format)

    try check(status, "AudioObjectGetPropertyData(kAudioTapPropertyFormat)")

    return format
  }

  private func readDefaultOutputDeviceUID() throws -> String {
    var deviceAddress = AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var deviceID = AudioObjectID(kAudioObjectUnknown)
    var deviceSize = UInt32(MemoryLayout<AudioObjectID>.size)
    try check(
      AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &deviceAddress,
        0,
        nil,
        &deviceSize,
        &deviceID
      ),
      "AudioObjectGetPropertyData(kAudioHardwarePropertyDefaultSystemOutputDevice)"
    )

    guard deviceID != AudioObjectID(kAudioObjectUnknown) else {
      throw HelperError.missingDefaultOutputDevice
    }

    var uidAddress = AudioObjectPropertyAddress(
      mSelector: kAudioDevicePropertyDeviceUID,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var uid: CFString?
    var uidSize = UInt32(MemoryLayout<CFString?>.size)
    let status = withUnsafeMutablePointer(to: &uid) { uidPointer in
      AudioObjectGetPropertyData(deviceID, &uidAddress, 0, nil, &uidSize, uidPointer)
    }

    try check(status, "AudioObjectGetPropertyData(kAudioDevicePropertyDeviceUID)")

    guard let uid else {
      throw HelperError.missingDefaultOutputDevice
    }

    return uid as String
  }

  private func createAndStartIOProc() throws {
    var newIOProcID: AudioDeviceIOProcID?
    writer.emitImmediate(HelperEvent(type: "capture_stage", message: "creating aggregate device IO callback"))

    if ioProcMode == "function" {
      let clientData = Unmanaged.passUnretained(self).toOpaque()
      try check(
        AudioDeviceCreateIOProcID(aggregateDeviceID, caulSystemAudioIOProc, clientData, &newIOProcID),
        "AudioDeviceCreateIOProcID"
      )
    } else {
      try check(
        AudioDeviceCreateIOProcIDWithBlock(&newIOProcID, aggregateDeviceID, ioQueue) { [weak self] _, inputData, _, _, _ in
          self?.handleInputData(inputData)
        },
        "AudioDeviceCreateIOProcIDWithBlock"
      )
    }

    guard let newIOProcID else {
      throw HelperError.coreAudioStatus("AudioDeviceCreateIOProcID", -1)
    }

    writer.emitImmediate(HelperEvent(type: "capture_stage", message: "starting aggregate device"))
    try check(AudioDeviceStart(aggregateDeviceID, newIOProcID), "AudioDeviceStart")
    ioProcID = newIOProcID
  }

}

@available(macOS 14.2, *)
final class ParakeetDaemon: @unchecked Sendable {
  private let writer: EventWriter
  private let ioProcMode: String
  private let queue = DispatchQueue(label: "dev.caul.parakeet-daemon", qos: .userInitiated)
  private var capture: SystemAudioCapture?
  private var isQuitting = false

  init(writer: EventWriter, ioProcMode: String = "block") {
    self.writer = writer
    self.ioProcMode = ioProcMode
  }

  func start() {
    queue.async {
      guard !self.isQuitting else {
        return
      }

      guard self.capture == nil else {
        self.writer.emit(HelperEvent(type: "daemon_state", message: "listening", ok: true))
        return
      }

      let transcriber = SlidingParakeetTranscriber(writer: self.writer)
      let capture = SystemAudioCapture(
        writer: self.writer,
        ioProcMode: self.ioProcMode,
        transcriber: transcriber
      )

      do {
        try startCaptureWithTimeout(capture, writer: self.writer)
        transcriber.prepare()
        self.capture = capture
        self.writer.emit(HelperEvent(type: "capture_stage", message: "local Parakeet streaming started"))
        self.writer.emit(HelperEvent(type: "daemon_state", message: "listening", ok: true))
      } catch {
        capture.stop()
        emitError(error, writer: self.writer)
        self.writer.emit(HelperEvent(type: "daemon_state", message: "ready", ok: true))
      }
    }
  }

  func stop() {
    queue.async {
      self.stopCurrentCapture()
      self.prepareLocalParakeet()
    }
  }

  func quit() {
    queue.sync {
      self.isQuitting = true
      self.stopCurrentCapture()
      self.writer.emitImmediate(HelperEvent(type: "daemon_state", message: "stopped", ok: true))
    }
  }

  func run() {
    prepareLocalParakeet()

    let decoder = JSONDecoder()

    while let line = readLine() {
      guard let data = line.data(using: .utf8),
            let command = try? decoder.decode(DaemonCommand.self, from: data)
      else {
        writer.emit(HelperEvent(type: "capture_error", message: "Parakeet daemon received an unreadable command.", ok: false))
        continue
      }

      switch command.type {
      case "start":
        start()
      case "stop":
        stop()
      case "quit":
        quit()
        Thread.sleep(forTimeInterval: 0.1)
        exit(0)
      default:
        writer.emit(HelperEvent(type: "capture_error", message: "Parakeet daemon received an unknown command.", ok: false))
      }
    }

    quit()
  }

  private func stopCurrentCapture() {
    guard let capture else {
      writer.emit(HelperEvent(type: "daemon_state", message: "ready", ok: true))
      return
    }

    capture.stop()
    self.capture = nil
    writer.emit(HelperEvent(type: "daemon_state", message: "ready", ok: true))
  }

  private func prepareLocalParakeet() {
    writer.emit(HelperEvent(type: "daemon_state", message: "warming", ok: true))

    Task.detached(priority: .utility) { [writer] in
      await LocalSlidingParakeet.shared.prepareForAudio(writer: writer)
      writer.emit(HelperEvent(type: "daemon_state", message: "ready", ok: true))
    }
  }
}

final class SlidingParakeetTranscriber: @unchecked Sendable {
  private let writer: EventWriter
  private let queue = DispatchQueue(label: "dev.caul.parakeet", qos: .utility)
  private var buffer: [Float] = []
  private var isProcessing = false
  private var hasFinished = false
  private var finishCompletions: [() -> Void] = []
  private let processingChunkSampleCount = VadManager.chunkSize

  init(writer: EventWriter) {
    self.writer = writer
  }

  func prepare() {
    Task.detached(priority: .utility) { [writer] in
      await LocalSlidingParakeet.shared.prepareForAudio(writer: writer)
    }
  }

  func append(_ samples: [Float]) {
    guard !samples.isEmpty else {
      return
    }

    queue.async {
      guard !self.hasFinished else {
        return
      }

      self.buffer.append(contentsOf: samples)
      self.processIfReady(force: false)
    }
  }

  func finish() {
    let semaphore = DispatchSemaphore(value: 0)

    queue.async {
      self.hasFinished = true
      self.finishCompletions.append {
        semaphore.signal()
      }
      self.processIfReady(force: true)
    }

    _ = semaphore.wait(timeout: .now() + 15)
  }

  private func processIfReady(force: Bool) {
    guard !isProcessing else {
      return
    }

    let hasEnoughAudio = buffer.count >= processingChunkSampleCount
    guard hasEnoughAudio || (force && !buffer.isEmpty) || (force && hasFinished) else {
      return
    }

    isProcessing = true

    Task.detached(priority: .utility) { [weak self] in
      await self?.processBufferedAudio()
    }
  }

  private func processBufferedAudio() async {
    while true {
      let chunk: [Float]? = queue.sync {
        if self.buffer.count >= self.processingChunkSampleCount {
          let chunk = Array(self.buffer.prefix(self.processingChunkSampleCount))
          self.buffer.removeFirst(self.processingChunkSampleCount)
          return chunk
        }

        if self.hasFinished && !self.buffer.isEmpty {
          let chunk = self.buffer
          self.buffer.removeAll(keepingCapacity: false)
          return chunk
        }

        return nil
      }

      guard let chunk else {
        break
      }

      await LocalSlidingParakeet.shared.append(samples: chunk, writer: writer)
    }

    let shouldFinish = queue.sync {
      self.hasFinished && self.buffer.isEmpty
    }

    if shouldFinish {
      await LocalSlidingParakeet.shared.finish(writer: writer)
    }

    queue.async {
      self.isProcessing = false

      if shouldFinish {
        let completions = self.finishCompletions
        self.finishCompletions.removeAll()
        completions.forEach { completion in
          completion()
        }
      } else {
        self.processIfReady(force: self.hasFinished)
      }
    }
  }
}

actor LocalSlidingParakeet {
  static let shared = LocalSlidingParakeet()

  private var manager: SlidingWindowAsrManager?
  private var models: AsrModels?
  private var preparationTask: Task<(AsrModels, SlidingWindowAsrManager), Error>?
  private var updateTask: Task<Void, Never>?
  private var emittedText = Set<String>()
  private var emittedTextParts: [String] = []
  private var hasStarted = false

  func append(samples: [Float], writer: EventWriter) async {
    guard !samples.isEmpty else {
      return
    }

    do {
      try await prepare(writer: writer)
      try await stream(samples)
    } catch {
      writer.emit(HelperEvent(
        type: "capture_error",
        message: "Local Parakeet transcription failed: \(error)",
        ok: false
      ))
    }
  }

  func prepareForAudio(writer: EventWriter) async {
    do {
      try await prepare(writer: writer)
    } catch {
      writer.emit(HelperEvent(
        type: "capture_error",
        message: "Local Parakeet preparation failed: \(error)",
        ok: false
      ))
    }
  }

  func warmModels(writer: EventWriter) async {
    do {
      writer.emit(HelperEvent(type: "capture_stage", message: "loading local Parakeet"))
      _ = try await loadedModels()
      writer.emit(HelperEvent(type: "capture_stage", message: "local Parakeet warmed"))
    } catch {
      writer.emit(HelperEvent(
        type: "capture_error",
        message: "Local Parakeet warm-up failed: \(error)",
        ok: false
      ))
    }
  }

  func finish(writer: EventWriter) async {
    if let manager {
      do {
        let finalText = try await manager.finish()
          .trimmingCharacters(in: .whitespacesAndNewlines)
        emitFinalText(finalText, writer: writer)
      } catch {
        writer.emit(HelperEvent(
          type: "capture_error",
          message: "Local Parakeet finish failed: \(error)",
          ok: false
        ))
      }
    }

    updateTask?.cancel()
    updateTask = nil
    manager = nil
    emittedText.removeAll()
    emittedTextParts.removeAll()
    hasStarted = false
  }

  private func prepare(writer: EventWriter) async throws {
    guard manager == nil else {
      return
    }

    let task: Task<(AsrModels, SlidingWindowAsrManager), Error>

    if let preparationTask {
      task = preparationTask
    } else {
      writer.emit(HelperEvent(type: "capture_stage", message: "loading local Parakeet"))
      task = Task {
        let models = try await AsrModels.downloadAndLoad(version: .v3)
        let manager = SlidingWindowAsrManager(config: .streaming)
        try await manager.loadModels(models)
        try await manager.startStreaming(source: .system)
        return (models, manager)
      }
      preparationTask = task
    }

    do {
      let (models, preparedManager) = try await task.value
      self.models = models

      if manager == nil {
        manager = preparedManager
      }

      if !hasStarted {
        hasStarted = true
        writer.emit(HelperEvent(type: "capture_stage", message: "local Parakeet streaming started"))
        startUpdateTask(manager: preparedManager, writer: writer)
      }

      preparationTask = nil
    } catch {
      preparationTask = nil
      throw error
    }
  }

  private func loadedModels() async throws -> AsrModels {
    if let models {
      return models
    }

    let loadedModels = try await AsrModels.downloadAndLoad(version: .v3)
    models = loadedModels
    return loadedModels
  }

  private func startUpdateTask(manager: SlidingWindowAsrManager, writer: EventWriter) {
    updateTask?.cancel()
    updateTask = Task { [weak writer] in
      guard let writer else {
        return
      }

      for await update in await manager.transcriptionUpdates {
        guard !Task.isCancelled else {
          return
        }

        if update.isConfirmed {
          await LocalSlidingParakeet.shared.emitCompletedText(update.text, writer: writer)
        }
      }
    }
  }

  private func stream(_ samples: [Float]) async throws {
    guard let manager, let audioBuffer = makeAudioBuffer(samples: samples) else {
      return
    }

    nonisolated(unsafe) let buffer = audioBuffer
    await manager.streamAudio(buffer)
  }

  private func makeAudioBuffer(samples: [Float]) -> AVAudioPCMBuffer? {
    guard let format = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: parakeetSampleRate,
      channels: 1,
      interleaved: false
    ) else {
      return nil
    }

    guard let buffer = AVAudioPCMBuffer(
      pcmFormat: format,
      frameCapacity: AVAudioFrameCount(samples.count)
    ) else {
      return nil
    }

    buffer.frameLength = AVAudioFrameCount(samples.count)

    guard let channel = buffer.floatChannelData?[0] else {
      return nil
    }

    samples.withUnsafeBufferPointer { source in
      if let baseAddress = source.baseAddress {
        channel.update(from: baseAddress, count: samples.count)
      }
    }

    return buffer
  }

  func emitCompletedText(_ text: String, writer: EventWriter) {
    let transcript = text.trimmingCharacters(in: .whitespacesAndNewlines)

    guard !transcript.isEmpty, !emittedText.contains(transcript) else {
      return
    }

    emittedText.insert(transcript)
    emittedTextParts.append(transcript)
    writer.emit(HelperEvent(type: "transcription_completed", ok: true, text: transcript))
  }

  private func emitFinalText(_ text: String, writer: EventWriter) {
    let transcript = text.trimmingCharacters(in: .whitespacesAndNewlines)

    guard !transcript.isEmpty else {
      return
    }

    if emittedTextParts.isEmpty {
      emitCompletedText(transcript, writer: writer)
      return
    }

    let alreadyEmitted = emittedTextParts.joined(separator: " ")

    if transcript == alreadyEmitted || transcript.hasPrefix(alreadyEmitted) {
      let suffix = transcript
        .dropFirst(alreadyEmitted.count)
        .trimmingCharacters(in: .whitespacesAndNewlines)
      emitCompletedText(suffix, writer: writer)
    }
  }
}

func readMonoFloatSamples(_ inputData: UnsafePointer<AudioBufferList>) -> [Float] {
  let bufferList = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
  var samples: [Float] = []

  if bufferList.count == 1, let data = bufferList[0].mData {
    let buffer = bufferList[0]
    let channelCount = max(1, Int(buffer.mNumberChannels))
    let floatCount = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
    let frameCount = floatCount / channelCount
    let pointer = data.assumingMemoryBound(to: Float.self)
    samples.reserveCapacity(frameCount)

    for frameIndex in 0..<frameCount {
      var mixed: Float = 0
      for channelIndex in 0..<channelCount {
        mixed += pointer[(frameIndex * channelCount) + channelIndex]
      }
      samples.append(mixed / Float(channelCount))
    }
  } else if bufferList.count > 1 {
    let readableBuffers = bufferList.filter { $0.mData != nil && $0.mDataByteSize > 0 }
    let frameCount = readableBuffers
      .map { buffer in
        let channelCount = max(1, Int(buffer.mNumberChannels))
        return (Int(buffer.mDataByteSize) / MemoryLayout<Float>.size) / channelCount
      }
      .min() ?? 0

    samples.reserveCapacity(frameCount)

    for frameIndex in 0..<frameCount {
      var mixed: Float = 0

      for buffer in readableBuffers {
        let pointer = buffer.mData!.assumingMemoryBound(to: Float.self)
        let channelCount = max(1, Int(buffer.mNumberChannels))
        var bufferMixed: Float = 0

        for channelIndex in 0..<channelCount {
          bufferMixed += pointer[(frameIndex * channelCount) + channelIndex]
        }

        mixed += bufferMixed / Float(channelCount)
      }

      samples.append(mixed / Float(max(1, readableBuffers.count)))
    }
  }

  return samples
}

func check(_ status: OSStatus, _ operation: String) throws {
  guard status == noErr else {
    throw HelperError.coreAudioStatus(operation, status)
  }
}

func calculateLevel(_ samples: [Float]) -> (percent: Double, decibels: Double) {
  let sumSquares = samples.reduce(0.0) { partial, sample in
    partial + Double(sample * sample)
  }
  let rms = sqrt(sumSquares / Double(max(1, samples.count)))
  let decibels = 20.0 * log10(max(rms, 0.000_001))
  let percent = min(100.0, max(0.0, ((decibels + 60.0) / 60.0) * 100.0))

  return (percent, decibels)
}

func resample(_ samples: [Float], inputSampleRate: Double, outputSampleRate: Double) -> [Float] {
  guard !samples.isEmpty, inputSampleRate > 0, outputSampleRate > 0 else {
    return []
  }

  if abs(inputSampleRate - outputSampleRate) < 1.0 {
    return samples
  }

  let ratio = inputSampleRate / outputSampleRate
  let outputCount = Int(Double(samples.count) / ratio)

  guard outputCount > 0 else {
    return []
  }

  var output = [Float]()
  output.reserveCapacity(outputCount)

  for outputIndex in 0..<outputCount {
    let inputPosition = Double(outputIndex) * ratio
    let lowerIndex = Int(inputPosition)
    let upperIndex = min(lowerIndex + 1, samples.count - 1)
    let fraction = Float(inputPosition - Double(lowerIndex))
    let sample = samples[lowerIndex] + ((samples[upperIndex] - samples[lowerIndex]) * fraction)
    output.append(sample)
  }

  return output
}

func encodePCM16Base64(_ samples: [Float]) -> String {
  guard !samples.isEmpty else {
    return ""
  }

  var data = Data(capacity: samples.count * MemoryLayout<Int16>.size)

  for sample in samples {
    let clamped = max(-1.0, min(1.0, sample))
    var value = Int16(clamped < 0 ? clamped * 32768.0 : clamped * 32767.0).littleEndian
    withUnsafeBytes(of: &value) { bytes in
      data.append(contentsOf: bytes)
    }
  }

  return data.base64EncodedString()
}

func capabilities(writer: EventWriter) {
  let operatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion
  let version = "\(operatingSystemVersion.majorVersion).\(operatingSystemVersion.minorVersion).\(operatingSystemVersion.patchVersion)"
  let available: Bool

  if #available(macOS 14.2, *) {
    available = true
  } else {
    available = false
  }

  writer.emit(HelperEvent(
    type: "capabilities",
    ok: true,
    macOSVersion: version,
    coreAudioProcessTapAvailable: available,
    screenCaptureKitAvailable: true,
    sampleRate: fallbackCaptureSampleRate
  ))
}

func screenCapturePermissionStatus(writer: EventWriter) {
  let granted = CGPreflightScreenCaptureAccess()

  writer.emitImmediate(HelperEvent(
    type: "screen_capture_permission",
    message: granted ? "granted" : "not-granted",
    ok: granted,
    text: granted ? "granted" : "not-granted"
  ))
}

func requestScreenCapturePermission(writer: EventWriter) {
  let granted = CGRequestScreenCaptureAccess()

  writer.emitImmediate(HelperEvent(
    type: "screen_capture_permission",
    message: granted ? "granted" : "not-granted",
    ok: granted,
    text: granted ? "granted" : "not-granted"
  ))
}

@available(macOS 14.2, *)
func tapSmoke(writer: EventWriter) throws {
  let capture = SystemAudioCapture(writer: writer, ioProcMode: argumentValue(after: "--io-proc") ?? "block")
  try startCaptureWithTimeout(capture, recording: false, writer: writer)
  Thread.sleep(forTimeInterval: 0.5)
  capture.stop()
}

@available(macOS 14.2, *)
func startCaptureWithTimeout(
  _ capture: SystemAudioCapture,
  recording: Bool = true,
  writer: EventWriter,
  timeout: TimeInterval = 4
) throws {
  let semaphore = DispatchSemaphore(value: 0)
  let resultLock = NSLock()
  var result: Result<Void, Error>?

  DispatchQueue.global(qos: .userInitiated).async {
    let captureResult: Result<Void, Error>

    do {
      try capture.start(recording: recording)
      captureResult = .success(())
    } catch {
      captureResult = .failure(error)
    }

    resultLock.lock()
    result = captureResult
    resultLock.unlock()
    semaphore.signal()
  }

  if semaphore.wait(timeout: .now() + timeout) == .timedOut {
    writer.emitImmediate(HelperEvent(
      type: "permission_error",
      message: "Core Audio did not return while starting system audio capture. Restart coreaudiod or grant System Audio Recording permission to the responsible app, then retry.",
      ok: false
    ))
    Thread.sleep(forTimeInterval: 0.1)
    exit(1)
  }

  resultLock.lock()
  let startResult = result
  resultLock.unlock()

  try startResult?.get()
}

@available(macOS 14.2, *)
func runModernCommand(arguments: Set<String>, writer: EventWriter) throws {
  if arguments.contains("--stream-screencapturekit-audio") {
    let duration = argumentValue(after: "--duration").flatMap(TimeInterval.init)
    let capture = ScreenCaptureKitSystemAudioCapture(writer: writer)
    let semaphore = DispatchSemaphore(value: 0)
    let startError = ErrorBox()

    Task {
      do {
        try await capture.start()
      } catch {
        startError.set(error)
      }

      semaphore.signal()
    }

    if semaphore.wait(timeout: .now() + 8) == .timedOut {
      writer.emitImmediate(HelperEvent(
        type: "permission_error",
        message: "ScreenCaptureKit did not return while starting system audio capture.",
        ok: false
      ))
      Thread.sleep(forTimeInterval: 0.1)
      exit(1)
    }

    if let startError = startError.get() {
      throw startError
    }

    if let duration {
      Thread.sleep(forTimeInterval: duration)
      let stopSemaphore = DispatchSemaphore(value: 0)
      Task {
        await capture.stop()
        stopSemaphore.signal()
      }
      _ = stopSemaphore.wait(timeout: .now() + 2)
      Thread.sleep(forTimeInterval: 0.1)
      exit(0)
    }

    RunLoop.current.run()
  }

  if arguments.contains("--tap-smoke") {
    try tapSmoke(writer: writer)
    Thread.sleep(forTimeInterval: 0.1)
    exit(0)
  }

  if arguments.contains("--warm-parakeet") {
    let semaphore = DispatchSemaphore(value: 0)

    Task {
      await LocalSlidingParakeet.shared.warmModels(writer: writer)
      semaphore.signal()
    }

    _ = semaphore.wait(timeout: .now() + 60)
    Thread.sleep(forTimeInterval: 0.1)
    exit(0)
  }

  if arguments.contains("--parakeet-daemon") {
    let daemon = ParakeetDaemon(
      writer: writer,
      ioProcMode: argumentValue(after: "--io-proc") ?? "block"
    )
    daemon.run()
    Thread.sleep(forTimeInterval: 0.1)
    exit(0)
  }

  if arguments.contains("--stream-system-audio") {
    let duration = argumentValue(after: "--duration").flatMap(TimeInterval.init)
    let transcriber = arguments.contains("--transcribe-parakeet") ? SlidingParakeetTranscriber(writer: writer) : nil
    let capture = SystemAudioCapture(
      writer: writer,
      ioProcMode: argumentValue(after: "--io-proc") ?? "block",
      transcriber: transcriber
    )
    try startCaptureWithTimeout(capture, writer: writer)
    transcriber?.prepare()

    if let duration {
      Thread.sleep(forTimeInterval: duration)
      capture.stop()
      Thread.sleep(forTimeInterval: 0.1)
      exit(0)
    }

    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)

    let signalQueue = DispatchQueue(label: "dev.caul.audio-helper.signals")
    let interruptSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: signalQueue)
    let terminateSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: signalQueue)

    let stopAndExit = {
      capture.stop()
      Thread.sleep(forTimeInterval: 0.1)
      exit(0)
    }

    interruptSource.setEventHandler(handler: stopAndExit)
    terminateSource.setEventHandler(handler: stopAndExit)
    interruptSource.resume()
    terminateSource.resume()

    RunLoop.current.run()
  }
}

func emitError(_ error: Error, writer: EventWriter) {
  if case let HelperError.coreAudioStatus(operation, status) = error {
    writer.emit(HelperEvent(
      type: "capture_error",
      message: "\(operation) failed with OSStatus \(status)",
      ok: false,
      status: status
    ))
    return
  }

  if case let HelperError.coreAudioTimeout(message) = error {
    writer.emit(HelperEvent(
      type: "permission_error",
      message: message,
      ok: false
    ))
    return
  }

  if case HelperError.unavailableFormat = error {
    writer.emit(HelperEvent(
      type: "capture_error",
      message: "The Core Audio tap did not expose 32-bit linear PCM.",
      ok: false
    ))
    return
  }

  if case HelperError.missingDefaultOutputDevice = error {
    writer.emit(HelperEvent(
      type: "capture_error",
      message: "macOS did not return a default system output device.",
      ok: false
    ))
    return
  }

  if case HelperError.screenCapturePermissionDenied = error {
    writer.emit(HelperEvent(
      type: "permission_error",
      message: "Screen Recording permission is required for the ScreenCaptureKit audio probe.",
      ok: false
    ))
    return
  }

  if case HelperError.screenCaptureUnavailable = error {
    writer.emit(HelperEvent(
      type: "capture_error",
      message: "ScreenCaptureKit did not return a display to capture.",
      ok: false
    ))
    return
  }

  writer.emit(HelperEvent(
    type: "capture_error",
    message: String(describing: error),
    ok: false
  ))
}

func argumentValue(after flag: String) -> String? {
  let arguments = CommandLine.arguments

  guard let index = arguments.firstIndex(of: flag),
        arguments.indices.contains(index + 1)
  else {
    return nil
  }

  return arguments[index + 1]
}

let writer = EventWriter()
let arguments = Set(CommandLine.arguments.dropFirst())

if arguments.contains("--capabilities") {
  capabilities(writer: writer)
  Thread.sleep(forTimeInterval: 0.1)
  exit(0)
}

if arguments.contains("--screen-capture-permission-status") {
  screenCapturePermissionStatus(writer: writer)
  Thread.sleep(forTimeInterval: 0.1)
  exit(0)
}

if arguments.contains("--request-screen-capture-permission") {
  requestScreenCapturePermission(writer: writer)
  Thread.sleep(forTimeInterval: 0.1)
  exit(0)
}

guard #available(macOS 14.2, *) else {
  emitError(HelperError.unsupportedOS, writer: writer)
  Thread.sleep(forTimeInterval: 0.1)
  exit(1)
}

do {
  if #available(macOS 14.2, *) {
    try runModernCommand(arguments: arguments, writer: writer)
  }

  writer.emit(HelperEvent(
    type: "usage",
    message: "Use --capabilities, --tap-smoke or --stream-system-audio.",
    ok: false
  ))
  Thread.sleep(forTimeInterval: 0.1)
  exit(2)
} catch {
  emitError(error, writer: writer)
  Thread.sleep(forTimeInterval: 0.1)
  exit(1)
}
