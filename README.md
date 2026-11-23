# QuickOCR — iPhone single-screenshot OCR

A lightweight mobile web app optimized for one image at a time:

1. Open the app on your iPhone.
2. Tap **Choose from Photos** and select a screenshot. The first time, crop to the question and its choices.
3. Tap **Crop & extract**. OCR reads only that selected area. When you choose another image with a similar aspect ratio, the saved crop is reused automatically.
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
- **Crop first**: on a phone photograph of a monitor, the question may occupy less than 20% of the picture. Use the cropping rectangle and include all answer choices. Cropping is reused on similarly shaped photos, and can be changed with **Crop** beside the selected file. Contrast and rotation remain optional. OCR cannot restore details that are too blurry.
- iOS versions/browser compatibility determine whether HEIC images can be decoded. PNG and JPEG are best.
- App keeps a session-only counter of successful OCR runs and has an optional `.txt` export.
- The app doesn't generate question answers; it only transcribes the text. Check OCR before using extracted wording.
- This is a first-version prototype; it is not yet verified on a real iPhone or under all network conditions.

## Files

- `index.html` — mobile UI
- `styles.css` — responsive visual design
- `app.js` — image processing, OCR, editable result, clipboard, export
- `crop.js` — crop UI, touch handles, and remembered capture region
- `manifest.webmanifest` + `icon-*.png` — add-to-home-screen icon/metadata
- `sw.js` — caches first-party application files (not the OCR engine)

## Improving recognition on difficult photos

The standard scan remains a single OCR pass for speed. It conservatively detects predominantly dark backgrounds and inverts them to dark text on a light background for recognition; light, cream, and yellow backgrounds remain unchanged. When a screenshot mixes dark and light panels, the original appearance may be retained. Under **Having trouble reading an image?**, tap **Try enhanced recognition** for three optional on-device passes: contrast adjustment, sparse-text layout, and the opposite image polarity. Review alternatives and explicitly choose **Use this text**; the standard result is not overwritten automatically. Higher confidence does not guarantee correct wording.

A remembered crop is convenient for screenshots with the same layout, but a different screen can have the same aspect ratio. The result screen now warns when a saved crop was reused. If any part of the question or answer choices is absent, tap **Crop**, adjust the rectangle, and re-extract.

### Preflight for unknown layouts

Before relying on this for time-sensitive questions, try a dark screen, a white screen, a cream/yellow screen, and at least one mixed-layout screenshot. Verify all answer choices were recognized and preserved, then try one image where the camera has mild moiré or glare. Confirm normal processing remains fast on the actual iPhone and that the optional alternate scans can recover a difficult example. No preprocessing can restore text that is unreadable in the captured image.

The app also recognizes additional common OCR distortions of radio-button labels, including tight pairs such as `OB` and garbled labels like `© BD`. This is only a formatting heuristic: always review question and option wording.
