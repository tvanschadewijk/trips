import AppKit
import AVFoundation
import CoreImage
import Foundation

let width = 1280
let height = 720
let frameRate = 30
let durationSeconds = 10.0
let totalFrames = Int(durationSeconds * Double(frameRate))

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceA = root.appendingPathComponent("public/brand/our-trips-earth-intro-v2.mp4")
let sourceB = root.appendingPathComponent("public/brand/our-trips-earth-intro.mp4")
let outputURL = root.appendingPathComponent("public/brand/our-trips-earth-intro-final.mp4")
let metadataURL = root.appendingPathComponent("public/brand/our-trips-earth-intro-final.json")

struct Pin {
    let startTime: Double
    let startPoint: CGPoint
    let endPoint: CGPoint
    let color: NSColor
}

let pins: [Pin] = [
    Pin(startTime: 1.0, startPoint: CGPoint(x: 760, y: 252), endPoint: CGPoint(x: 635, y: 196), color: NSColor(calibratedRed: 1.0, green: 0.90, blue: 0.72, alpha: 1.0)),
    Pin(startTime: 2.0, startPoint: CGPoint(x: 862, y: 414), endPoint: CGPoint(x: 740, y: 360), color: NSColor(calibratedRed: 1.0, green: 0.84, blue: 0.56, alpha: 1.0)),
    Pin(startTime: 3.0, startPoint: CGPoint(x: 694, y: 518), endPoint: CGPoint(x: 615, y: 492), color: NSColor(calibratedRed: 1.0, green: 0.93, blue: 0.78, alpha: 1.0)),
    Pin(startTime: 4.0, startPoint: CGPoint(x: 333, y: 622), endPoint: CGPoint(x: 96, y: 603), color: NSColor(calibratedRed: 1.0, green: 0.83, blue: 0.62, alpha: 1.0)),
    Pin(startTime: 5.0, startPoint: CGPoint(x: 150, y: 318), endPoint: CGPoint(x: 120, y: 348), color: NSColor(calibratedRed: 1.0, green: 0.91, blue: 0.74, alpha: 1.0)),
    Pin(startTime: 6.0, startPoint: CGPoint(x: 1076, y: 325), endPoint: CGPoint(x: 1048, y: 320), color: NSColor(calibratedRed: 1.0, green: 0.86, blue: 0.64, alpha: 1.0)),
]

func clamp(_ value: Double, min minValue: Double = 0.0, max maxValue: Double = 1.0) -> Double {
    Swift.max(minValue, Swift.min(maxValue, value))
}

func smoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
    let t = clamp((x - edge0) / (edge1 - edge0))
    return t * t * (3 - 2 * t)
}

func mix(_ a: CGFloat, _ b: CGFloat, _ t: Double) -> CGFloat {
    a + (b - a) * CGFloat(t)
}

func mixPoint(_ a: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
    CGPoint(x: mix(a.x, b.x, t), y: mix(a.y, b.y, t))
}

func cgImage(fromVideo url: URL, second: Double = 1.0) throws -> CGImage {
    let asset = AVURLAsset(url: url)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: width, height: height)
    let time = CMTime(seconds: second, preferredTimescale: 600)
    return try generator.copyCGImage(at: time, actualTime: nil)
}

func drawCover(image: CGImage, in context: CGContext, alpha: CGFloat, scale: CGFloat, xShift: CGFloat, yShift: CGFloat) {
    context.saveGState()
    context.setAlpha(alpha)
    let canvasSize = CGSize(width: width, height: height)
    let imageSize = CGSize(width: image.width, height: image.height)
    let baseScale = max(canvasSize.width / imageSize.width, canvasSize.height / imageSize.height)
    let finalScale = baseScale * scale
    let drawSize = CGSize(width: imageSize.width * finalScale, height: imageSize.height * finalScale)
    let origin = CGPoint(
        x: (canvasSize.width - drawSize.width) / 2 + xShift,
        y: (canvasSize.height - drawSize.height) / 2 + yShift
    )
    context.draw(image, in: CGRect(origin: origin, size: drawSize))
    context.restoreGState()
}

