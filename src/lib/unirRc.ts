import { PDFDocument } from 'pdf-lib';

// ── Unir el RC escaneado con las fotos de la orden ──
// Resultado: las páginas del RC tal como vienen, y después cada foto en su propia página.

export type FotoLista = { bytes: Uint8Array; ancho: number; alto: number };

const CAJA_VERTICAL = { ancho: 600, alto: 860 };
const CAJA_HORIZONTAL = { ancho: 860, alto: 600 };

export async function armarPdfRcConFotos(rcBytes: Uint8Array, fotos: FotoLista[]): Promise<Uint8Array> {
  const salida = await PDFDocument.create();
  const rc = await PDFDocument.load(rcBytes, { ignoreEncryption: true });
  const paginas = await salida.copyPages(rc, rc.getPageIndices());
  paginas.forEach((p) => salida.addPage(p));

  for (const f of fotos) {
    const img = await salida.embedJpg(f.bytes);
    const caja = f.ancho > f.alto ? CAJA_HORIZONTAL : CAJA_VERTICAL;
    const escala = Math.min(caja.ancho / f.ancho, caja.alto / f.alto);
    const w = Math.round(f.ancho * escala);
    const h = Math.round(f.alto * escala);
    const pagina = salida.addPage([w, h]);
    pagina.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return salida.save();
}

// Convierte cualquier foto (JPG, PNG, WebP…) en un JPG liviano (lado mayor 1600 px) listo para el PDF.
// Solo funciona en el navegador.
export async function prepararFoto(blob: Blob, ladoMayor = 1600, calidad = 0.82): Promise<FotoLista> {
  const bmp = await createImageBitmap(blob);
  try {
    const k = Math.min(1, ladoMayor / Math.max(bmp.width, bmp.height));
    const ancho = Math.max(1, Math.round(bmp.width * k));
    const alto = Math.max(1, Math.round(bmp.height * k));
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error('Sin canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(bmp, 0, 0, ancho, alto);
    const jpg: Blob = await new Promise((res, rej) => lienzo.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo convertir'))), 'image/jpeg', calidad));
    return { bytes: new Uint8Array(await jpg.arrayBuffer()), ancho, alto };
  } finally {
    bmp.close();
  }
}

// Contrato que trae el nombre del archivo: «3232180.pdf», «3232180_457828706.pdf», «3232180 (2).pdf»…
export function contratoDelNombre(nombre: string): string | null {
  const m = nombre.replace(/\.pdf$/i, '').trim().match(/^(\d{3,})(?:\D.*)?$/);
  return m ? m[1] : null;
}
