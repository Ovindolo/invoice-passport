/**
 * Builds vectors/facturx-fr-fr-S.pdf: a minimal visual invoice with embedded DejaVu fonts and the
 * cii-fr-fr-S XML, saved as Factur-X (PDF/A-3b). Fonts come from conformance/.cache/fonts
 * (downloaded by conformance/run.sh). Fixed date, so reruns are stable.
 */
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { buildCiiInvoice, type CiiInvoiceInput } from "../src/cii.ts";
import { saveAsFacturX } from "../src/facturx.ts";

const root = new URL("../", import.meta.url);
const input = JSON.parse(await Deno.readTextFile(new URL("vectors/cii-fr-fr-S.input.json", root))) as CiiInvoiceInput;
const cii = buildCiiInvoice(input);
if (!cii.xml || !cii.totals) throw new Error(cii.problems.join("; "));

const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const font = await pdf.embedFont(await Deno.readFile(new URL("conformance/.cache/fonts/DejaVuSans.ttf", root)), {
  subset: true,
});
const bold = await pdf.embedFont(await Deno.readFile(new URL("conformance/.cache/fonts/DejaVuSans-Bold.ttf", root)), {
  subset: true,
});
const page = pdf.addPage([595.28, 841.89]);
let y = 790;
const line = (text: string, size = 10, f = font) => {
  page.drawText(text, { x: 50, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
  y -= size + 8;
};
line(`Facture ${input.number}`, 18, bold);
line(`Date : ${input.issueDate} · Échéance : ${input.dueDate}`);
line(`${input.seller.name} — ${input.seller.vatId}`, 10, bold);
line(`Client : ${input.buyer.name} — ${input.buyer.vatId}`);
y -= 10;
for (const l of input.lines) {
  line(`${l.quantity} × ${l.description} @ ${l.unitPrice.toFixed(2)} EUR (TVA ${l.vatRate} %)`);
}
y -= 10;
line(
  `Total HT ${cii.totals.net.toFixed(2)} EUR · TVA ${cii.totals.vat.toFixed(2)} EUR · TTC ${
    cii.totals.gross.toFixed(2)
  } EUR`,
  11,
  bold,
);
line(input.paymentTerms ?? "", 8);

const bytes = await saveAsFacturX(pdf, cii.xml, {
  title: `Facture ${input.number}`,
  author: input.seller.name,
  date: new Date("2026-10-18T10:00:00Z"),
});
await Deno.writeFile(new URL("vectors/facturx-fr-fr-S.pdf", root), bytes);
console.log(`facturx-fr-fr-S.pdf ${bytes.length} bytes`);

// Agent-payment receipt with the transaction annex embedded as a supplement (CSV) and in the XML.
const receipt = JSON.parse(
  await Deno.readTextFile(new URL("vectors/cii-agent-receipt-AE.input.json", root)),
) as CiiInvoiceInput;
const receiptCii = buildCiiInvoice(receipt);
if (!receiptCii.xml) throw new Error(receiptCii.problems.join("; "));
const doc2 = await PDFDocument.create();
doc2.registerFontkit(fontkit);
const f2 = await doc2.embedFont(await Deno.readFile(new URL("conformance/.cache/fonts/DejaVuSans.ttf", root)), {
  subset: true,
});
doc2.addPage([595.28, 841.89]).drawText(
  `Invoice ${receipt.number}: ${receipt.lines.length} x402 payments, see transactions.csv`,
  {
    x: 50,
    y: 790,
    size: 11,
    font: f2,
  },
);
const annex = receipt.attachments![0];
const bytes2 = await saveAsFacturX(doc2, receiptCii.xml, {
  title: `Invoice ${receipt.number}`,
  author: receipt.seller.name,
  date: new Date("2026-10-31T10:00:00Z"),
  supplements: [{
    filename: annex.filename,
    mimeType: annex.mimeCode,
    content: Uint8Array.from(atob(annex.base64), (c) => c.charCodeAt(0)),
    description: annex.description ?? undefined,
  }],
});
await Deno.writeFile(new URL("vectors/facturx-agent-receipt-AE.pdf", root), bytes2);
console.log(`facturx-agent-receipt-AE.pdf ${bytes2.length} bytes`);
