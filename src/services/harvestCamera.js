// Capture only through the device camera. GPS is collected separately before submission.
export async function captureHerbPhoto(picker, now = () => new Date().toISOString()) {
  let permission;
  try {
    permission = await picker.requestCameraPermissionsAsync();
  } catch {
    throw { uiKey: 'cameraUnavailable' };
  }
  if (!permission.granted && permission.status !== 'granted') {
    throw { uiKey: 'cameraPermissionRequired' };
  }
  let result;
  try {
    result = await picker.launchCameraAsync({ quality: 0.7, mediaTypes: ['images'], allowsEditing: false });
  } catch {
    throw { uiKey: 'cameraUnavailable' };
  }
  if (result.canceled) return null;
  const uri = result.assets?.[0]?.uri;
  if (!uri) throw { uiKey: 'cameraUnavailable' };
  return { uri, capture: { source: 'camera', capturedAt: now() } };
}
