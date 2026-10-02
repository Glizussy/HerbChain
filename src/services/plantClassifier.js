import { Platform } from 'react-native';
import * as ImageManipulator from "expo-image-manipulator";
import jpeg from "jpeg-js";
import { Asset } from "expo-asset";

let loadTensorflowModel = null;
if (Platform.OS !== 'web') {
  try {
    loadTensorflowModel = require('react-native-fast-tflite').loadTensorflowModel;
  } catch (e) {
    console.warn('react-native-fast-tflite not available:', e);
  }
}

// ============================================================
// Class order MUST match train_dataset.class_names from Colab
// ============================================================

const CLASS_NAMES = [
  "Azadirachta_indica",
  "Hibiscus_rosa_sinensis",
  "Murraya_koenigii",
  "Ocimum_tenuiflorum",
  "Piper_betle",
];

let model = null;

// ============================================================
// Load TFLite model
//
// We CANNOT pass require() directly to loadTensorflowModel in
// dev mode because Image.resolveAssetSource() returns an HTTP
// Metro URL (e.g. http://192.168.x.x:8081/assets/...) that
// the native createModel() cannot fetch.
//
// expo-asset.downloadAsync() copies the bundled asset to local
// device storage, giving us a file:// URI that the native
// module can open on both Android and iOS.
// ============================================================

export async function loadPlantModel() {
  try {
    if (model) {
      return model;
    }

    console.log("Loading TFLite model...");

    const asset = Asset.fromModule(
      require("../../assets/ml/BestModel.tflite")
    );
    await asset.downloadAsync();

    const localUri = asset.localUri;
    console.log("Local model URI:", localUri);

    if (!localUri) {
      throw new Error(
        "expo-asset did not return a localUri for BestModel.tflite. " +
          "Make sure 'tflite' is in metro.config.js assetExts."
      );
    }

    // Pass an explicit empty array for delegates so the native
    // createModel() receives [] (CPU default) instead of undefined.
    // Passing undefined crashes the C++ delegate iterator.
    model = await loadTensorflowModel({ url: localUri }, []);

    console.log("Plant model loaded successfully.");

    return model;
  } catch (error) {
    console.error("Error loading plant model:", error.message);
    throw error;
  }
}
// ============================================================
// Convert image → 224 × 224 RGB Float32 tensor
// ============================================================

async function prepareImage(imageUri) {
  // Resize image to exactly 224 × 224
  const manipulatedImage =
    await ImageManipulator.manipulateAsync(
      imageUri,
      [
        {
          resize: {
            width: 224,
            height: 224,
          },
        },
      ],
      {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      }
    );

  // Decode base64 string → raw bytes before passing to jpeg-js.
  // jpeg-js.decode() expects a Buffer / Uint8Array, NOT a raw
  // base64 string. Without this step it throws or returns
  // garbage data.
  const base64String = manipulatedImage.base64;
  const binaryString = atob(base64String);
  const byteArray = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    byteArray[i] = binaryString.charCodeAt(i);
  }

  // jpeg-js.decode() requires the raw ArrayBuffer, NOT the
  // Uint8Array wrapper. Pass .buffer to extract the underlying bytes.
  const jpegData = jpeg.decode(byteArray.buffer, { useTArray: true });

  const { data, width, height } = jpegData;

  if (width !== 224 || height !== 224) {
    throw new Error(
      `Unexpected image size: ${width} × ${height}`
    );
  }

  // Model expects:
  // [1, 224, 224, 3]
  //
  // It expects float32.
  //
  // IMPORTANT:
  // We do NOT divide by 255 or apply DenseNet
  // preprocess_input here because your Keras model
  // already contains preprocessing layers.

  const input = new Float32Array(
    1 * 224 * 224 * 3
  );

  let inputIndex = 0;

  for (let i = 0; i < data.length; i += 4) {
    // JPEG decoder gives RGBA
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    input[inputIndex++] = r;
    input[inputIndex++] = g;
    input[inputIndex++] = b;
  }

  return input;
}

// ============================================================
// Get Top 3 predictions
// ============================================================

function getTopPredictions(probabilities) {
  const predictions = CLASS_NAMES.map(
    (plant, index) => ({
      plant,
      confidence: probabilities[index],
    })
  );

  predictions.sort(
    (a, b) => b.confidence - a.confidence
  );

  return predictions;
}

// ============================================================
// Classify plant
// ============================================================

export async function classifyPlant(imageUri) {
  if (Platform.OS === 'web' || !loadTensorflowModel) {
    throw new Error("Plant identification is unavailable on this platform. This harvest requires manual review.");
  }

  try {
    const plantModel = await loadPlantModel();

    const inputTensor = await prepareImage(imageUri);

    console.log("Running plant classification...");

    // plantModel.run() expects ArrayBuffer[], not TypedArray[].
    // Pass inputTensor.buffer (the underlying ArrayBuffer of the Float32Array).
    const outputs = await plantModel.run([inputTensor.buffer]);

    const rawBuffer = outputs[0];
    const byteLen = rawBuffer.byteLength;

    let probabilities;
    if (byteLen === CLASS_NAMES.length) {
      // uint8 / quantized model — 1 byte per class, scale to 0-1
      probabilities = Array.from(new Uint8Array(rawBuffer)).map((v) => v / 255);
    } else {
      // float32 model — 4 bytes per class (default, non-quantized)
      probabilities = new Float32Array(rawBuffer);
    }

    const predictions = getTopPredictions(probabilities);

    const result = {
      plant: predictions[0].plant,
      confidence: predictions[0].confidence,
      top3: predictions.slice(0, 3),
    };

    console.log("Plant prediction:", result);

    return result;

  } catch (error) {
    console.error("Plant classification failed:", error);
    throw error;
  }
}