// Drafts contain private photos, never passwords or authentication tokens.
export function createFarmerDraft(fs, documentDirectory) {
  const folder = uid => {
    if (!/^[a-f0-9-]{36}$/i.test(uid) || !documentDirectory) throw Error('draft storage');
    return `${documentDirectory}ayurraksha-drafts/${uid}/`;
  };
  return {
    async read(uid) {
      const path = folder(uid) + 'draft.json';
      if (!(await fs.getInfoAsync(path)).exists) return null;
      const record = JSON.parse(await fs.readAsStringAsync(path));
      if (record.uid !== uid || record.version !== 1) throw Error('draft account');
      for (const uri of record.form.photos || []) {
        if (!uri.startsWith(folder(uid)) || !(await fs.getInfoAsync(uri)).exists) throw Error('draft photo missing');
      }
      return record.form;
    },
    async save(uid, form) {
      const base = folder(uid);
      await fs.makeDirectoryAsync(base, { intermediates: true });
      const photos = [];
      for (let i = 0; i < form.photos.length; i++) {
        const uri = form.photos[i];
        if (uri.startsWith(base)) { photos.push(uri); continue; }
        const dest = `${base}photo-${Date.now()}-${i}.jpg`;
        await fs.copyAsync({ from: uri, to: dest });
        photos.push(dest);
      }
      const prediction = form.mlPrediction;
      const photoIndex = prediction ? form.photos.indexOf(prediction.sourceUri) : -1;
      const saved = { ...form, photos, mlPrediction: photoIndex < 0 ? null : { ...prediction, sourceUri: photos[photoIndex] } };
      const path = base + 'draft.json';
      const temporary = base + 'draft.next.json';
      await fs.writeAsStringAsync(temporary, JSON.stringify({ version: 1, uid, form: saved }));
      await fs.moveAsync({ from: temporary, to: path });
      return saved;
    },
    async remove(uid) { await fs.deleteAsync(folder(uid) + 'draft.json', { idempotent: true }); },
  };
}
