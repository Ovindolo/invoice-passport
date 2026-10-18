# Invoice Passport

An open format and reference library that links a European e-invoice to verifiable proof of payment.

E-invoicing describes the invoice (EN 16931, UBL, Peppol, RO e-Factura). Payment systems describe the payment (SEPA /
ISO 20022, cards, blockchains). An **Invoice Passport** is a signed JSON record from the invoice issuer that ties them
together: the invoice, the parties, the payment evidence on whichever rail the money moved, and the invoice history.
Anyone with the issuer's public keys can verify it. See [SPEC.md](SPEC.md).

It interoperates with UN/CEFACT's
[Verifiable Trade Documents](https://un.opensource.unicc.org/unece/uncefact/spec-unvtd/) (UNVTD): a paid passport can
also be issued as a UNVTD `PaymentConfirmation` verifiable credential (SPEC section 7).

The library is TypeScript with no dependencies (WebCrypto only), for Deno, Node 20+, browsers and edge runtimes.

## What is included

| Module                 |                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/canonical.ts`     | Canonical JSON and SHA-256                                                                                                                        |
| `src/jws.ts`           | ES256 compact JWS: load / generate keys, sign, verify, verify against a JWKS                                                                      |
| `src/passport.ts`      | Build, sign and verify Invoice Passports                                                                                                          |
| `src/sepa.ts`          | RF creditor references (ISO 11649), IBAN checks, `bank_transfer` evidence                                                                         |
| `src/camt.ts`          | ISO 20022 bank statements (camt.052 / 053 / 054) → transactions with references                                                                   |
| `src/reconcile.ts`     | Matches incoming transfers to open invoices (RF reference, number + amount, amount)                                                               |
| `src/unvtd.ts`         | UN/CEFACT UNVTD PaymentConfirmation credentials (W3C VC, vc+jwt) and did:web resolution                                                           |
| `src/onchain.ts`       | Direct stablecoin payments (USDC/USDT on Base, Ethereum, BNB Chain; USDG on Robinhood Chain): unique pay amounts, Transfer log decoding, matching |
| `src/xml.ts`           | Small dependency-free XML reader (no DOCTYPE, no entity expansion)                                                                                |
| `src/peppol.ts`        | UBL 2.1 invoice for Peppol BIS Billing 3.0 (EN 16931) and XRechnung 3.0: VAT categories S, Z, E, AE, K, G, O                                      |
| `src/anyone.ts`        | Optional private transport: fetch through a local Anyone client (SOCKS5h), no IP or DNS leak                                                      |
| `src/mpp.ts`           | Machine Payments Protocol (HTTP `Payment` auth): HMAC-bound challenges, credentials, evm charge, receipts                                         |
| `src/pint.ts`          | Peppol PINT AE 1.0.4 (UAE mandate) and PINT SG 1.4.1 (Singapore InvoiceNow) invoices                                                              |
| `src/cii.ts`           | UN/CEFACT CII D16B invoice (EN 16931), French BR-FR notes and 0225 addresses                                                                      |
| `src/facturx.ts`       | Factur-X / ZUGFeRD: CII embedded in a PDF/A-3b with the Factur-X XMP schema                                                                       |
| `src/jurisdictions.ts` | Invoicing rules per jurisdiction (EU, UAE, Singapore, Panama, UK, CH, offshore hubs) and compliance findings                                      |
| `src/ubl.ts`           | UBL 2.1 invoice for RO e-Factura (CIUS-RO 1.0.1), VAT categories S and O, with CUI checks                                                         |
| `src/ecb.ts`           | ECB euro reference rates (≈30 currencies), on-or-before lookups and cross rates                                                                   |
| `src/bnr.ts`           | National Bank of Romania reference rates, and the "last fixing before the operation date" rule                                                    |
| `cli/verify.ts`        | Command-line verifier                                                                                                                             |
| `web/`                 | Browser verifier page (`web/index.html`) and the bundled library                                                                                  |
| `conformance/`         | XSD + official CEN (UBL, CII), OpenPeppol and KoSIT schematron on every vector; veraPDF + Mustang on Factur-X PDFs                                |
| `vectors/`             | Test vectors: passport, JWS, JWKS, RO e-Factura invoices accepted by ANAF, Peppol BIS 3.0 invoices                                                |

## Usage

```ts
import { loadSigningKey, signPassport, verifyPassport } from "./mod.ts";

const key = await loadSigningKey(Deno.env.get("PASSPORT_SIGNING_JWK"));
const jws = await signPassport(input, key!); // input: PassportInput, see src/passport.ts

const result = await verifyPassport(jws, { keys: [key!.publicJwk] });
if (result.ok) console.log(result.passport.payment);
```

RO e-Factura XML:

```ts
import { buildUblInvoice } from "./mod.ts";

const { xml, problems } = buildUblInvoice(invoice);
if (!xml) console.error(problems); // missing or invalid data is reported, never guessed
```

Peppol BIS Billing 3.0 with an RF payment reference:

```ts
import { buildPeppolInvoice, creditorReference } from "./mod.ts";

const reference = creditorReference(invoiceNumber); // e.g. "RF47INV20260042"
const { xml, problems } = buildPeppolInvoice({ ...invoice, payment: { iban, reference } });
```

Record the matching bank transfer as passport evidence:

```ts
import { bankTransferEvidence, findCreditorReference } from "./mod.ts";

const rf = findCreditorReference(remittanceText); // from the bank statement
const evidence = bankTransferEvidence({ scheme: "SEPA", amount, currency: "EUR", recordedAt, creditorReference: rf });
```

Match a bank statement to open invoices:

```ts
import { evidenceForMatch, parseCamt, reconcile } from "./mod.ts";

const { transactions } = parseCamt(camtXml);
const { matches, ambiguous, unmatched } = reconcile(transactions, openInvoices);
for (const m of matches.filter((m) => m.autoApply)) {
  markPaid(m.invoice.id, evidenceForMatch(m, new Date().toISOString()));
}
```

Verify a passport from the command line:

```sh
deno task verify vectors/passport.jws --jwks vectors/jwks.json
deno task verify passport.jws --jwks https://issuer.example/.well-known/jwks.json
```

## Demo: pay an invoice in USDG on Robinhood Chain

`examples/robinhood-usdg-pay-invoice.ts` sends the exact amount shown on an invoice in USDG on Robinhood Chain (chain
id 4663) with your own key, read from the environment for that run only.

## Private requests over Anyone (optional)

Agents and auditors can fetch passports, keys and invoices without revealing their IP address, through a local
[Anyone](https://anyone.io) client (SOCKS5h on port 9050, DNS resolved by the network):

```sh
npx @anyone-protocol/anyone-client          # starts the client
deno run --allow-read --allow-net cli/verify.ts <passport-url> --jwks <jwks-url> --anyone
```

In code, `anyoneFetch()` returns a `fetch` that goes through the client, and `anyoneReachable()` tells whether one is
running. Billify itself does not need it; it is the caller's choice.

## Browser verifier

Serve the repository root (for example `python3 -m http.server`) and open `/web/`. It verifies a passport against the
issuer's JWKS, optionally checks that an e-invoice XML file is the one the passport refers to, and shows the invoice,
payment evidence and history. Nothing leaves the browser.

## Development

```sh
deno task test      # unit tests and test vectors
deno task check     # type check
deno lint
deno task vectors   # regenerate vectors/ after a deliberate format change
deno task bundle    # rebuild web/invoice-passport.js
deno task conformance  # XSD + official EN 16931 / Peppol schematron on every XML vector (needs Python 3, xmllint)
```

## Scope

- RO e-Factura (CIUS-RO 1.0.1) for Romanian buyers, VAT categories S and O, accepted by ANAF's validator.
- Peppol BIS Billing 3.0 for EU invoicing: VAT categories S, Z, E, AE, K, G, O, mixed rates, RF payment reference, tax
  currency, and the fatal national rules for DE, IT and NL sellers.
- PINT AE (UAE e-invoicing mandate) and PINT SG (InvoiceNow), validated with the official PINT and jurisdiction
  schematron.
- XRechnung 3.0 (Germany) and Factur-X EN 16931 (France, Germany): PDF/A-3b validated with veraPDF and Mustang,
  including the French reform rules (BR-FR).
- Signatures: ES256 only.
- Stablecoin payments to the seller's own wallet, matched by a unique pay amount per invoice.
- Bank reconciliation: camt.052/053/054 import and matching by RF reference, invoice number + amount, or amount.
- Planned: credit notes, other national CIUS, key rotation guidance.

## Origin

Extracted from [Billify](https://billify.org), which issues Invoice Passports in production.

## License

[Apache License 2.0](LICENSE). Copyright 2026 Ovidiu Chintovan.
