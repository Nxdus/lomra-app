export type ImageBounds = { x: number; y: number; width: number; height: number };
export type ImageCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export function resizeImage(image: ImageBounds, corner: ImageCorner, dx: number, dy: number): ImageBounds {
  const left = corner.endsWith("left");
  const top = corner.startsWith("top");
  // Project the pointer movement onto the image diagonal, keeping the opposite corner fixed.
  const scale = Math.max(
    Math.min(1, 24 / Math.min(image.width, image.height)),
    1 + ((left ? -dx : dx) * image.width + (top ? -dy : dy) * image.height) /
      (image.width ** 2 + image.height ** 2),
  );
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: left ? image.x + image.width - width : image.x,
    y: top ? image.y + image.height - height : image.y,
    width, height,
  };
}
