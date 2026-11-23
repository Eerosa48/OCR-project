'use strict';
// Crop UI for small questions within full-screen or photographed screenshots.
// Region coordinates are normalized, so a saved crop can be reused on similarly-sized images.
// Increment the crop key so test-session crops cannot silently hide a new layout.
const CROP_KEY = 'quickocr.crop.v3';
// The first crop must never silently exclude questions near the top or edges.
const DEFAULT_CROP = Object.freeze({x:.02, y:.02, w:.96, h:.96});
function freshCrop() { return {...DEFAULT_CROP}; }
let cropRect = null;
let usedRememberedCrop = false;
let cropAspect = 0;
let cropDrag = null;
let cropImageSize = { width: 0, height: 0 };
const cropDialog = $('cropDialog');
const cropStage = $('cropStage');
const cropSelection = $('cropSelection');
const cropImage = $('cropImage');
function clampCrop(n, min, max) { return Math.max(min, Math.min(max, n)); }
function validCrop(r) {
  return r && [r.x,r.y,r.w,r.h].every(Number.isFinite) &&
    r.x >= 0 && r.y >= 0 && r.w >= .04 && r.h >= .04 &&
    r.x + r.w <= 1.001 && r.y + r.h <= 1.001;
}
function showCropSelection() {
  if (!validCrop(cropRect)) return;
  cropSelection.style.left = (cropRect.x * 100) + '%';
  cropSelection.style.top = (cropRect.y * 100) + '%';
  cropSelection.style.width = (cropRect.w * 100) + '%';
  cropSelection.style.height = (cropRect.h * 100) + '%';
}
function sizeCropStage() {
  if (!cropImageSize.width || !cropImageSize.height) return;
  const maxW = Math.min(window.innerWidth - 54, 580);
  const maxH = Math.max(200, window.innerHeight * .57);
  const scale = Math.min(maxW / cropImageSize.width, maxH / cropImageSize.height);
  cropStage.style.width = Math.floor(cropImageSize.width * scale) + 'px';
  cropStage.style.height = Math.floor(cropImageSize.height * scale) + 'px';
}
function showCropDialog() {
  cropImage.src = imageUrl;
  if (!validCrop(cropRect)) cropRect = freshCrop();
  cropDialog.showModal();
  sizeCropStage();
  showCropSelection();
}
async function beginCroppingAndOCR(version) {
  try {
    const img = await decode(imageFile);
    if (version !== selectedVersion) return;
    usedRememberedCrop = false;
    cropImageSize = { width: img.naturalWidth, height: img.naturalHeight };
    cropAspect = img.naturalWidth / img.naturalHeight;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CROP_KEY) || 'null'); } catch (_) {}
    if (saved && validCrop(saved.rect) && Math.abs(saved.aspect / cropAspect - 1) < .025) {
      cropRect = saved.rect;
      usedRememberedCrop = true;
      await processImage(version);
      return;
    }
    cropRect = freshCrop();
    showCropDialog();
  } catch (error) {
    showNotice(error?.message || 'Could not read the selected image.');
    $('resultTag').textContent = 'Could not open image';
    $('resultTag').className = 'result-tag warning';
  }
}
function normalizedPoint(event) {
  const b = cropStage.getBoundingClientRect();
  return {
    x: clampCrop((event.clientX - b.left) / b.width, 0, 1),
    y: clampCrop((event.clientY - b.top) / b.height, 0, 1)
  };
}
cropStage.addEventListener('pointerdown', e => {
  if (e.button !== undefined && e.button !== 0) return;
  const p = normalizedPoint(e);
  const corner = e.target.dataset.corner;
  const mode = corner ? 'resize' : (e.target === cropSelection ? 'move' : 'draw');
  cropDrag = { id:e.pointerId, mode, corner, start:p, original:{...cropRect} };
  cropStage.setPointerCapture(e.pointerId);
  e.preventDefault();
});
cropStage.addEventListener('pointermove', e => {
  if (!cropDrag || e.pointerId !== cropDrag.id) return;
  const p = normalizedPoint(e), a = cropDrag.original;
  if (cropDrag.mode === 'move') {
    cropRect = {
      x: clampCrop(a.x + p.x - cropDrag.start.x, 0, 1-a.w),
      y: clampCrop(a.y + p.y - cropDrag.start.y, 0, 1-a.h),
      w:a.w, h:a.h
    };
  } else if (cropDrag.mode === 'resize') {
    let left=a.x, top=a.y, right=a.x+a.w, bottom=a.y+a.h;
    if (cropDrag.corner.includes('w')) left=clampCrop(p.x,0,right-.04);
    if (cropDrag.corner.includes('e')) right=clampCrop(p.x,left+.04,1);
    if (cropDrag.corner.includes('n')) top=clampCrop(p.y,0,bottom-.04);
    if (cropDrag.corner.includes('s')) bottom=clampCrop(p.y,top+.04,1);
    cropRect={x:left,y:top,w:right-left,h:bottom-top};
  } else {
    const left=Math.min(p.x,cropDrag.start.x), top=Math.min(p.y,cropDrag.start.y);
    cropRect={
      x:clampCrop(left,0,.96), y:clampCrop(top,0,.96),
      w:clampCrop(Math.abs(p.x-cropDrag.start.x),.04,1-left),
      h:clampCrop(Math.abs(p.y-cropDrag.start.y),.04,1-top)
    };
  }
  showCropSelection();
  e.preventDefault();
});
function endCropDrag(e) {
  if (!cropDrag || cropDrag.id !== e.pointerId) return;
  cropDrag = null;
  if (cropStage.hasPointerCapture(e.pointerId)) cropStage.releasePointerCapture(e.pointerId);
}
cropStage.addEventListener('pointerup',endCropDrag);
cropStage.addEventListener('pointercancel',endCropDrag);
$('cropApply').addEventListener('click',async () => {
  if (!validCrop(cropRect)) return;
  usedRememberedCrop = false;
  try {
    if ($('rememberCrop').checked) localStorage.setItem(CROP_KEY,JSON.stringify({aspect:cropAspect,rect:cropRect}));
    else localStorage.removeItem(CROP_KEY);
  } catch (_) {}
  cropDialog.close();
  resetOutput();
  await processImage(selectedVersion);
});
$('cropFull').addEventListener('click',async () => {
  cropRect = null;
  usedRememberedCrop = false;
  try { localStorage.removeItem(CROP_KEY); } catch (_) {}
  cropDialog.close();
  resetOutput();
  await processImage(selectedVersion);
});
$('adjustCropButton').addEventListener('click',() => {
  if (imageFile && !working) showCropDialog();
});
window.addEventListener('resize',() => { if (cropDialog.open) sizeCropStage(); });
