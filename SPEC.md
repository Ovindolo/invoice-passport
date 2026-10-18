# Invoice Passport — specification v0.1 (draft)

Status: draft, open for comment. Identifier: `invoice-passport/0.1`.

## 1. Purpose

E-invoicing (EN 16931, UBL 2.1, CII, Peppol BIS Billing 3.0 and PINT, national CIUS such as XRechnung or CIUS-RO)
describes the invoice. Payment standards (ISO 20022, SEPA, card networks, public blockchains) describe the payment.
Nothing links the two in a verifiable, standard way, so reconciliation stays manual.

An **Invoice Passport** is a small JSON document, signed by the invoice issuer, that states:

- which invoice it is about (and, optionally, the SHA-256 of the exact e-invoice XML that was issued);
- who the seller and buyer are;
- the payment status and the evidence for it on whatever rail the money moved;
- the history of the invoice.

Anyone holding the passport and the issuer's public keys can check that the issuer made exactly these statements.

## 2. Encoding

1. The passport is a JSON object (section 3).
2. It is serialised as **canonical JSON**: object members sorted by key (UTF-16 code unit order, as
   `Array.prototype.sort` does) at every nesting level, members whose value is `undefined` omitted, array order
   preserved, no insignificant whitespace (`JSON.stringify` output).
3. The canonical bytes (UTF-8) are the payload of a **compact JWS** (RFC 7515) with protected header
   `{"alg":"ES256","kid":"<key id>","typ":"JWT"}`. Only ES256 (ECDSA P-256 / SHA-256) is defined in v0.1.
4. The issuer publishes its public keys as a **JWKS** (RFC 7517) at a stable HTTPS URL. Each key carries `kid`,
   `alg: "ES256"` and `use: "sig"`. Retired keys stay in the JWKS so old passports remain verifiable.

## 3. Payload

All members are required; a value that is unknown is `null`, never omitted.

| Member            | Type   | Meaning                                                         |
| ----------------- | ------ | --------------------------------------------------------------- |
| `spec`            | string | `"invoice-passport/0.1"`                                        |
| `passport_id`     | string | Issuer-unique, unguessable id of this passport                  |
| `verify_url`      | string | HTTPS URL where the current passport for this id can be fetched |
| `invoice`         | object | 3.1                                                             |
| `seller`, `buyer` | object | 3.2                                                             |
| `payment`         | object | 3.3                                                             |
| `history`         | array  | 3.4                                                             |
| `fiscal`          | object | 3.5                                                             |

### 3.1 `invoice`

`number`, `issue_date` and `due_date` (ISO 8601 date), `currency` (ISO 4217 or asset ticker), `status` (issuer's own
status), `lines` (array of `{description, quantity, unit_price, amount}`), `subtotal`, `tax_rate` (percent),
`tax_amount`, `total`, `notes`.

### 3.2 Parties

Seller: `name`, `tax_id`, `address`, `country`, `iban`. Buyer: `name`, `contact`, `tax_id`, `address`, `country`.

### 3.3 `payment`

| Member            | Meaning                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `status`          | `"paid"`, `"partially_paid"` or `"unpaid"`                                 |
| `paid_at`         | ISO 8601 timestamp when the invoice became paid                            |
| `method`          | issuer's label for the method (`"card"`, `"crypto"`, `"bank_transfer"`, …) |
| `amount_received` | amount received so far when partially paid                                 |
| `evidence`        | array of evidence objects                                                  |

Each evidence object has `rail` and `recorded_at` (when the issuer recorded it), plus rail-specific members. Recommended
rails:

