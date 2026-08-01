/* =====================================================================
   OCR de PDFs escaneados (imagem, sem texto real embutido).
   =====================================================================
   Usado como fallback: só entra em ação quando a extração normal de
   texto do pdf.js não encontra texto suficiente numa página (sinal de
   que a página é uma imagem escaneada, não texto selecionável).

   Roda 100% no navegador da pessoa usuária via Tesseract.js — sem custo,
   sem chave de API — mas é bem mais lento que a extração de texto normal
   (alguns segundos por página), por isso só é usado quando necessário.

   Depende do script global do Tesseract.js (carregado via <script src>
   antes deste arquivo) e do pdf.js já carregado na página.
   ===================================================================== */

const OCR_MIN_CHARS_PER_PAGE = 15; // abaixo disso, considera que a página não tem texto real
let ocrWorkerPromise = null;

function waitForTesseract(timeoutMs){
  return new Promise((resolve)=>{
    const start = Date.now();
    (function check(){
      if(window.Tesseract) return resolve(true);
      if(Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(check, 100);
    })();
  });
}

async function getOcrWorker(){
  if(!ocrWorkerPromise){
    ocrWorkerPromise = (async ()=>{
      const ready = await waitForTesseract(8000);
      if(!ready) throw new Error("Motor de OCR não carregou. Verifique sua conexão e tente novamente.");
      return await Tesseract.createWorker("por");
    })();
  }
  return ocrWorkerPromise;
}

async function terminateOcrWorker(){
  if(ocrWorkerPromise){
    try{
      const worker = await ocrWorkerPromise;
      await worker.terminate();
    }catch(e){ /* ignora falha ao encerrar */ }
    ocrWorkerPromise = null;
  }
}

function pageNeedsOcr(text){
  return !text || text.trim().length < OCR_MIN_CHARS_PER_PAGE;
}

// Renderiza uma página do pdf.js num canvas em memória e roda OCR nela.
async function ocrPdfPage(pdfPage){
  const worker = await getOcrWorker();
  const viewport = pdfPage.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  const { data } = await worker.recognize(canvas);
  canvas.width = 0;
  canvas.height = 0; // libera a memória do canvas mais cedo
  return (data && data.text) ? data.text.trim() : "";
}

window.OcrHelper = { pageNeedsOcr, ocrPdfPage, terminateOcrWorker };
