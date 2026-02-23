import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-cpu";
import type { FeatureVectorNorm, FeatureVectorRaw } from "@shared/types";

export type StoredModelArtifacts = {
  modelTopology: unknown;
  weightSpecs: tf.io.WeightsManifestEntry[];
  weightDataBase64: string;
};

export type StoredModelMeta = {
  trainedAt: number;
};

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let backendReady: Promise<void> | null = null;
export async function ensureTfBackend(): Promise<void> {
  if (!backendReady) {
    backendReady = (async () => {
      await tf.setBackend("cpu");
      await tf.ready();
    })();
  }
  await backendReady;
}

export function createLogRegModel(inputDim: number): tf.LayersModel {
  const model = tf.sequential();
  model.add(
    tf.layers.dense({
      units: 1,
      activation: "sigmoid",
      useBias: true,
      inputShape: [inputDim]
    })
  );
  model.compile({
    optimizer: tf.train.adam(0.05),
    loss: "binaryCrossentropy",
    metrics: ["accuracy"]
  });
  return model;
}

export async function saveModelToArtifacts(model: tf.LayersModel): Promise<StoredModelArtifacts> {
  let saved: tf.io.ModelArtifacts | undefined;
  await model.save(
    tf.io.withSaveHandler(async (artifacts) => {
      saved = artifacts;
      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyType: "JSON",
          modelTopologyBytes: 0,
          weightSpecsBytes: 0,
          weightDataBytes: Array.isArray(artifacts.weightData)
            ? artifacts.weightData.reduce((n, b) => n + (b?.byteLength ?? 0), 0)
            : artifacts.weightData?.byteLength ?? 0
        }
      };
    })
  );
  if (!saved?.weightData || !saved.weightSpecs) {
    throw new Error("Model save did not produce weights.");
  }

  const weightData = Array.isArray(saved.weightData)
    ? (() => {
        const total = saved.weightData.reduce((n, b) => n + b.byteLength, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const b of saved.weightData) {
          merged.set(new Uint8Array(b), off);
          off += b.byteLength;
        }
        return merged.buffer;
      })()
    : saved.weightData;

  return {
    modelTopology: saved.modelTopology,
    weightSpecs: saved.weightSpecs,
    weightDataBase64: arrayBufferToBase64(weightData)
  };
}

export async function loadModelFromArtifacts(
  artifacts: StoredModelArtifacts,
  inputDim: number
): Promise<tf.LayersModel> {
  await ensureTfBackend();
  const handler = tf.io.fromMemory({
    modelTopology: artifacts.modelTopology,
    weightSpecs: artifacts.weightSpecs,
    weightData: base64ToArrayBuffer(artifacts.weightDataBase64)
  });
  const model = await tf.loadLayersModel(handler);
  // Safety: ensure shape matches expected dimension.
  const layer = model.layers[0];
  const kernel = layer?.getWeights()[0];
  if (!kernel || kernel.shape[0] !== inputDim) {
    // If dimension mismatched, fall back to fresh model.
    model.dispose();
    return createLogRegModel(inputDim);
  }
  model.compile({
    optimizer: tf.train.adam(0.05),
    loss: "binaryCrossentropy",
    metrics: ["accuracy"]
  });
  return model;
}

export type TrainSample = { x: number[]; y: 0 | 1; ts: number };

export async function predictRisk(model: tf.LayersModel, x: number[]): Promise<number> {
  await ensureTfBackend();
  return tf.tidy(() => {
    const input = tf.tensor2d([x], [1, x.length]);
    const out = model.predict(input) as tf.Tensor;
    const v = out.dataSync()[0] ?? 0;
    return Math.min(1, Math.max(0, v));
  });
}

export async function trainModel(
  model: tf.LayersModel,
  samples: TrainSample[],
  opts?: { epochs?: number; batchSize?: number }
): Promise<void> {
  await ensureTfBackend();
  const epochs = opts?.epochs ?? 20;
  const batchSize = opts?.batchSize ?? 16;
  const xs = tf.tensor2d(
    samples.map((s) => s.x),
    [samples.length, samples[0]?.x.length ?? 0]
  );
  const ys = tf.tensor2d(samples.map((s) => [s.y]), [samples.length, 1]);
  try {
    await model.fit(xs, ys, {
      epochs,
      batchSize,
      shuffle: true,
      verbose: 0
    });
  } finally {
    xs.dispose();
    ys.dispose();
  }
}

export function explainTopContributors(
  model: tf.LayersModel,
  fv: FeatureVectorNorm
): { name: keyof FeatureVectorRaw; contribution: number }[] {
  const layer = model.layers[0];
  if (!layer) return [];
  const [kernel, bias] = layer.getWeights();
  if (!kernel || !bias) return [];
  const w = kernel.arraySync() as number[][];
  const b = (bias.arraySync() as number[])[0] ?? 0;

  const contributions = fv.names.map((name, idx) => {
    const weight = w[idx]?.[0] ?? 0;
    const value = fv.values[idx] ?? 0;
    return { name, contribution: weight * value };
  });

  // Bias is not shown, but it exists.
  void b;
  return contributions.sort((a, b2) => Math.abs(b2.contribution) - Math.abs(a.contribution)).slice(0, 3);
}
