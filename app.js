'use strict';

/* QuickOCR: a deliberately single-image, on-device OCR workflow. */
const $ = id => document.getElementById(id);
const DRAFT_KEY = 'quickocr.latest.v1';
const COUNT_KEY = 'quickocr.processed.v1';
let imageFile = null;
let imageUrl = null;
let rotation = 0;
let working = false;
let selectedVersion = 0;
let ocrWorker = null;
let workerPromise = null;
let toastTimer = null;
let confidence = null;
let processed = 0;
let countedVersion = -1;
try { processed = Number(sessionStorage.getItem(COUNT_KEY)) || 0; } catch (e) {}

function announce(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}
function setBusy(busy) {
  working = busy;
  $('chooseZone').setAttribute('aria-disabled', String(busy));
  $('replaceButton').disabled = busy;
  $('fileInput').disabled = busy;
  $('nextButton').disabled = busy || !$('resultText').value.trim();
  $('retryButton').disabled = busy || !imageFile;
  $('rotateButton').disabled = busy || !imageFile;
  $('enhanceCheck').disabled = busy;
  $('altTry').disabled = busy || !imageFile;
  $('progressWrap').hidden = !busy;
  $('copyButton').disabled = !$('resultText').value.trim();
  $('downloadButton').disabled = !$('resultText').value.trim();
  $('clearButton').disabled = !$('resultText').value.trim();
  if (busy) {
    $('spinner').classList.remove('stopped');
    setProgress(0);
  }
}
function setProgress(percent) {
  const p = Math.max(0,Math.min(100,Math.round(percent)));
  $('progressFill').style.width = p + '%';
  $('progressTrack').setAttribute('aria-valuenow',String(p));
  $('percentText').textContent = p > 0 ? p + '%' : '';
}
function setStatus(status) { $('statusText').textContent = status; }
function showNotice(text) {
  $('notice').hidden = !text;
  $('notice').textContent = text || '';
}
function updateButtons() {
  const hasText = !!$('resultText').value.trim();
  $('copyButton').disabled = !hasText;
  $('downloadButton').disabled = !hasText;
  $('clearButton').disabled = !hasText;
  $('nextButton').disabled = working || !hasText;
  $('counter').textContent = processed + ' processed';
}
function saveDraft() {
  try {
    const text = $('resultText').value;
    if (text.trim()) {
      localStorage.setItem(DRAFT_KEY,JSON.stringify({text,filename:imageFile?.name || $('fileName').textContent,updatedAt:Date.now()}));
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
  } catch (e) { /* Storage can be disabled; OCR still works. */ }
}
function restoreDraft() {
  try {
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (stored && typeof stored.text === 'string' && stored.text.trim()) {
      $('resultText').value = stored.text;
      $('resultHelper').textContent = 'Restored the latest text saved on this iPhone. You can edit or copy it.';
      $('resultTag').textContent = 'Saved draft';
      $('resultTag').className = 'result-tag success';
    }
  } catch(e) { /* Ignore invalid or inaccessible saved draft. */ }
  updateButtons();
}
function pickImage() {
  if (!working) $('fileInput').click();
}
function releaseImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  imageFile = null;
}
function resetOutput() {
  confidence = null;
  resetAlternativeOutput();
  $('resultText').value = '';
  $('resultTag').textContent = 'Reading image…';
  $('resultTag').className = 'result-tag';
  $('resultHelper').textContent = 'Recognizing the question and answer choices…';
  showNotice('');
  saveDraft();
  updateButtons();
}
function validImage(file) {
  return !!file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif|bmp|gif)$/i.test(file.name));
}
async function selectImage(file) {
  if (!validImage(file)) { announce('Please select an image file.'); return; }
  if (working) return;
  releaseImage();
  imageFile = file;
  imageUrl = URL.createObjectURL(file);
  rotation = 0;
  selectedVersion++;
  $('preview').src = imageUrl;
  $('previewLarge').src = imageUrl;
  $('selectedFile').hidden = false;
  $('fileName').textContent = file.name;
  $('fileMeta').textContent = (file.size/1024/1024).toFixed(1) + ' MB · Tap image to inspect';
  resetOutput();
  await beginCroppingAndOCR(selectedVersion);
}
function isLostWorkerError(error) {
  return /terminated|worker|cannot read properties of null|postmessage|invalidstateerror/i.test(String(error));
}
async function destroyWorker() {
  const worker = ocrWorker;
  ocrWorker = null;
  workerPromise = null;
  if (worker) { try { await worker.terminate(); } catch(e) {} }
}
async function getWorker() {
  if (ocrWorker) return ocrWorker;
  if (workerPromise) return workerPromise;
  if (!window.Tesseract || typeof window.Tesseract.createWorker !== 'function') {
    throw new Error('OCR software could not load. Connect to the internet and refresh this page.');
  }
  workerPromise = window.Tesseract.createWorker('eng', 1, {
    logger: info => {
      if (working && info.status === 'recognizing text' && typeof info.progress === 'number') {
        setProgress(info.progress * 100);
        setStatus('Extracting text…');
      } else if (working && /loading|initializing/i.test(info.status || '')) {
        setStatus('Loading OCR engine…');
      }
    }
  }).then(async worker => {
    await worker.setParameters({tessedit_pageseg_mode:'6'});
    ocrWorker = worker;
    return worker;
  }).catch(error => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}
function decode(file) {
  return new Promise((resolve,reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be opened. Try converting it to PNG or JPG.')); };
    img.src = url;
  });
}
async function prepareImage(file) {
  const img = await decode(file);
  const maxDimension = 3200;
  const maxPixels = 7_000_000;
  const originalW = img.naturalWidth, originalH = img.naturalHeight;
  if (!originalW || !originalH) throw new Error('The image has no readable dimensions.');
  // OCR must work on the selected question, not on the phone's entire photo.
  const region = validCrop(cropRect) ? cropRect : {x:0,y:0,w:1,h:1};
  const sx = Math.floor(region.x * originalW);
  const sy = Math.floor(region.y * originalH);
  const sw = Math.max(1,Math.min(originalW-sx,Math.round(region.w*originalW)));
  const sh = Math.max(1,Math.min(originalH-sy,Math.round(region.h*originalH)));
  const isCropped = region.w < .99 || region.h < .99;
  // Moderate enlargement helps small glyphs without creating new image detail.
  const scale = Math.min(isCropped ? 2 : 1,maxDimension/Math.max(sw,sh),Math.sqrt(maxPixels/(sw*sh)));
  const width = Math.max(1,Math.round(sw*scale));
  const height = Math.max(1,Math.round(sh*scale));
  const swap = rotation % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? height : width;
  canvas.height = swap ? width : height;
  const enhance = $('enhanceCheck').checked;
  const ctx = canvas.getContext('2d',{willReadFrequently:enhance});
  if (!ctx) throw new Error('Cannot prepare image on this device.');
  ctx.fillStyle = 'white';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.translate(canvas.width/2,canvas.height/2);
  ctx.rotate(rotation * Math.PI/180);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img,sx,sy,sw,sh,-width/2,-height/2,width,height);
  if (enhance) {
    const pixels = ctx.getImageData(0,0,canvas.width,canvas.height);
    const data = pixels.data;
    for (let i=0;i<data.length;i+=4) {
      const gray = .299*data[i]+.587*data[i+1]+.114*data[i+2];
      const improved = Math.max(0,Math.min(255,(gray-128)*1.45+128));
      data[i]=data[i+1]=data[i+2]=improved;
    }
    ctx.putImageData(pixels,0,0);
  }
  return canvas;
}
function formatQuestion(raw) {
  const cleaned = String(raw || '').replace(/\r\n?/g,'\n')
    .split('\n').map(line => line.trim()).join('\n')
    .replace(/\n{3,}/g,'\n\n').trim();
  if (!cleaned) return '';
  const lines = cleaned.split('\n');
  // Radio-button circles on photographed screens are frequently recognized as
  // ©, O, or 0. Detect them without changing the words inside each option.
  // Only normalize labels when multiple consecutive option-like lines exist.
  const bullet = /^\s*(?:[©®○◯◦〇ⓞ●•◎]|[oO0](?=\s*[A-Ha-h8€&]{1,3}(?:[.)]|\s)))\s*(.+)$/;
  const labelled = /^\s*([A-Ha-h8€&0]{1,3})[.)]?\s+(.+)$/;
  const marked = [];
  lines.forEach((line,index) => {
    const circle=line.match(bullet);
    if (!circle) return;
    let content=circle[1].trim();
    const candidate=content.match(labelled);
    // 'BD', '8', and '€' are common recognition errors in tiny choice labels.
    // The label is assigned by order; the text body itself is left intact.
    if (candidate && candidate[2].trim()) content=candidate[2].trim();
    marked.push({index,body:content});
  });
  if (marked.length >= 3 && marked.length <= 8) {
    marked.forEach((option,index) => {
      lines[option.index]=String.fromCharCode(65+index)+'. '+option.body;
    });
  }
  const answerLine = /^\s*(?:[A-Ha-h][\.)]|[1-9][\.)])\s*\S/;
  for (let i=1; i<lines.length; i++) {
    if (answerLine.test(lines[i])) {
      if (lines[i-1].trim()) lines.splice(i,0,'');
      break;
    }
  }
  return lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
