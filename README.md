# Word Buddy

An English vocabulary helper for primary-school children. Snap a page, crop to the words,
tap a word to hear it, see a child-friendly meaning and an example sentence.

No accounts, no AI service, no tracking. Everything is free:
- Meanings: WordNet 3.1 (Princeton University, WordNet licence), built in as dict-a.json to dict-z.json.
  Meanings are listed most-used first; rude and adult senses are removed.
- Pronunciation guide: Free Dictionary API (dictionaryapi.dev), when available
- Example sentences: the dictionary, then Tatoeba (CC BY 2.0 FR), filtered for children
- English word list: word-list (MIT)
- Photo reading: Tesseract.js, runs on the device
- Read aloud: the device's own voice

All files sit in one folder, so they can be uploaded to GitHub in one go.

## Updating
Upload the changed files to the same GitHub repository (they replace the old ones).
Then open sw.js on GitHub, click the pencil icon, and change VERSION
(for example wb-2026-11-10-3 to wb-2026-11-10-4) so devices pick up the new version.
