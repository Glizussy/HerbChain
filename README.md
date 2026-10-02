# AyurSutra — HerbChain

Mobile herb collection, Hyperledger Fabric traceability, and participant web portals.

Start with [Changes and current run instructions](docs/CHANGES-2026-10-02.md) and the [implementation report](docs/IMPLEMENTATION-REPORT.md). These explain the implemented phases, private configuration, tests, and features still awaiting live activation. Reusable local launchers are in `scripts/`; Fabric code is in `blockchain/`, and the API, web portals, migrations and tests are in `server/`.

The remaining sections below are the original farmer-stage design notes. Their proposed future work and record examples do not describe the full current implementation.

## Original farmer-stage notes

React Native (Expo) screen for **Stage 1: Farmer / Wild Collector** of the
HerbChain custody chain.

## Run it

```bash
npm install
npx expo start
```

Use a native Expo development build for the TFLite integration; Expo Go cannot load the native model dependencies. See the current run instructions above.

## What's included

```
App.js                              # entry point, wires the form + submit handler
src/theme/theme.js                  # colors, spacing, typography tokens
src/components/FormField.js         # labeled text input w/ error + hint
src/components/SegmentedChips.js    # pill selector (source type, harvest method, etc.)
src/components/LocationCard.js      # GPS capture UI
src/components/PhotoPicker.js       # camera/gallery multi-photo picker
src/screens/FarmerCollectionForm.js # the full farmer data-entry screen
```

## Fields captured (maps directly to the custody record)

| Field | Required | Notes |
|---|---|---|
| Batch ID | auto | client-generated placeholder (`HC-YYYYMMDD-XXXX`); real ID is confirmed once minted |
| Herb name | ✅ | free text |
| Part collected | — | chip select (root, leaf, bark, etc.) |
| Collection date & time | ✅ | native date/time pickers, capped at "today" |
| GPS location | ✅ | `expo-location`, records lat/long + accuracy |
| Quantity | ✅ | numeric + unit (kg/g/bundles) |
| Collector name / ID | ✅ (one of the two) | ID field is for a farmer registration or similar |
| Photos | ✅ | up to 5, camera or gallery via `expo-image-picker` |
| Quality notes | — | free text |
| Harvest method | — | chip select |
| Source type | — | Cultivated vs Wild-collected |

## On submit

`FarmerCollectionForm` calls `onSubmit(record)` with a flat JSON object
shaped for your backend:

```js
{
  stage: 'FARMER_COLLECTION',
  batchId, herbName, plantPart,
  collectionTimestamp,           // ISO string
  location: { latitude, longitude, accuracy, capturedAt },
  quantity: { value, unit },
  collector: { name, id },
  photos: [uri, ...],            // local URIs — upload to storage before minting
  qualityNotes, harvestMethod, sourceType,
  recordedAt
}
```

Wire `handleSubmit` in `App.js` to:
1. Upload `photos` (local URIs) to your storage/IPFS.
2. POST the record + photo hashes/URLs to your backend.
3. Register a reviewed batch through the Fabric backend, then show its committed transaction ID. See blockchain/README.md for current implementation status and setup.

## Next stages (not built yet)

Aggregator, Processor, and Manufacturer screens will each **append** to
the same `batchId` rather than create a new one — same pattern (form →
validate → structured record → append to chain), with fields specific
to that stage (e.g. processing method, storage conditions, lab test
results, packaging details).

## Permissions

Requires camera, photo library, and location permissions at runtime
(handled in-app). Add to `app.json` before building:

```json
"expo": {
  "plugins": [
    ["expo-image-picker", { "cameraPermission": "Allow HerbChain to take harvest photos." }],
    ["expo-location", { "locationAlwaysAndWhenInUsePermission": "Allow HerbChain to record collection GPS." }]
  ]
}
```