func drawPin(in context: CGContext, pin: Pin, time: Double, blend: Double) {
    guard time >= pin.startTime else { return }

    let point = mixPoint(pin.startPoint, pin.endPoint, blend)
    let appear = smoothstep(pin.startTime, pin.startTime + 0.45, time)
    let pulse = 0.5 + 0.5 * sin((time - pin.startTime) * 4.5)
    let glowRadius = 18 + 9 * pulse
    let ringRadius = 26 + 10 * pulse

    context.saveGState()
    context.setShadow(offset: .zero, blur: 18, color: pin.color.withAlphaComponent(0.55 * appear).cgColor)

    context.setFillColor(pin.color.withAlphaComponent(0.22 * appear).cgColor)
    context.fillEllipse(in: CGRect(x: point.x - glowRadius, y: point.y - glowRadius, width: glowRadius * 2, height: glowRadius * 2))

    context.setStrokeColor(pin.color.withAlphaComponent(0.4 * appear).cgColor)
    context.setLineWidth(2.0)
    context.strokeEllipse(in: CGRect(x: point.x - ringRadius, y: point.y - ringRadius, width: ringRadius * 2, height: ringRadius * 2))

    context.setFillColor(NSColor.white.withAlphaComponent(0.98 * appear).cgColor)
    context.fillEllipse(in: CGRect(x: point.x - 5, y: point.y - 5, width: 10, height: 10))

    context.restoreGState()
}

func drawTitle(in context: CGContext, time: Double) {
    let alpha = smoothstep(6.7, 7.8, time)
    guard alpha > 0 else { return }

    let shadow = NSShadow()
    shadow.shadowBlurRadius = 24
    shadow.shadowOffset = .zero
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.35 * alpha)

    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center

    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont(name: "Didot", size: 72) ?? NSFont.systemFont(ofSize: 72, weight: .semibold),
        .foregroundColor: NSColor(calibratedRed: 1.0, green: 0.96, blue: 0.87, alpha: alpha),
        .kern: 1.8,
        .paragraphStyle: paragraph,
        .shadow: shadow,
    ]

    let attributed = NSAttributedString(string: "OurTrips", attributes: attributes)
    let titleSize = NSSize(width: width, height: 110)
    let titleImage = NSImage(size: titleSize)

    titleImage.lockFocus()
    NSColor.clear.setFill()
    NSBezierPath(rect: NSRect(origin: .zero, size: titleSize)).fill()
    attributed.draw(with: NSRect(x: 0, y: 10, width: titleSize.width, height: titleSize.height - 20), options: [.usesLineFragmentOrigin, .usesFontLeading])
    titleImage.unlockFocus()

    guard let titleCGImage = titleImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return
    }

    context.saveGState()
    context.translateBy(x: CGFloat(width), y: 0)
    context.scaleBy(x: -1, y: 1)
    context.draw(titleCGImage, in: CGRect(x: 0, y: height - 150, width: width, height: 110))
    context.restoreGState()
}

func drawAtmosphere(in context: CGContext, time: Double) {
    let overlayAlpha = 0.08 + 0.03 * smoothstep(0.0, 1.0, time / durationSeconds)
    context.saveGState()
    context.setFillColor(NSColor(calibratedRed: 0.05, green: 0.09, blue: 0.16, alpha: overlayAlpha).cgColor)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.restoreGState()
}

