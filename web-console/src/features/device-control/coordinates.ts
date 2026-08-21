export type Point = { x: number; y: number }

/** Maps a pointer inside an object-contain viewport to Android display pixels. */
export function mapPointerToDevice(
  clientX: number,
  clientY: number,
  viewport: DOMRect,
  deviceWidth: number,
  deviceHeight: number,
): Point | null {
  if (deviceWidth <= 0 || deviceHeight <= 0 || viewport.width <= 0 || viewport.height <= 0) return null

  const scale = Math.min(viewport.width / deviceWidth, viewport.height / deviceHeight)
  const renderedWidth = deviceWidth * scale
  const renderedHeight = deviceHeight * scale
  const left = viewport.left + (viewport.width - renderedWidth) / 2
  const top = viewport.top + (viewport.height - renderedHeight) / 2
  const localX = clientX - left
  const localY = clientY - top
  if (localX < 0 || localY < 0 || localX > renderedWidth || localY > renderedHeight) return null

  return {
    x: Math.round(Math.min(deviceWidth - 1, Math.max(0, localX / scale))),
    y: Math.round(Math.min(deviceHeight - 1, Math.max(0, localY / scale))),
  }
}