| `rail`                                        | Members                                                                                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bank_transfer`                               | `scheme` (`"SEPA"`, …), `amount`, `currency`, `booking_date`, `end_to_end_id` (ISO 20022), `creditor_reference` (ISO 11649 RF, also printed on the invoice as BT-83), `debtor_iban_last4`, `bank_reference` |
| `card`                                        | `processor`, `payment_id`, `amount_minor`, `currency`, `livemode`                                                                                                                                           |
| `onchain`                                     | `chain`, `asset`, `amount`, `tx_hash`, `to_address`                                                                                                                                                         |
| processor name (e.g. `stripe`, `nowpayments`) | the processor's own ids, as recorded from its signed webhook                                                                                                                                                |

Verifiers MUST ignore members they do not understand.

### 3.4 `history`

Array of `{event, at, source}` in chronological order, e.g. `invoice.created`, `invoice.sent`, `invoice.paid`.

### 3.5 `fiscal`

`e_invoice`: `null`, or `{format, sha256, submission_id}` where `format` names the e-invoice syntax and CIUS (for
example `"UBL-2.1/CIUS-RO-1.0.1"` or `"UBL-2.1/PEPPOL-BIS-3.0"`), `sha256` is the hex SHA-256 of the exact XML bytes
issued, and `submission_id` is the national platform or network id once submitted (ANAF upload index, Peppol message
id).

## 4. Verification

1. Split the compact JWS; reject anything that is not three base64url parts.
2. Reject a header whose `alg` is not `ES256`.
3. Select the JWKS key whose `kid` equals the header `kid`; reject if none.
4. Verify the ECDSA signature over `<header>.<payload>`.
5. Decode the payload and check `spec`. Verifiers SHOULD also accept `billify.invoice-passport/0.1`, the identifier used
   by the first production issuer before publication; its payload is identical.
6. Optionally fetch `verify_url` to get the latest passport (status may have changed since this one was signed), and
   compare `fiscal.e_invoice.sha256` with the e-invoice XML you hold.

A valid signature proves the issuer made the statements, not that they are true. The evidence members let the verifier
check the payment independently (look up the transaction hash, match the SEPA end-to-end id).

## 5. Linking the payment to the invoice

The strongest link is a reference that appears both on the invoice and in the payment. For bank transfers this is an ISO
11649 RF creditor reference: the issuer prints it on the invoice (UBL `cac:PaymentMeans/cbc:PaymentID`, BT-83), the
payer's bank carries it as structured remittance information, and the issuer records it in the `bank_transfer` evidence.
For card and crypto rails the processor's payment id or the transaction hash plays the same role.

## 6. Privacy

A passport contains the data already printed on the invoice. Issuers SHOULD use unguessable `passport_id` values and
SHOULD NOT include data that is not on the invoice or needed to prove payment. Debtor account numbers are reduced to
their last four characters.

## 7. Relation to UN/CEFACT UNVTD

UN/CEFACT's Verifiable Trade Documents project ([UNVTD](https://un.opensource.unicc.org/unece/uncefact/spec-unvtd/), in
development; final standard expected by the end of 2026) models trade documents as W3C Verifiable Credentials issued by
DIDs, and describes the same reconciliation step as this specification: a verifiable invoice matched to a verifiable
payment. Invoice Passport is designed to work alongside it, not to compete with it.

**Mapping.** For a paid passport, an issuer can also publish a UNVTD `PaymentConfirmation` credential
(`paymentConfirmationFromPassport`):

| UNVTD PaymentConfirmation                                | Invoice Passport                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `id`                                                     | `verify_url` (the full passport)                                               |
| `issuer`                                                 | the issuer's `did:web` DID, whose DID document lists the same keys as the JWKS |
| `validFrom`                                              | `payment.paid_at`                                                              |
| `credentialSubject.invoiceNumber`                        | `invoice.number`                                                               |
| `credentialSubject.paymentDueDate`                       | `invoice.due_date`                                                             |
| `credentialSubject.invoicee` / `payee` / `accountHolder` | `buyer` / `seller` / `seller`                                                  |
| `credentialSubject.monetaryAmount`                       | `invoice.total`, `invoice.currency` (USDT/USDC reported as USD)                |
| `credentialSubject.paymentMethod`                        | a one-line summary of `payment.evidence` with its identifiers                  |

The credential is secured as a VC-JOSE compact JWS: protected header
`{"alg":"ES256","kid":"<did>#<key id>",
"typ":"vc+jwt","cty":"vc"}`, payload the credential in canonical JSON. Verifiers
resolve the `did:web` document and accept only keys listed under `assertionMethod`. The test vector validates against
the UNVTD JSON Schema (`conformance/run.sh`).

**What UNVTD does not cover yet.** The PaymentConfirmation schema has no structured place for settlement evidence: the
on-chain transaction hash, the ISO 11649 creditor reference, the ISO 20022 end-to-end id, or which rail settled the
invoice. UNVTD lists a remittance-advice schema on its roadmap. The `payment.evidence` model of section 3.3 is offered
as input to that work.

**Differences in design.** UNVTD credentials are issued by the party that performed the act (a bank confirms a payment).
An Invoice Passport is issued by the invoicing platform or the seller and records evidence it observed from the payment
rail, which is why each evidence item carries identifiers a verifier can check independently.

## 8. Test vectors

`vectors/` contains a sample input, the passport built from it, its JWS, the JWKS and the TEST-ONLY private key used to
sign it; two RO e-Factura invoices (VAT categories O and S) accepted by ANAF's public validator; and five Peppol BIS
Billing 3.0 invoices (S+E mixed rates, AE reverse charge, K intra-community, G export, O outside scope). Every XML
vector validates against the UBL 2.1 XSD and the official CEN EN 16931 schematron; the Peppol ones also against the
OpenPeppol BIS 3.0 rules (`conformance/run.sh`). `unvtd-payment-confirmation.json`/`.jwt` and `did.json` are the UNVTD
credential derived from `passport.json` and the test issuer's DID document.
