# Invoice Passport

Open-source building blocks for invoices that both people and AI agents can issue, pay and verify: compliant e-invoices
for many countries, payments on any rail (bank transfer, stablecoins, agent payment protocols), and a signed proof that
ties each invoice to its payment.

**Why.** AI agents are starting to buy and sell: API calls, data, services. They can already pay (x402, MPP,
stablecoins), but businesses still need a proper invoice for every payment, in the format their country requires, and a
way to prove which payment settled which invoice. This library is that missing layer, and the engine behind
[Billify](https://billify.org).

**What it does**

- **Invoices for every market.** One invoice model, many official formats: Peppol BIS 3.0 (EU), XRechnung (Germany),
  Factur-X PDF/A-3 (France, Germany), PINT AE (UAE mandate), PINT SG (Singapore InvoiceNow) and RO e-Factura (Romania),
  all checked against the official validators. Per-country rules (VAT/GST, tax ids, the currency tax must be shown in,
  e-invoicing mandates) for the EU, UAE, Singapore, UK, Switzerland, Panama and offshore hubs.
- **Payments by humans and agents.** Payable invoices over HTTP 402: x402 and the Machine Payments Protocol (MPP) with
  USDC on Base. Direct stablecoin payments to the seller's own wallet (Base, Ethereum, BNB Chain, Robinhood Chain)
  matched by a unique amount. Bank transfers matched from ISO 20022 statements (camt.052/053/054) by RF reference. Agent
  micro-payments consolidated into one invoice per payer and month, with every transaction hash attached.
- **Proof of payment.** An **Invoice Passport** is a signed JSON record from the issuer with the invoice, the parties,
  the payment evidence on whichever rail the money moved, and the history. Anyone with the issuer's public keys can
  verify it ([SPEC.md](SPEC.md)). A paid passport can also be issued as a UN/CEFACT
  [Verifiable Trade Documents](https://un.opensource.unicc.org/unece/uncefact/spec-unvtd/) `PaymentConfirmation`
  credential (W3C VC, did:web).
- **Privacy, optional.** Agents and auditors can fetch invoices and proofs through the [Anyone](https://anyone.io)
  network so servers never see who is asking.
- **Accounting.** Exchange rates from the source each jurisdiction accepts (ECB, BNR, HMRC, the CBUAE peg) for tax
  amounts in local currency and accounting exports.

TypeScript for Deno, Node 20+, browsers and edge runtimes. The core uses only WebCrypto; Factur-X PDFs use pdf-lib.
Apache-2.0.

## What is included

| Module                 |                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Invoices**           |                                                                                                                       |
| `src/peppol.ts`        | UBL 2.1 for Peppol BIS Billing 3.0 (EU) and XRechnung 3.0 (Germany): VAT categories S, Z, E, AE, K, G, O, attachments |
| `src/cii.ts`           | UN/CEFACT CII D16B (EN 16931), with the French reform notes and 0225 addresses                                        |
| `src/facturx.ts`       | Factur-X / ZUGFeRD: the CII XML inside a PDF/A-3b, with supplements such as a transaction annex                       |
| `src/pint.ts`          | Peppol PINT AE 1.0.4 (UAE mandate) and PINT SG 1.4.1 (Singapore InvoiceNow)                                           |
| `src/ubl.ts`           | RO e-Factura (CIUS-RO 1.0.1) with CUI checks                                                                          |
| `src/jurisdictions.ts` | Invoicing rules per jurisdiction and compliance findings for a seller or an invoice                                   |
| **Payments**           |                                                                                                                       |
| `src/mpp.ts`           | Machine Payments Protocol (HTTP `Payment` auth): HMAC-bound challenges, credentials, evm charge, receipts             |
| `src/onchain.ts`       | Stablecoin payments to the seller's wallet: unique pay amounts, Transfer log decoding, matching                       |
| `src/camt.ts`          | ISO 20022 bank statements (camt.052 / 053 / 054) → transactions with references                                       |
| `src/reconcile.ts`     | Matches incoming transfers to open invoices (RF reference, number + amount, amount)                                   |
| `src/sepa.ts`          | RF creditor references (ISO 11649), IBAN checks, `bank_transfer` evidence                                             |
| **Proof**              |                                                                                                                       |
| `src/passport.ts`      | Build, sign and verify Invoice Passports                                                                              |
| `src/jws.ts`           | ES256 compact JWS: load / generate keys, sign, verify, verify against a JWKS                                          |
| `src/unvtd.ts`         | UN/CEFACT UNVTD PaymentConfirmation credentials (W3C VC, vc+jwt) and did:web resolution                               |
| `src/canonical.ts`     | Canonical JSON and SHA-256                                                                                            |
| **Rates and privacy**  |                                                                                                                       |
| `src/taxfx.ts`         | The rate each jurisdiction accepts for tax in local currency (BNR, ECB, HMRC, CBUAE peg)                              |
| `src/ecb.ts`           | ECB euro reference rates (≈30 currencies), on-or-before lookups and cross rates                                       |
| `src/bnr.ts`           | National Bank of Romania rates and the "last fixing before the operation date" rule                                   |
| `src/anyone.ts`        | Optional private transport through a local Anyone client (SOCKS5h): no IP or DNS leak                                 |
| `src/xml.ts`           | Small dependency-free XML reader (no DOCTYPE, no entity expansion)                                                    |
| **Tools**              |                                                                                                                       |
| `cli/verify.ts`        | Command-line verifier (`--anyone` for private fetching)                                                               |
| `web/`                 | Browser verifier page (`web/index.html`) and the bundled library                                                      |
| `conformance/`         | XSD + official CEN, OpenPeppol, KoSIT and PINT schematron on every vector; veraPDF + Mustang on Factur-X PDFs         |
| `vectors/`             | Test vectors for every format, passports, JWS, bank statements and on-chain logs                                      |

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

- Agent payments: x402 v2 and MPP (evm charge, hash credentials) for USDC on Base; consolidated invoices for
  micro-payments with every transaction hash attached.
- Stablecoin payments to the seller's own wallet, matched by a unique pay amount per invoice.
- Bank reconciliation: camt.052/053/054 import and matching by RF reference, invoice number + amount, or amount.
- Peppol BIS Billing 3.0 for EU invoicing: VAT categories S, Z, E, AE, K, G, O, mixed rates, RF payment reference, tax
  currency, attachments, and the fatal national rules for DE, IT and NL sellers.
- XRechnung 3.0 (Germany) and Factur-X EN 16931 (France, Germany): PDF/A-3b validated with veraPDF and Mustang,
  including the French reform rules (BR-FR).
- PINT AE (UAE e-invoicing mandate) and PINT SG (InvoiceNow), validated with the official PINT and jurisdiction
  schematron.
- RO e-Factura (CIUS-RO 1.0.1), accepted by ANAF's validator.
- Signatures: ES256 only.
- Planned: credit notes, more national formats, key rotation guidance.

## Origin

Extracted from [Billify](https://billify.org), which issues Invoice Passports in production.

## License

[Apache License 2.0](LICENSE). Copyright 2026 Ovidiu Chintovan.
