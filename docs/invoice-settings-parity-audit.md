# Invoice Settings Parity Audit

**Reference:** myBillBook `https://mybillbook.in/app/settings/invoice`  
**Product:** MyOwnBillBook / myownbillbook  
**Date:** 28 Oct 2026  

## 1. Reference inspection status

Attempted live inspection of the reference URL in the authorized Cursor browser.

- Unauthenticated navigation redirected to `https://mybillbook.in/app/#/login` (and later `.../app/dashboard#/login`).
- The Angular/single-spa shell loaded (`app-root`, recaptcha iframe present).
- The login form **did not mount** in this browser (empty `router-outlet`, 0 inputs). OTP login with `8238812890` could not be completed here.
- **Limitation:** controls on the live myBillBook page were not re-verified click-by-click in this session. Inventory below uses (a) prior authorized screenshots of that module from this project, (b) the current MyOwnBillBook Invoice Settings studio at `http://localhost:3000/settings/invoice`, and (c) backend/schema review. Features that exist only behind a paid myBillBook plan were not claimed.

## 2. Observed / previously documented reference inventory

| Area | Observed controls (from prior live screenshots + current studio labels) |
| :--- | :--- |
| Header | Invoice Settings title, Save Changes |
| Canvas | Live A4 tax invoice preview: company, GSTIN, invoice no/date/due date, bill to, ship to, item table, GST totals, amount in words, notes, terms |
| History | Undo, Redo, Revert to Original |
| AI dock | Easy to Read, Brand Touch, Highlight Key Info, Fix Layout, Make it Creative; prompt; attach image; selector |
| ThemeStore | Your logo, Navaratri, Durga Puja, Dussehra, Dhanteras, Diwali, Uttarayan, Independence, Ganesh |
| Themes | Themes vs Create Custom Theme; Stylish, Luxury (NEW), Advanced GST (Tally); See All |
| Color | 8 swatches + hex picker |
| Theme settings | Party balance, free qty, item description, alternate unit, phone, time on invoice, price history, auto-apply luxury for sharing |
| Accordions | Invoice Details, Party Details, Item Table Columns, Miscellaneous Details |

Invoice numbering prefixes, A4/A5 paper pickers, and thermal layout live on **Print Settings** / document creation in this product, not as a second copy of Invoice Settings.

## 3. Current MyOwnBillBook implementation

| Layer | Location |
| :--- | :--- |
| UI | `Billing_frontend/src/components/invoice/invoice-settings-studio.tsx` routed from `/settings/invoice` |
| API | `GET/PUT /api/v1/invoice-settings`, `GET /invoice-settings/themes`, `GET /invoice-settings/preview`, `POST /invoice-settings/ai-style` |
| Print | `GET /api/v1/invoices/:id/print` uses the same `InvoicePrintService` + HTML renderer |
| DB | `company_invoice_print_settings` (RLS, unique `company_id`, org+company from JWT tenant context) |

## 4. Parity matrix (verified vs code, not “button exists”)

| Feature | Reference | Project | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Live preview canvas | Center | Studio preview | **Partial → improved** | Preview is client-side; HTML print/PDF uses server renderer. Renderer now honors extra columns, terms, bank, signature, paper size. |
| Save Changes | Persist per company | PUT + DB | **Implemented** | Previously many studio fields only hit localStorage and PUT errors were swallowed. Save now sends full DTO; failed PUT surfaces an error. |
| Reload persistence | Refresh keeps values | GET on mount | **Implemented** | GET maps showBatch/showExpiry/time/terms/custom columns/fonts. |
| Undo / Redo / Revert | Canvas toolbar | Local history stack | **Implemented (session)** | History is in-memory; Revert restores factory defaults then user must Save. |
| ThemeStore festive | Carousel | Carousel | **Implemented** | IDs aligned to backend (`navratri`, `ganesh_chaturthi`). |
| Stylish / Luxury / Tally | 3 cards | 3 cards + aliases | **Implemented** | `See All` themes map to catalog ids. |
| Color palette + hex | 8 + picker | 8 + picker | **Implemented** | Saved as `accentColor`. |
| Theme setting toggles | 8 toggles | Wired to state + DB | **Implemented** | Time-on-invoice and price history (`printHistory`) persisted. |
| Invoice / party custom fields | Accordions | UI + JSON columns | **Implemented** | Printed on HTML invoice. |
| Item columns (batch, exp, mfg, qty, rate) | Accordion | UI + DB + renderer | **Implemented** | |
| Misc: bank, QR, terms, signature | Accordion | UI + company bank/UPI/signature + terms JSON | **Partial** | Bank/QR selectors store chosen ids; print uses company bank/UPI/signature. Multi-bank master is not a separate settings table. |
| AI styler | Dock | `/invoice-settings/ai-style` | **Implemented with fallback** | Gemini when `GEMINI_API_KEY` set; heuristic chips always. |
| Paper size | If present on reference | `paperSize` A4/A5/thermal | **Implemented in renderer** | Studio still previews A4 canvas. Thermal POS is `/settings/thermal-print`. |
| Invoice numbering | Often a different settings area | `invoiceSequence` on create | **Out of this page** | Not duplicated here. |
| Historical invoice freeze | Issued docs unchanged | Print uses **current** company settings | **Documented gap** | Issued invoices do not snapshot print settings; changing theme later changes reprint of old invoices. |
| Cross-tenant isolation | Company scoped | Tenant headers + RLS | **Implemented** | Tested in `test/invoice-settings.integration.spec.ts`. |

## 5. Implementation this pass

1. Migration `20261028180000_invoice_settings_studio_fields` for remaining studio/print fields.
2. DTO + `InvoicePrintService.saveSettings` persist those fields; theme aliases.
3. HTML renderer: paper/margins/font, batch/exp/mfg/custom columns, time, custom invoice/party fields, default terms, bank/UPI/signature/receiver signature.
4. Frontend: full PUT payload; no silent `.catch(() => null)` on save; load mapping completed.
5. Integration tests for auth, save/reload, isolation, invalid theme, preview HTML.

## 6. API

| Method | Path | Auth |
| :--- | :--- | :--- |
| GET | `/api/v1/invoice-settings` | JWT + tenant |
| PUT | `/api/v1/invoice-settings` | COMPANY_ADMIN / ORG_ADMIN / ACCOUNTANT / SUPER_ADMIN |
| GET | `/api/v1/invoice-settings/themes` | JWT |
| GET | `/api/v1/invoice-settings/preview` | JWT + tenant |
| POST | `/api/v1/invoice-settings/ai-style` | JWT |
| GET | `/api/v1/invoices/:id/print` | JWT + tenant |

Company id is taken from `@CurrentTenant()`, not from the body.

## 7. Deploy (existing VPS)

```bash
cd /path/to/Billing_backend
npx prisma migrate deploy
npx prisma generate
npm run build
# restart backend process (pm2/systemd)
cd /path/to/Billing_frontend
npm run build
# restart Next.js / nginx as usual
```

## 8. Remaining blockers

- Live myBillBook login form did not render in the automation browser, so OTP `8238812890` was not entered. Re-open the reference URL locally if a pixel-level re-audit of a paywalled control is required.
- Thermal print settings still use browser localStorage (`PrintSettingsView`); that is a separate module.
- Issued invoices are not frozen to a print-settings snapshot.
