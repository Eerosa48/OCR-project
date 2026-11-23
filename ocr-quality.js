'use strict';
/* Optional alternative scans. Never overwrite the user's original recognition
   without an explicit tap on "Use this text". Designed for repeated iPhone use. */
let alternativeScans = [];
let alternativeScanVersion = -1;
const altTry = $('altTry');
const altResults = $('altResults');
const altChoice = $('altChoice');
const altText = $('altText');
const altUse = $('altUse');

/* Tesseract works best with dark lettering on a light surface.
   Sample a tiny copy and only invert images with strongly dark backgrounds. */
function looksLikeLightTextOnDark(source) {
  const sample = document.createElement('canvas');
  sample.width = Math.min(80, source.width);
  sample.height = Math.min(80, source.height);
  const ctx = sample.getContext('2d', {willReadFrequently:true});
  if (!ctx || !sample.width || !sample.height) return false;
  ctx.drawImage(source, 0, 0, sample.width, sample.height);
  const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
  let dark = 0, totalBrightness = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (77 * data[i] + 150 * data[i+1] + 29 * data[i+2]) / 256;
    totalBrightness += brightness;
    if (brightness < 105) dark++;
  }
  return total > 0 && dark / total > .72 && totalBrightness / total < 115;
}
// In place for the standard scan, or copy=true for comparison scans.
function invertForOCR(source, copy = false) {
  let canvas = source;
  if (copy) {
    canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const draw = canvas.getContext('2d', {willReadFrequently:true});
    if (!draw) throw new Error('Unable to prepare an inverted scan.');
    draw.drawImage(source, 0, 0);
  }
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  if (!ctx) throw new Error('Unable to invert image colors.');
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i+1] = 255 - data[i+1];
    data[i+2] = 255 - data[i+2];
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

function resetAlternativeOutput() {
  alternativeScans = [];
  alternativeScanVersion = -1;
  altResults.hidden = true;
  altChoice.replaceChildren();
  altText.value = '';
  altTry.disabled = working || !imageFile;
}
function redrawAlternative() {
  const selected = Number(altChoice.value);
  altText.value = alternativeScans[selected]?.text || '';
  altUse.disabled = !altText.value.trim();
}
function contrastCanvas(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  if (!ctx) throw new Error('Unable to enhance image on this device.');
  ctx.drawImage(source,0,0);
  const pixels = ctx.getImageData(0,0,canvas.width,canvas.height), data=pixels.data;
  const histogram = new Uint32Array(256);
  for (let i=0;i<data.length;i+=4) {
    const v=Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2]);
    histogram[v]++;
  }
  const total=canvas.width*canvas.height;
  const loTarget=total*.02, hiTarget=total*.98;
  let lo=0,hi=255,sum=0;
  for(let i=0;i<256;i++){sum+=histogram[i];if(sum>=loTarget){lo=i;break;}}
  sum=0;
  for(let i=0;i<256;i++){sum+=histogram[i];if(sum>=hiTarget){hi=i;break;}}
  if (hi-lo<28) {lo=Math.max(0,lo-15);hi=Math.min(255,hi+15);}
  const contrast=232 / Math.max(1,hi-lo);
  for (let i=0;i<data.length;i+=4) {
    const v=Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2]);
    const p=Math.max(0,Math.min(255,Math.round((v-lo)*contrast+12)));
    data[i]=p;data[i+1]=p;data[i+2]=p;
  }
  ctx.putImageData(pixels,0,0);
  return canvas;
}
async function runAlternativeScans() {
  if (working || !imageFile) return;
  const version=selectedVersion;
  altTry.disabled=true;
  altResults.hidden=true;
  setBusy(true);
  setStatus('Preparing alternate scans…');
  let worker;
  try {
    // Reuse the same cropped pixels and OCR model; no new cloud/API calls.
    const base=await prepareImage(imageFile);
    const darkBackground=looksLikeLightTextOnDark(base);
    const normalized=darkBackground ? invertForOCR(base,true) : base;
    worker=await getWorker();
    const passes=[
      {label:'Enhanced contrast',makeCanvas:()=>contrastCanvas(normalized),psm:'6'},
      {label:'Alternate text layout',makeCanvas:()=>normalized,psm:'11'},
      {label:darkBackground ? 'Original colors' : 'Inverted colors',
        makeCanvas:()=>darkBackground ? base : invertForOCR(base,true),psm:'6'}
    ];
    const results=[];
    for (const pass of passes) {
      if (version!==selectedVersion) break;
      setStatus('Scanning: '+pass.label+'…');
      await worker.setParameters({tessedit_pageseg_mode:pass.psm});
      const response=await worker.recognize(pass.makeCanvas(),{rotateAuto:false});
      const text=formatQuestion(response?.data?.text);
      if(text.trim()) {
        results.push({label:pass.label,text,confidence:response?.data?.confidence});
      }
    }
    if(version!==selectedVersion) return;
    // No silent replacement: every candidate remains an explicitly chosen option.
    alternativeScans=results;
    alternativeScanVersion=version;
    altChoice.replaceChildren();
    results.forEach((result,index)=>{
      const item=document.createElement('option');
      item.value=String(index);
      item.textContent=result.label;
      altChoice.append(item);
    });
    if(results.length) {
      altChoice.value='0';
      redrawAlternative();
      altResults.hidden=false;
      announce('Alternate scans ready. Compare the text.');
    } else {
      showNotice('Alternate scans did not find readable text. Your original result is unchanged.');
    }
  } catch(error) {
    showNotice('Alternate scan failed: '+(error?.message || String(error))+
      '. Your original text is unchanged.');
  } finally {
    // Restore default segmentation for the next rapid standard scan.
    if (worker) {
      try { await worker.setParameters({tessedit_pageseg_mode:'6'}); }
      catch(e) { await destroyWorker(); }
    }
    setBusy(false);
    altTry.disabled=!imageFile;
  }
}
altTry.addEventListener('click',runAlternativeScans);
altChoice.addEventListener('change',redrawAlternative);
altUse.addEventListener('click',()=>{
  if (working || alternativeScanVersion!==selectedVersion || !altText.value.trim()) return;
  $('resultText').value=altText.value;
  $('resultTag').textContent='Alternate result selected';
  $('resultTag').className='result-tag warning';
  $('resultHelper').textContent='Compare this version with the screenshot, then copy.';
  showNotice('Alternate OCR results can contain errors. Verify every answer choice.');
  saveDraft();
  updateButtons();
  $('resultPanel').scrollIntoView({behavior:'smooth',block:'start'});
});
