# Camera, GPS and regional evidence

New farmer harvests use the camera only. There is no gallery picker. The app explains why it needs location, requests foreground permission, and captures precise GPS before taking a photograph. Denied permission, disabled GPS, reported mock locations or accuracy worse than 100 metres prevent capture. It runs the existing five-class TFLite model and requires a prediction linked to a submitted camera image before continuing.

Before a new local or queued harvest is recorded, the API requires camera metadata, consent, GPS no older than 15 minutes, photographs within 15 minutes of that GPS capture, and the supported model identifier. Missing or invalid capture fails before blockchain submission. Retryable preflight rejection releases the phone's outbox lock so the farmer can refresh GPS or retake photos. Already stored submissions retain their original evidence and exact retries remain valid.

The server independently looks up the predicted species using the [GBIF species API](https://data-blog.gbif.org/post/gbif-species-api/) and searches nearby georeferenced occurrences using the [GBIF occurrence API](https://techdocs.gbif.org/en/openapi/v1/occurrence). It sends a bounding box centred on coordinates rounded to two decimal places, rather than the exact GPS location. The box extends roughly 50 km north/south and east/west at Indian latitudes. Up to 20 records are examined, with geospatial issue filtering and exclusion of records reporting more than 10 km coordinate uncertainty. Public record references, dataset IDs, lookup time and concerns are stored in the private manifest whose digest is recorded on Fabric. Precise GPS and images remain private and are not included in public trace output.

No nearby records, an unavailable service, an uncertain taxon match, model confidence below 80%, a different declared herb, or a region label not matching nearby recorded state names causes a review flag. Every harvest remains `PENDING_REVIEW`; even corroborated submissions never get automatic botanical approval. For flagged batches, the API requires a separate explanation of supporting evidence (30–4000 characters) before reviewer approval. The website shows the concerns and occurrence references. This applies to both local and queued reviews, including worker preflight. Rejecting a batch does not require resolving its concerns.

The reference lookup is bounded to four simultaneous lookups and a 200-entry one-hour cache per API instance. A lookup failure holds the batch for review rather than silently accepting it. Independent cultivation records may resolve missing wild occurrence records; cultivated and wild collection are recorded separately. No invented state-level herb whitelist is used.

## Important limits

- The current model chooses among five classes. It has no trained unknown/non-herb class, so its top prediction does not prove a photograph is an Ayurvedic herb. The 80% threshold is a review heuristic, not calibrated safety assurance. Open-set/non-herb detection and independent server inference remain future work.
- Camera-only controls prevent normal gallery selection. Capture metadata, the on-device prediction and the phone's mock-location flag are client-reported evidence, not cryptographic device attestation. A modified client can forge them. The backend never treats them as verified identity or safety.
- Nearby GBIF occurrences corroborate reported regional presence. Missing records do not prove absence; the lookup does not establish climatic suitability, harvesting permits or conservation compliance. A typed region is compared with recorded state labels where available, not independently reverse-geocoded into an authoritative administrative boundary.
- Direct authorized Fabric CLI calls do not run these API checks. Chaincode still enforces independent review before transfer. Network-wide enforcement would require a chaincode upgrade with a trusted signed assessment/oracle design.
- Existing manifests and ledger history are preserved. Older submissions lack the new assessment and continue under the original independent review flow.

## Run the update

Restart the Ubuntu API, restart Metro with `--clear`, then reload the installed Android development app. No new native module was added. Test camera permission denial, location permission denial, precise GPS, an unclear image, and a successful captured harvest on a real phone. Background location is not requested.

The bottom farmer navigation now uses short, single-line labels, a smaller bar and bounded text scaling. Draft saving sits separately from Back/Next. The form handles the keyboard without crowding the navigation.
