/**
 * YOLO v11 ONNX Detector
 * Handles model loading, preprocessing, inference, and postprocessing
 */
import * as ort from "onnxruntime-web";

// Class names matching the model output indices
const CLASS_NAMES = [
  "Anggur", "Apel", "Ayam Goreng", "Daging_sapi", "Ikan",
  "Jeruk", "Kelengkeng", "Kentang", "Kurma", "Leci",
  "Mangga", "Manggis", "Melon", "Mie", "Nasi",
  "Pisang", "Rambutan", "Roti", "Sayur", "Semangka",
  "Stroberi", "Susu", "Tahu", "Telur Goreng", "Telur Rebus",
  "Tempe", "Udang",
];

// Distinct colors for each class (HSL-based for visual appeal)
const CLASS_COLORS = [
  "#8b5cf6", "#ef4444", "#f59e0b", "#dc2626", "#06b6d4",
  "#f97316", "#84cc16", "#a78bfa", "#d97706", "#ec4899",
  "#14b8a6", "#7c3aed", "#22c55e", "#eab308", "#f1f5f9",
  "#fbbf24", "#e11d48", "#c084fc", "#10b981", "#22d3ee",
  "#fb7185", "#f0f9ff", "#fcd34d", "#6366f1", "#a3e635",
  "#f472b6", "#38bdf8",
];

const MODEL_INPUT_SIZE = 640;

export class Detector {
  constructor() {
    this.session = null;
    this.isLoading = false;
    this.confidenceThreshold = 0.5;
    // Reusable preprocessing canvas
    this._prepCanvas = document.createElement("canvas");
    this._prepCtx = this._prepCanvas.getContext("2d", { willReadFrequently: true });
  }

