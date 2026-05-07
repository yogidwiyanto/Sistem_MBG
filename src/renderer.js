/**
 * Bounding box and label renderer
 * Draws detection results on a canvas overlay
 */

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  /**
   * Resize canvas to match source dimensions
   */
  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Clear the canvas
   */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Draw all detections
   */
  drawDetections(detections) {
    this.clear();

    for (const det of detections) {
      this.drawBox(det);
    }
  }

  /**
   * Draw a single detection box with label
   */
  drawBox(detection) {
    const { bbox, className, confidence, color } = detection;
    const [x1, y1, x2, y2] = bbox;
    const width = x2 - x1;
    const height = y2 - y1;

    const ctx = this.ctx;

    // Draw box outline
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeRect(x1, y1, width, height);

    // Draw semi-transparent fill
    ctx.fillStyle = color + "18";
    ctx.fillRect(x1, y1, width, height);

    // Draw corner accents
    const cornerLen = Math.min(20, width / 4, height / 4);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";

    // Top-left
    ctx.beginPath();
    ctx.moveTo(x1, y1 + cornerLen);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 + cornerLen, y1);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(x2 - cornerLen, y1);
    ctx.lineTo(x2, y1);
    ctx.lineTo(x2, y1 + cornerLen);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(x1, y2 - cornerLen);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x1 + cornerLen, y2);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(x2 - cornerLen, y2);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, y2 - cornerLen);
    ctx.stroke();

    // Draw label background
    const label = `${className} ${(confidence * 100).toFixed(0)}%`;
    ctx.font = "bold 13px Inter, sans-serif";
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;
    const textHeight = 18;
    const padding = 6;

    const labelX = x1;
    const labelY = y1 - textHeight - padding;
    const labelBgY = labelY < 0 ? y1 : labelY;

    // Rounded label background
    const bgX = labelX - 1;
    const bgY = labelBgY;
    const bgW = textWidth + padding * 2 + 2;
    const bgH = textHeight + padding;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgW, bgH, [4, 4, 4, 4]);
    ctx.fill();

    // Label text
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, bgX + padding, bgY + textHeight);
  }

  /**
   * Draw detections on a standalone canvas (for upload mode)
   */
  drawOnImage(canvas, image, detections) {
    const ctx = canvas.getContext("2d");

    // Calculate fit dimensions
    const containerWidth = canvas.parentElement.clientWidth;
    const containerHeight = canvas.parentElement.clientHeight;
    const scale = Math.min(containerWidth / image.width, containerHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const offsetX = (containerWidth - drawWidth) / 2;
    const offsetY = (containerHeight - drawHeight) / 2;

    canvas.width = containerWidth;
    canvas.height = containerHeight;

    // Draw image
    ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

    // Draw detections scaled to canvas
    for (const det of detections) {
      const [x1, y1, x2, y2] = det.bbox;
      const scaledBbox = [
        x1 * scale + offsetX,
        y1 * scale + offsetY,
        x2 * scale + offsetX,
        y2 * scale + offsetY,
      ];

      this.ctx = ctx;
      this.drawBox({ ...det, bbox: scaledBbox });
    }

    this.ctx = this.canvas.getContext("2d");
  }
}