func renderFrame(context: CGContext, imageA: CGImage, imageB: CGImage, time: Double) {
    context.setFillColor(NSColor.black.cgColor)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))

    let blend = smoothstep(1.4, 8.8, time)
    let baseScale = CGFloat(1.0 + 0.05 * (time / durationSeconds))
    let altScale = CGFloat(1.03 + 0.03 * (time / durationSeconds))

    drawCover(image: imageA, in: context, alpha: CGFloat(1.0 - blend * 0.35), scale: baseScale, xShift: 10, yShift: -6)
    drawCover(image: imageB, in: context, alpha: CGFloat(blend), scale: altScale, xShift: -24, yShift: 8)
    drawAtmosphere(in: context, time: time)

    for pin in pins {
        drawPin(in: context, pin: pin, time: time, blend: blend)
    }

    drawTitle(in: context, time: time)
}

func makePixelBuffer(from contextBlock: (CGContext) -> Void, pool: CVPixelBufferPool) throws -> CVPixelBuffer {
    var maybePixelBuffer: CVPixelBuffer?
    let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &maybePixelBuffer)
    guard status == kCVReturnSuccess, let pixelBuffer = maybePixelBuffer else {
        throw NSError(domain: "VideoWriter", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Unable to allocate pixel buffer."])
    }

    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }

    guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
        throw NSError(domain: "VideoWriter", code: -1, userInfo: [NSLocalizedDescriptionKey: "Missing pixel buffer base address."])
    }

    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    guard let context = CGContext(
        data: baseAddress,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
    ) else {
        throw NSError(domain: "VideoWriter", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unable to create drawing context."])
    }

    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    contextBlock(context)
    return pixelBuffer
}

try? FileManager.default.removeItem(at: outputURL)

let imageA = try cgImage(fromVideo: sourceA)
let imageB = try cgImage(fromVideo: sourceB)

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let videoSettings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 12_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
]

let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
input.expectsMediaDataInRealTime = false
input.transform = CGAffineTransform(translationX: CGFloat(width), y: CGFloat(height)).rotated(by: .pi)

let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32ARGB),
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
    ]
)

guard writer.canAdd(input) else {
    throw NSError(domain: "VideoWriter", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unable to add video input to asset writer."])
}

writer.add(input)

guard writer.startWriting() else {
    throw writer.error ?? NSError(domain: "VideoWriter", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unable to start writing."])
}

writer.startSession(atSourceTime: .zero)

guard let pool = adaptor.pixelBufferPool else {
    throw NSError(domain: "VideoWriter", code: -1, userInfo: [NSLocalizedDescriptionKey: "Missing pixel buffer pool."])
}

for frameIndex in 0..<totalFrames {
    while !input.isReadyForMoreMediaData {
        Thread.sleep(forTimeInterval: 0.01)
    }

    let time = Double(frameIndex) / Double(frameRate)
    let pixelBuffer = try makePixelBuffer(from: { context in
        renderFrame(context: context, imageA: imageA, imageB: imageB, time: time)
    }, pool: pool)

    let presentationTime = CMTime(value: CMTimeValue(frameIndex), timescale: CMTimeScale(frameRate))
    if !adaptor.append(pixelBuffer, withPresentationTime: presentationTime) {
        throw writer.error ?? NSError(domain: "VideoWriter", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unable to append frame \(frameIndex)."])
    }
}

input.markAsFinished()
writer.finishWriting {
    print("Finished writing video to \(outputURL.path)")
}

while writer.status == .writing {
    Thread.sleep(forTimeInterval: 0.05)
}

if writer.status != .completed {
    throw writer.error ?? NSError(domain: "VideoWriter", code: -1, userInfo: [NSLocalizedDescriptionKey: "Video writer did not complete successfully."])
}

let metadata: [String: Any] = [
    "created_at": ISO8601DateFormatter().string(from: Date()),
    "output_path": outputURL.path,
    "sources": [sourceA.lastPathComponent, sourceB.lastPathComponent],
    "duration_seconds": durationSeconds,
    "frame_rate": frameRate,
    "notes": "Visual-only composite built from xAI-generated Earth renders with locally composited pins and title. Audio was not added because the xAI video API returns silent video.",
]

let data = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
try data.write(to: metadataURL)

print("Saved metadata to \(metadataURL.path)")
