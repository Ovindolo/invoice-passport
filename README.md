# Invoice Passport

An open format and reference library that links a European e-invoice to verifiable proof of payment.

E-invoicing describes the invoice (EN 16931, UBL, Peppol, RO e-Factura). Payment systems describe the payment (SEPA /
ISO 20022, cards, blockchains). An **Invoice Passport** is a signed JSON record from the invoice issuer that ties them
together: the invoice, the parties, the payment evidence on whichever rail the money moved, and the invoice history.
Anyone with the issuer's public keys can verify it. See [SPEC.md](SPEC.md).

The library is TypeScript with no dependencies (WebCrypto only), for Deno, Node 20+, browsers and edge runtimes.

## What is included

| Module             |                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `src/canonical.ts` | Canonical JSON and SHA-256                                                                     |
| `src/jws.ts`       | ES256 compact JWS: load / generate keys, sign, verify, verify against a JWKS                   |
| `src/passport.ts`  | Build, sign and verify Invoice Passports                                                       |
| `src/ubl.ts`       | UBL 2.1 invoice for RO e-Factura (CIUS-RO 1.0.1), VAT categories S and O, with CUI checks      |
| `src/bnr.ts`       | National Bank of Romania reference rates, and the "last fixing before the operation date" rule |
| `cli/verify.ts`    | Command-line verifier                                                                          |
| `vectors/`         | Test vectors (passport, JWS, JWKS, UBL invoices accepted by ANAF's validator)                  |

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

Verify a passport from the command line:

```sh
deno task verify vectors/passport.jws --jwks vectors/jwks.json
deno task verify passport.jws --jwks https://issuer.example/.well-known/jwks.json
```

## Development

```sh
deno task test      # unit tests and test vectors
deno task check     # type check
deno lint
deno task vectors   # regenerate vectors/ after a deliberate format change
```

## Scope of v0.1

- E-invoice: RO e-Factura for Romanian buyers, VAT categories S (standard rate) and O (seller not VAT-registered).
  Exemptions, reverse charge and other national CIUS are not covered yet.
- Signatures: ES256 only.
- Planned: generic EN 16931 / Peppol BIS Billing 3.0 mapping, ISO 20022 / RF creditor reference evidence helpers, a web
  verifier, key rotation guidance.

## Origin

Extracted from [Billify](https://billify.org), which issues Invoice Passports in production.

## License

[Apache License 2.0](LICENSE). Copyright 2026 Ovidiu Chintovan.
