/**
 * Minimal, dependency-free XML reader for machine-generated documents (bank statements, UBL).
 * Namespace prefixes are dropped (`ns:Tag` → `Tag`), entity and character references are
 * decoded, comments/processing instructions are skipped, and DOCTYPE declarations are rejected
 * (no external entities, no entity expansion). Not a validating parser.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref] ?? whole;
  });
}

const localName = (qname: string) => qname.slice(qname.indexOf(":") + 1);

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      stack[stack.length - 1].text += decode(xml.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decode(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end === -1) throw new Error("XML: unterminated comment");
      i = end + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end === -1) throw new Error("XML: unterminated CDATA");
      stack[stack.length - 1].text += xml.slice(lt + 9, end);
      i = end + 3;
    } else if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end === -1) throw new Error("XML: unterminated processing instruction");
      i = end + 2;
    } else if (xml.startsWith("<!", lt)) {
      throw new Error("XML: DOCTYPE and other declarations are not accepted");
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt);
      if (end === -1) throw new Error("XML: unterminated end tag");
      const name = localName(xml.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (!open || open === root || open.name !== name) throw new Error(`XML: unexpected </${name}>`);
      i = end + 1;
    } else {
      // Find the end of the start tag, skipping '>' inside quoted attribute values.
      let j = lt + 1;
      let quote = "";
      for (; j < n; j++) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (j >= n) throw new Error("XML: unterminated start tag");
      const selfClosing = xml[j - 1] === "/";
      const body = xml.slice(lt + 1, selfClosing ? j - 1 : j);
      const nameMatch = body.match(/^\s*([^\s/>]+)/);
      if (!nameMatch) throw new Error("XML: tag without a name");
      const node: XmlNode = { name: localName(nameMatch[1]), attrs: {}, children: [], text: "" };
      for (const a of body.slice(nameMatch[0].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
        if (a[1].startsWith("xmlns")) continue;
        node.attrs[localName(a[1])] = decode(a[3] ?? a[4] ?? "");
      }
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new Error(`XML: <${stack[stack.length - 1].name}> is not closed`);
  return root;
}

/** First child at the end of a path of element names, e.g. child(n, "Acct", "Id", "IBAN"). */
export function child(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let cur = node;
  for (const name of path) {
    cur = cur?.children.find((c) => c.name === name);
    if (!cur) return undefined;
  }
  return cur;
}

/** All direct children with this name. */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Trimmed text at the path, or null when missing or empty. */
export function textAt(node: XmlNode | undefined, ...path: string[]): string | null {
  const t = child(node, ...path)?.text.trim();
  return t ? t : null;
}