async function processImage(version) {
  if (working || !imageFile) return;
  resetAlternativeOutput();
  setBusy(true);
  setStatus('Preparing image…');
  try {
    const canvas = await prepareImage(imageFile);
    // Keep one OCR pass by default while normalizing predominantly dark themes.
    if (looksLikeLightTextOnDark(canvas)) invertForOCR(canvas);
    setStatus('Loading OCR engine…');
    let worker = await getWorker();
    let result;
    try {
      result = await worker.recognize(canvas, {rotateAuto:true});
    } catch (error) {
      if (!isLostWorkerError(error)) throw error;
      await destroyWorker();
      worker = await getWorker();
      result = await worker.recognize(canvas, {rotateAuto:true});
    }
    if (version !== selectedVersion) return;
    confidence = typeof result?.data?.confidence === 'number' ? result.data.confidence : null;
    const text = formatQuestion(result?.data?.text);
    $('resultText').value = text;
    if (countedVersion !== version) {
      processed++;
      countedVersion = version;
      try { sessionStorage.setItem(COUNT_KEY,String(processed)); } catch (e) {}
    }
    if (text) {
      $('resultTag').textContent = confidence !== null && confidence < 70 ? 'Check accuracy' : 'Text extracted';
      $('resultTag').className = 'result-tag ' + (confidence !== null && confidence < 70 ? 'warning':'success');
      $('resultHelper').textContent = 'Check the question and answers, then tap Copy text.';
      const warnings = [];
      if (confidence !== null && confidence < 70) warnings.push('Some text may have been misread. Compare it with the screenshot and edit any mistakes.');
      if (usedRememberedCrop) warnings.push('Saved crop reused. If any question or answer choice is missing, tap Crop and re-extract.');
      if (warnings.length) showNotice(warnings.join(' '));
    } else {
      $('resultTag').textContent = 'No text found';
      $('resultTag').className = 'result-tag warning';
      $('resultHelper').textContent = 'Try improving the image or typing in the text yourself.';
      showNotice('No readable text was detected. Try the enhancement controls below or choose a clearer image.');
    }
    saveDraft();
    updateButtons();
    if (text) $('resultPanel').scrollIntoView({behavior:'smooth',block:'start'});
  } catch (error) {
    $('resultTag').textContent = 'Could not extract';
    $('resultTag').className = 'result-tag warning';
    $('resultHelper').textContent = 'Please try again or select another image.';
    showNotice(error?.message || String(error));
  } finally {
    setBusy(false);
    updateButtons();
  }
}
async function copyText() {
  const value = $('resultText').value;
  if (!value.trim()) return;
  // iOS Safari allows this inside a genuine tap/click handler on HTTPS.
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard not available');
    await navigator.clipboard.writeText(value);
    announce('Copied! Paste it into ChatGPT.');
    $('copyButton').classList.add('copied');
  } catch (e) {
    const area = $('resultText');
    area.focus();
    area.select();
    try {
      if (document.execCommand('copy')) {
        announce('Copied! Paste it into ChatGPT.');
        return;
      }
    } catch (_) {}
    announce('Select the text and tap Copy.');
  }
}
function saveTxt() {
  const value = $('resultText').value;
  if (!value.trim()) return;
  const blob = new Blob(['\ufeff',value+'\n'],{type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Question_' + String(Math.max(1,processed)).padStart(2,'0') + '.txt';
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  announce('Text file prepared.');
}
function clearText() {
  $('resultText').value = '';
  $('resultTag').textContent = 'Ready for your screenshot';
  $('resultTag').className = 'result-tag';
  $('resultHelper').textContent = 'Text cleared. Choose another screenshot to continue.';
  showNotice('');
  saveDraft();
  updateButtons();
}
function attachEvents() {
  $('chooseZone').addEventListener('click',pickImage);
  $('chooseZone').addEventListener('keydown',e => {
    if (e.key === 'Enter' || e.key === ' ') {e.preventDefault();pickImage();}
  });
  $('fileInput').addEventListener('change',async e => {
    const file = e.target.files?.[0];
    e.target.value = ''; // Picking the same filename a second time still triggers change.
    if (file) await selectImage(file);
  });
  $('replaceButton').addEventListener('click',pickImage);
  $('nextButton').addEventListener('click',pickImage);
  $('copyButton').addEventListener('click',copyText);
  $('downloadButton').addEventListener('click',saveTxt);
  $('clearButton').addEventListener('click',clearText);
  $('resultText').addEventListener('input',()=>{saveDraft();updateButtons();});
  $('rotateButton').addEventListener('click',()=>{
    if (!imageFile || working) return;
    rotation = (rotation+90)%360;
    announce('Rotation: '+rotation+'°. Tap Re-extract text.');
  });
  $('retryButton').addEventListener('click',()=>{if (!working && imageFile)processImage(selectedVersion);});
  $('previewButton').addEventListener('click',()=>{if(imageFile)$('previewDialog').showModal();});
  $('closePreview').addEventListener('click',()=>$('previewDialog').close());
  $('previewDialog').addEventListener('click',e=>{if(e.target===$('previewDialog'))$('previewDialog').close();});
  window.addEventListener('beforeunload',saveDraft);
}
attachEvents();
restoreDraft();
// Allow the first OCR download/init to start while the user selects a screenshot.
window.addEventListener('load',()=>{
  if (document.visibilityState==='visible') setTimeout(()=>getWorker().catch(()=>{}),450);
  if ('serviceWorker' in navigator && location.protocol==='https:') {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
});
