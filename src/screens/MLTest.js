import React, { useState } from "react";
import {
  View,
  Text,
  Button,
  Image,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";

import * as ImagePicker from "expo-image-picker";

import { classifyPlant } from "../services/plantClassifier";

export default function MLTest() {
  const [imageUri, setImageUri] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);

  const chooseImage = async () => {
    try {
      // Request gallery permission
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "Permission Required",
          "Please allow access to your photos."
        );
        return;
      }

      // Open gallery
      const result =
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 1,
        });

      // User cancelled
      if (result.canceled) {
        return;
      }

      const selectedImage =
        result.assets[0].uri;

      // Show selected image
      setImageUri(selectedImage);

      // Clear previous prediction
      setPrediction(null);

      // Start prediction
      setLoading(true);

      console.log(
        "Selected image:",
        selectedImage
      );

      const resultPrediction =
        await classifyPlant(selectedImage);

      console.log(
        "Prediction result:",
        resultPrediction
      );

      setPrediction(resultPrediction);

    } catch (error) {
      console.error(
        "ML test error:",
        error
      );

      Alert.alert(
        "Prediction Failed",
        error?.message ||
          "Something went wrong while running the model."
      );

    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>
        Plant Identification Test
      </Text>

      <Text style={styles.subtitle}>
        Select a plant image to test the ML model.
      </Text>

      <View style={styles.buttonContainer}>
        <Button
          title="Choose Plant Image"
          onPress={chooseImage}
        />
      </View>

      {imageUri && (
        <View style={styles.imageSection}>
          <Text style={styles.sectionTitle}>
            Selected Image
          </Text>

          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            resizeMode="cover"
          />
        </View>
      )}

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
          />

          <Text style={styles.loadingText}>
            Analyzing image...
          </Text>
        </View>
      )}

      {prediction && !loading && (
        <View style={styles.resultContainer}>
          <Text style={styles.sectionTitle}>
            Prediction
          </Text>

          <Text style={styles.predictedPlant}>
            {prediction.plant}
          </Text>

          <Text style={styles.confidence}>
            Confidence:{" "}
            {(prediction.confidence * 100).toFixed(2)}
            %
          </Text>

          <View style={styles.divider} />

          <Text style={styles.topThreeTitle}>
            Top 3 Predictions
          </Text>

          {prediction.top3.map(
            (item, index) => (
              <View
                key={item.plant}
                style={styles.predictionRow}
              >
                <Text style={styles.rank}>
                  {index + 1}.
                </Text>

                <View style={styles.predictionInfo}>
                  <Text style={styles.plantName}>
                    {item.plant}
                  </Text>

                  <Text style={styles.predictionConfidence}>
                    {(item.confidence * 100).toFixed(2)}
                    %
                  </Text>
                </View>
              </View>
            )
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },

  title: {
    fontSize: 26,
    fontWeight: "bold",
    marginTop: 30,
    textAlign: "center",
  },

  subtitle: {
    fontSize: 16,
    color: "#666666",
    marginTop: 10,
    marginBottom: 30,
    textAlign: "center",
  },

  buttonContainer: {
    width: "100%",
    marginBottom: 20,
  },

  imageSection: {
    width: "100%",
    alignItems: "center",
    marginTop: 10,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 15,
  },

  image: {
    width: 224,
    height: 224,
    borderRadius: 12,
  },

  loadingContainer: {
    alignItems: "center",
    marginTop: 30,
  },

  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#555555",
  },

  resultContainer: {
    width: "100%",
    marginTop: 30,
    padding: 20,
    borderRadius: 15,
    backgroundColor: "#f5f5f5",
  },

  predictedPlant: {
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 5,
  },

  confidence: {
    fontSize: 17,
    textAlign: "center",
    marginTop: 8,
  },

  divider: {
    height: 1,
    backgroundColor: "#dddddd",
    marginVertical: 20,
  },

  topThreeTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
  },

  predictionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#dddddd",
  },

  rank: {
    width: 30,
    fontSize: 17,
    fontWeight: "bold",
  },

  predictionInfo: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  plantName: {
    fontSize: 16,
  },

  predictionConfidence: {
    fontSize: 16,
    fontWeight: "bold",
  },
});