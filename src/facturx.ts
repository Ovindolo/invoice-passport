/**
 * Factur-X / ZUGFeRD: turns a pdf-lib document into a PDF/A-3b invoice with the CII XML embedded as
 * factur-x.xml (AFRelationship Alternative), the Factur-X XMP extension schema, an sRGB output intent
 * and a document id. The caller must embed every font it draws with (PDF/A forbids the unembedded
 * standard 14 fonts). Checked with veraPDF and the Mustang validator (see conformance/).
 */
import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";

export const FACTURX_FILENAME = "factur-x.xml";

/** sRGB v4 ICC profile, 480 bytes, CC0 (https://github.com/saucecontrol/Compact-ICC-Profiles). */
const SRGB_ICC_B64 =
  "AAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb";

export interface FacturXMeta {
  title: string;
  author: string;
  subject?: string;
  /** Factur-X conformance level written to the XMP; Billify emits "EN 16931". */
  conformanceLevel?: "MINIMUM" | "BASIC WL" | "BASIC" | "EN 16931" | "EXTENDED";
  creatorTool?: string;
  producer?: string;
  /** Fixed timestamp for reproducible output; defaults to now. */
  date?: Date;
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function xmp(meta: Required<Omit<FacturXMeta, "date">>, iso: string): string {
  const prop = (name: string, description: string) => `
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>${name}</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>${description}</pdfaProperty:description>
              </rdf:li>`;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(meta.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${xmlEsc(meta.author)}</rdf:li></rdf:Seq></dc:creator>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(meta.subject)}</rdf:li></rdf:Alt></dc:description>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${xmlEsc(meta.producer)}</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${xmlEsc(meta.creatorTool)}</xmp:CreatorTool>
      <xmp:CreateDate>${iso}</xmp:CreateDate>
      <xmp:ModifyDate>${iso}</xmp:ModifyDate>
      <xmp:MetadataDate>${iso}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${prop("DocumentFileName", "The name of the embedded XML document")}${
    prop("DocumentType", "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER")
  }${prop("Version", "The actual version of the standard applying to the embedded XML document")}${
    prop("ConformanceLevel", "The conformance level of the embedded XML document")
  }
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${meta.conformanceLevel}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Embeds the CII XML and the PDF/A-3 / Factur-X metadata, and returns the saved PDF bytes. */
export async function saveAsFacturX(pdf: PDFDocument, ciiXml: string, input: FacturXMeta): Promise<Uint8Array> {
  const date = new Date(Math.floor((input.date ?? new Date()).getTime() / 1000) * 1000);
  const meta = {
    title: input.title,
    author: input.author,
    subject: input.subject ?? input.title,
    conformanceLevel: input.conformanceLevel ?? "EN 16931",
    creatorTool: input.creatorTool ?? "invoice-passport",
    producer: input.producer ?? "invoice-passport (pdf-lib)",
  };
  const ctx = pdf.context;
  const catalog = pdf.catalog;
  const xmlBytes = new TextEncoder().encode(ciiXml);

  pdf.setTitle(meta.title, { showInWindowTitleBar: true });
  pdf.setAuthor(meta.author);
  pdf.setSubject(meta.subject);
  pdf.setCreator(meta.creatorTool);
  pdf.setProducer(meta.producer);
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);
  pdf.setLanguage("en");

  // Embedded file and its file specification (PDF/A-3: AFRelationship + catalog /AF).
  const pdfDate = PDFString.fromDate(date);
  const fileStream = ctx.flateStream(xmlBytes, {
    Type: "EmbeddedFile",
    Subtype: PDFName.of("text/xml"),
    Params: { Size: xmlBytes.length, ModDate: pdfDate },
  });
  const fileRef = ctx.register(fileStream);
  const fileSpec = ctx.obj({
    Type: "Filespec",
    F: PDFString.of(FACTURX_FILENAME),
    UF: PDFHexString.fromText(FACTURX_FILENAME),
    Desc: PDFString.of("Factur-X invoice"),
    AFRelationship: "Alternative",
    EF: { F: fileRef, UF: fileRef },
  });
  const fileSpecRef = ctx.register(fileSpec);
  catalog.set(
    PDFName.of("Names"),
    ctx.obj({ EmbeddedFiles: { Names: [PDFString.of(FACTURX_FILENAME), fileSpecRef] } }),
  );
  catalog.set(PDFName.of("AF"), ctx.obj([fileSpecRef]));

  // XMP metadata (left uncompressed so readers and validators can find it).
  const xmpBytes = new TextEncoder().encode(xmp(meta, date.toISOString().replace(".000Z", "Z")));
  const metadata = ctx.stream(xmpBytes, { Type: "Metadata", Subtype: "XML", Length: xmpBytes.length });
  catalog.set(PDFName.of("Metadata"), ctx.register(metadata));

  // sRGB output intent for the device-dependent colours pdf-lib draws with.
  const iccRef = ctx.register(ctx.flateStream(b64(SRGB_ICC_B64), { N: 3 }));
  catalog.set(
    PDFName.of("OutputIntents"),
    ctx.obj([{
      Type: "OutputIntent",
      S: "GTS_PDFA1",
      OutputConditionIdentifier: PDFString.of("sRGB"),
      Info: PDFString.of("sRGB IEC61966-2.1"),
      DestOutputProfile: iccRef,
    }]),
  );

  // Document id derived from the XML, so the same invoice gets the same id.
  const id = PDFHexString.of((await sha256Hex(xmlBytes)).slice(0, 32));
  ctx.trailerInfo.ID = ctx.obj([id, id]);

  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}