  /**
   * Load ONNX model with progress callback
   */
  async loadModel(modelPath, onProgress) {
    this.isLoading = true;

    try {
      if (onProgress) onProgress(10, "Mengkonfigurasi ONNX Runtime...");

      // Configure ONNX Runtime WASM backend
      ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.1/dist/";
      ort.env.wasm.numThreads = 1;

      if (onProgress) onProgress(20, "Mengunduh model AI...");

      // Fetch model with progress tracking
      const response = await fetch(modelPath);
      const contentLength = response.headers.get("content-length");
      const total = parseInt(contentLength, 10) || 0;
      let loaded = 0;

      const reader = response.body.getReader();
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (total > 0 && onProgress) {
          const pct = 20 + Math.round((loaded / total) * 50);
          const mb = (loaded / 1024 / 1024).toFixed(1);
          const totalMb = (total / 1024 / 1024).toFixed(1);
          onProgress(pct, `Mengunduh model... ${mb}/${totalMb} MB`);
        }
      }

      // Combine chunks into ArrayBuffer
      const modelBuffer = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        modelBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      if (onProgress) onProgress(75, "Memuat model ke memori...");

      // Create inference session (Try WebGL for GPU acceleration, fallback to WASM)
      this.session = await ort.InferenceSession.create(modelBuffer.buffer, {
        executionProviders: ["webgl", "wasm"],
        graphOptimizationLevel: "all",
      });

      if (onProgress) onProgress(95, "Model siap digunakan!");

      this.isLoading = false;
      return true;
    } catch (error) {
      this.isLoading = false;
      console.error("Failed to load model:", error);
      throw error;
    }
  }

  /**
   * Set confidence threshold
   */
  setConfidence(value) {
    this.confidenceThreshold = value;
  }

  /**
   * Preprocess image for model input
   * Resize to 640x640, normalize to [0,1], convert to NCHW format
   */
  preprocess(imageSource, sourceWidth, sourceHeight) {
    const sz = MODEL_INPUT_SIZE;
    const canvas = this._prepCanvas;
    const ctx = this._prepCtx;
    canvas.width = sz;
    canvas.height = sz;

    // Calculate letterbox dimensions
    const scale = Math.min(sz / sourceWidth, sz / sourceHeight);
    const newWidth = Math.round(sourceWidth * scale);
    const newHeight = Math.round(sourceHeight * scale);
    const offsetX = (sz - newWidth) / 2;
    const offsetY = (sz - newHeight) / 2;

    // Fill with gray + draw resized image
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, sz, sz);
    ctx.drawImage(imageSource, offsetX, offsetY, newWidth, newHeight);

    // Get pixel data and convert to NCHW Float32
    const pixels = ctx.getImageData(0, 0, sz, sz).data;
    const totalPixels = sz * sz;
    const float32Data = new Float32Array(3 * totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      const p = i * 4;
      float32Data[i] = pixels[p] / 255.0;
      float32Data[totalPixels + i] = pixels[p + 1] / 255.0;
      float32Data[2 * totalPixels + i] = pixels[p + 2] / 255.0;
    }

    return {
      tensor: new ort.Tensor("float32", float32Data, [1, 3, sz, sz]),
      scale,
      offsetX,
      offsetY,
    };
  }

  /**
   * Run inference and return detections
   */
  async detect(imageSource, sourceWidth, sourceHeight) {
    if (!this.session) throw new Error("Model not loaded");

    // Preprocess
    const { tensor, scale, offsetX, offsetY } = this.preprocess(
      imageSource, sourceWidth, sourceHeight
    );

    // Run inference
    const inputName = this.session.inputNames[0];
    const results = await this.session.run({ [inputName]: tensor });

    // Get output tensor - YOLOv11 output shape: [1, 31, 8400]
    // 31 = 4 (bbox: cx, cy, w, h) + 27 (class scores)
    const outputName = this.session.outputNames[0];
    const output = results[outputName];
    const outputData = output.data;

    // Parse detections
    const numDetections = output.dims[2]; // 8400
    const numClasses = CLASS_NAMES.length; // 27

    const detections = [];

    for (let i = 0; i < numDetections; i++) {
      // Find the class with highest score
      let maxScore = 0;
      let maxClassIdx = 0;

      for (let c = 0; c < numClasses; c++) {
        const score = outputData[(4 + c) * numDetections + i];
        if (score > maxScore) {
          maxScore = score;
          maxClassIdx = c;
        }
      }

      // Filter by confidence threshold
      if (maxScore < this.confidenceThreshold) continue;

      // Get bounding box (cx, cy, w, h) in model space (640x640)
      const cx = outputData[0 * numDetections + i];
      const cy = outputData[1 * numDetections + i];
      const w = outputData[2 * numDetections + i];
      const h = outputData[3 * numDetections + i];

      // Convert from model space to original image space
      const x1 = (cx - w / 2 - offsetX) / scale;
      const y1 = (cy - h / 2 - offsetY) / scale;
      const x2 = (cx + w / 2 - offsetX) / scale;
      const y2 = (cy + h / 2 - offsetY) / scale;

      detections.push({
        classId: maxClassIdx,
        className: CLASS_NAMES[maxClassIdx],
        confidence: maxScore,
        bbox: [
          Math.max(0, x1),
          Math.max(0, y1),
          Math.min(sourceWidth, x2),
          Math.min(sourceHeight, y2),
        ],
        color: CLASS_COLORS[maxClassIdx],
      });
    }

    // Apply Non-Maximum Suppression
    return this.nms(detections, 0.45);
  }

  /**
   * Non-Maximum Suppression
   */
  nms(detections, iouThreshold) {
    // Sort by confidence (descending)
    detections.sort((a, b) => b.confidence - a.confidence);

    const kept = [];

    while (detections.length > 0) {
      const best = detections.shift();
      kept.push(best);

      detections = detections.filter((det) => {
        if (det.classId !== best.classId) return true;
        return this.iou(best.bbox, det.bbox) < iouThreshold;
      });
    }

    return kept;
  }

  /**
   * Calculate Intersection over Union
   */
  iou(boxA, boxB) {
    const x1 = Math.max(boxA[0], boxB[0]);
    const y1 = Math.max(boxA[1], boxB[1]);
    const x2 = Math.min(boxA[2], boxB[2]);
    const y2 = Math.min(boxA[3], boxB[3]);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]);
    const areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]);

    return intersection / (areaA + areaB - intersection);
  }
}

export { CLASS_NAMES, CLASS_COLORS, MODEL_INPUT_SIZE };
