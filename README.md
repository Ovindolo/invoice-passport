# Invoice Passport

An open format and reference library that links a European e-invoice to verifiable proof of payment.

E-invoicing describes the invoice (EN 16931, UBL, Peppol, RO e-Factura). Payment systems describe the payment (SEPA /
ISO 20022, cards, blockchains). An **Invoice Passport** is a signed JSON record from the invoice issuer that ties them
together: the invoice, the parties, the payment evidence on whichever rail the money moved, and the invoice history.
Anyone with the issuer's public keys can verify it. See [SPEC.md](SPEC.md).

The library is TypeScript with no dependencies (WebCrypto only), for Deno, Node 20+, browsers and edge runtimes.

## What is included

| Module             |                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/canonical.ts` | Canonical JSON and SHA-256                                                                              |
| `src/jws.ts`       | ES256 compact JWS: load / generate keys, sign, verify, verify against a JWKS                            |
| `src/passport.ts`  | Build, sign and verify Invoice Passports                                                                |
| `src/sepa.ts`      | RF creditor references (ISO 11649), IBAN checks, `bank_transfer` evidence                               |
| `src/peppol.ts`    | UBL 2.1 invoice for Peppol BIS Billing 3.0 (EN 16931): VAT categories S, Z, E, AE, K, G, O              |
| `src/ubl.ts`       | UBL 2.1 invoice for RO e-Factura (CIUS-RO 1.0.1), VAT categories S and O, with CUI checks               |
| `src/bnr.ts`       | National Bank of Romania reference rates, and the "last fixing before the operation date" rule          |
| `cli/verify.ts`    | Command-line verifier                                                                                   |
| `web/`             | Browser verifier page (`web/index.html`) and the bundled library                                        |
| `conformance/`     | Checks every XML vector against the UBL 2.1 XSD and the official CEN EN 16931 and OpenPeppol schematron |
| `vectors/`         | Test vectors: passport, JWS, JWKS, RO e-Factura invoices accepted by ANAF, Peppol BIS 3.0 invoices      |

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

Verify a passport from the command line:

```sh
deno task verify vectors/passport.jws --jwks vectors/jwks.json
deno task verify passport.jws --jwks https://issuer.example/.well-known/jwks.json
```

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
- Signatures: ES256 only.
- Planned: credit notes, ISO 20022 camt.053/054 statement import for automatic matching, other national CIUS, key
  rotation guidance.

## Origin

Extracted from [Billify](https://billify.org), which issues Invoice Passports in production.

## License

[Apache License 2.0](LICENSE). Copyright 2026 Ovidiu Chintovan.
