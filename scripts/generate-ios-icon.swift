// Render the existing white M / navy brand as an opaque App Store icon.
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import Foundation
let size = 1024
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(red: 20.0/255, green: 44.0/255, blue: 64.0/255, alpha: 1)
context.fill(CGRect(x:0, y:0, width:size, height:size))
let points: [(Double, Double)] = [(246,260),(246,764),(360,764),(512,530),(664,764),(778,764),(778,260),(654,260),(654,540),(512,328),(370,540),(370,260)]
context.move(to: CGPoint(x:points[0].0,y:points[0].1))
for p in points.dropFirst() { context.addLine(to: CGPoint(x:p.0,y:p.1)) }
context.closePath()
context.setFillColor(red:1,green:1,blue:1,alpha:1)
context.fillPath()
let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "apps/mobile/assets/icon.png"
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath:output) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
precondition(CGImageDestinationFinalize(destination))
print("Rendered opaque 1024×1024 MRBA icon")
