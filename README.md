# QuickOCR — iPhone single-screenshot OCR

A lightweight mobile web app optimized for one image at a time:

1. Open the app on your iPhone.
2. Tap **Choose from Photos** and select a screenshot.
3. OCR automatically extracts text into an editable box.
4. Review the text, tap **Copy text**, switch to ChatGPT or another app, and paste.
5. Come back and tap **Next screenshot**. Repeat.

## Hosting (recommended)

The app is static: upload the entire contents of this folder to a GitHub repository and enable GitHub Pages under **Settings → Pages → Deploy from a branch**, choosing the branch and root directory. Visit the HTTPS Pages URL on your iPhone in Safari. To add to your home screen, open Safari's **Share** menu and select **Add to Home Screen** (wording can vary by iOS version).

No backend, database, paid OCR account, or API key is required. The number of screenshots processed is not artificially restricted. Images never go to an app server; Tesseract.js performs OCR within the device browser. The OCR runtime and English language data are downloaded from external servers on first use (and whenever required), so an internet connection is needed for dependable operation. The installed app shell can be cached, but **offline OCR is not guaranteed**.

## Local desktop testing

In this folder, run `python -m http.server 8000`, then visit http://localhost:8000 in a desktop browser. An iPhone cannot reach your PC's `localhost`, so host on an HTTPS site for phone testing. Simply double-clicking index.html might not work with browser workers. No npm/build step is needed.

## Notes

- The **Copy text** action works best on a secure HTTPS origin and must be tapped by the user, per iOS Safari clipboard rules. A manual selection fallback is available.
- The app retains the last recognized/edited text using local browser storage, useful when you leave for another app and return. It does **not** retain the image across page reloads. Tap **Clear text** to delete that locally saved draft.
- Poor FaceTime screenshots may benefit from the **Having trouble reading an image?** section: improve contrast, rotate, and re-extract. OCR cannot restore information that wasn't captured or is too blurry to read.
- iOS versions/browser compatibility determine whether HEIC images can be decoded. PNG and JPEG are best.
- App keeps a session-only counter of successful OCR runs and has an optional `.txt` export.
- The app doesn't generate question answers; it only transcribes the text. Check OCR before using extracted wording.
- This is a first-version prototype; it is not yet verified on a real iPhone or under all network conditions.

## Files

- `index.html` — mobile UI
- `styles.css` — responsive visual design
- `app.js` — image processing, OCR, editable result, clipboard, export
- `manifest.webmanifest` + `icon-*.png` — add-to-home-screen icon/metadata
- `sw.js` — caches first-party application files (not the OCR engine)
